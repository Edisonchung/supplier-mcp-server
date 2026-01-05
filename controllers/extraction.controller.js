const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const { identifySupplier } = require('../utils/supplierTemplates');

// NEW: Import MCP Prompt Service
const UnifiedAIService = require('../services/ai/UnifiedAIService');
const MCPPromptService = require('../services/MCPPromptService');
const mcpPromptService = new MCPPromptService();

// Initialize AI clients (use environment variables)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const genAI = process.env.GOOGLE_AI_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) : null;
// Initialize DeepSeek (OpenAI-compatible)
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({ 
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1"
}) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ================================
// NEW: DUAL PROMPT SYSTEM CONFIGURATION
// ================================

const PROMPT_SYSTEM_CONFIG = {
  defaultMode: 'legacy', // Safe default
  enableABTesting: true,
  fallbackToLegacy: true,
  testUsers: [
    'edisonchung@flowsolution.net', // Early adopter
    // Add more test users as needed
  ],
  testPercentage: 5, // Start with 5% of traffic
  analytics: {
    trackUsage: true,
    logPerformance: true
  }
};

// NEW: Prompt system selector
const selectPromptSystem = (user, supplierInfo, options = {}) => {
  console.log(`🎯 Selecting prompt system for user: ${user?.email || 'anonymous'}, supplier: ${supplierInfo?.name || 'unknown'}`);
  
  // Check if user explicitly requested new system
  if (options.useNewPrompts === true) {
    console.log('✅ User explicitly requested MCP system');
    return 'mcp';
  }
  
  // Check if user explicitly requested legacy system  
  if (options.useNewPrompts === false) {
    console.log('✅ User explicitly requested Legacy system');
    return 'legacy';
  }
  
  // Check if user is in test group
  if (PROMPT_SYSTEM_CONFIG.testUsers.includes(user?.email)) {
    console.log('✅ User is in test group - using MCP system');
    return 'mcp';
  }
  
  // A/B testing for general users
  if (PROMPT_SYSTEM_CONFIG.enableABTesting) {
    const userHash = hashString(user?.email || 'anonymous');
    if (userHash % 100 < PROMPT_SYSTEM_CONFIG.testPercentage) {
      console.log(`✅ A/B testing selected MCP system (${PROMPT_SYSTEM_CONFIG.testPercentage}% group)`);
      return 'mcp';
    }
  }
  
  // Default to legacy system (safe)
  console.log('✅ Using Legacy system (default)');
  return 'legacy';
};

// NEW: Simple hash function for A/B testing
const hashString = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

// NEW: Get prompt based on system selection
const getPromptForExtraction = async (promptSystem, supplierInfo, category, user, documentType) => {
  const startTime = Date.now();
  
  try {
    if (promptSystem === 'mcp') {
      console.log(`🆕 Using MCP Prompt System for ${supplierInfo?.name || 'unknown supplier'}`);
      
      const mcpPrompt = await mcpPromptService.getPromptForTask(
        'document_extraction',
        category,
        {
          supplier: supplierInfo?.name,
          user: user,
          documentType: documentType || 'pdf'
        }
      );
      
      if (mcpPrompt) {
        console.log(`✅ MCP prompt found: ${mcpPrompt.name}`);
        return {
          system: 'mcp',
          prompt: mcpPrompt.prompt,
          metadata: {
            promptId: mcpPrompt.id,
            promptName: mcpPrompt.name,
            version: mcpPrompt.version,
            aiProvider: mcpPrompt.aiProvider,
            temperature: mcpPrompt.temperature,
            maxTokens: mcpPrompt.maxTokens,
            responseTime: Date.now() - startTime,
            suppliers: mcpPrompt.suppliers
          }
        };
      } else {
        console.log(`⚠️ No MCP prompt found, falling back to legacy system`);
        // Fallback to legacy
        return getLegacyPrompt(supplierInfo, category, documentType);
      }
    } else {
      console.log(`🔄 Using Legacy Prompt System for ${supplierInfo?.name || 'unknown supplier'}`);
      return getLegacyPrompt(supplierInfo, category, documentType);
    }
  } catch (error) {
    console.error('❌ MCP Prompt System error, falling back to legacy:', error);
    return getLegacyPrompt(supplierInfo, category, documentType);
  }
};

// EXISTING: Legacy prompt system (your current working prompts)
const getLegacyPrompt = (supplierInfo, category, documentType) => {
  console.log(`📋 Getting legacy prompt for: ${category}, supplier: ${supplierInfo?.name}, docType: ${documentType}`);
  
  // Proforma Invoice specific prompt
  if (category === 'proforma_invoice' || documentType === 'proforma_invoice') {
    const piPrompt = `Extract proforma invoice information from this Chinese supplier document.
    
CRITICAL PI-SPECIFIC RULES:
1. This is a PROFORMA INVOICE (PI) from a Chinese supplier to Malaysian buyer
2. Table format: Sr NO | ITEMS NAME | MODEL | BRAND | QUANTITY | UNIT PRICE | TOTAL PRICE
3. Extract ALL items from the table, not just the first one
4. Items are in format: BEARING 32222 SKF 100 $13.00 $1,300.00
5. Currency is USD with $ symbol
6. Look for SHIPPER (supplier) and RECEIVER (buyer) sections
7. Extract freight costs and total costs separately

Example PI Format:
Sr NO ITEMS NAME MODEL BRAND QUANTITY UNIT PRICE TOTAL PRICE
1     BEARING    32222 SKF   100      $ 13.00    $ 1,300.00
2     BEARING    HM518445/10 SKF 100  $ 6.00     $ 600.00

Return ONLY valid JSON with the proforma_invoice structure specified below.`;

    return {
      system: 'legacy',
      prompt: piPrompt,
      metadata: {
        promptId: 'legacy_pi_specific',
        promptName: 'PI Chinese Supplier Template',
        version: '1.2.0',
        supplier: 'Chinese Suppliers',
        category: 'proforma_invoice'
      }
    };
  }

  // PTP-specific prompt
  if (supplierInfo?.name && (
    supplierInfo.name.includes('PTP') || 
    supplierInfo.name.includes('PERINTIS TEKNOLOGI PERDANA')
  )) {
    const ptpPrompt = `Extract purchase order information from this PT. PERINTIS TEKNOLOGI PERDANA document.
    
CRITICAL PTP-SPECIFIC RULES:
1. This supplier uses a multi-line format where product names appear BELOW the part number line
2. The format is: Line Number | Part Number | Quantity | UOM | Price
3. The product description/name is on the NEXT LINE below, indented
4. NEVER use UOM values (PCS, UNI, SET, EA, etc.) as the product name
5. Look for descriptive text on the line following the part number

Example PTP Format:
Line  Part Number
1     400QCR1068                     1.00   PCS   20,500.00
      THRUSTER                       <-- This is the product name
2     B247K18x12x1000                10.00  UNI   325,000.00  
      RUBBER HOSE                    <-- This is the product name

Return ONLY valid JSON with the structure specified below.`;

    return {
      system: 'legacy',
      prompt: ptpPrompt,
      metadata: {
        promptId: 'legacy_ptp_specific',
        promptName: 'PTP Legacy Template',
        version: '1.1.0',
        supplier: 'PTP',
        category: 'purchase_order'
      }
    };
  }

  // Base generic prompt
  const basePrompt = `Extract purchase order information with PRECISE table column identification.

CRITICAL TABLE PARSING RULES:
1. ALWAYS identify exact column order from table header
2. Common PO table patterns:
   - Line | Part Number | Description | Delivery Date | Quantity | UOM | Unit Price | Amount

3. QUANTITY vs UNIT PRICE identification:
   - Quantity: Usually smaller numbers (1-10,000 range)
   - Unit Price: Usually larger monetary values with decimals
   - Look for currency patterns: "100.00", "2,200.00"

4. VALIDATION RULES:
   - quantity × unitPrice should ≈ totalPrice
   - If calculation mismatch > 10%, SWAP values and re-check

5. PROJECT CODE EXTRACTION:
   - Look for project codes near each line item (format: FS-S3798, BWS-S1046, etc.)
   - Project codes may appear in blue text, separate columns, or as references
   - Extract project code for each item if visible - it's essential for project tracking

RETURN STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string",
    "supplier": { "name": "string", "address": "string" },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number,
        "projectCode": "string (e.g., FS-S3798, BWS-S1046)"
      }
    ],
    "totalAmount": number
  }
}`;

  return {
    system: 'legacy',
    prompt: basePrompt,
    metadata: {
      promptId: 'legacy_base_extraction',
      promptName: 'Base Legacy Template',
      version: '1.3.0',
      supplier: 'ALL',
      category: category || 'purchase_order'
    }
  };
};

// ================================
// DOCUMENT TYPE DETECTION
// ================================

function detectDocumentType(text) {
  const upperText = text.toUpperCase();
  
  // Proforma Invoice indicators
  const piIndicators = [
    'PROFORMA INVOICE',
    'COMMERCIAL PROFORMA INVOICE',
    'QUOTE NO',
    'QUOTE NUMBER',
    'PI NUMBER',
    'SHIPPER',
    'RECEIVER',
    'PORT OF LOADING',
    'FREIGHT',
    'DDP',
    'EXW UNIT PRICE'
  ];
  
  // Purchase Order indicators
  const poIndicators = [
    'PURCHASE ORDER',
    'PO NUMBER',
    'ORDER NUMBER',
    'DELIVERY TO',
    'BILL TO'
  ];
  
  const piScore = piIndicators.filter(indicator => upperText.includes(indicator)).length;
  const poScore = poIndicators.filter(indicator => upperText.includes(indicator)).length;
  
  console.log(`Document type detection - PI score: ${piScore}, PO score: ${poScore}`);
  
  if (piScore > poScore) {
    return 'proforma_invoice';
  } else if (poScore > 0) {
    return 'purchase_order';
  } else {
    return 'unknown';
  }
}

// ================================
// AUTHORITATIVE CLASSIFICATION
// ================================

/**
 * Create authoritative classification metadata
 * This is the SINGLE SOURCE OF TRUTH for document type classification
 * Frontend MUST respect this classification
 * 
 * @param {Object} extractedData - The AI-extracted data
 * @param {string} pdfText - Original PDF text content  
 * @param {Object} options - Additional classification options
 * @returns {Object} Classification metadata
 */
function createAuthoritativeClassification(extractedData, pdfText = '', options = {}) {
  const { method = 'text_extraction', forceType = null } = options;
  
  if (forceType) {
    return {
      documentType: forceType,
      documentTypeConfidence: 0.95,
      classificationMethod: method,
      classificationSource: 'backend_authoritative',
      classificationTimestamp: new Date().toISOString(),
      isAuthoritative: true,
      skipFrontendDetection: true
    };
  }
  
  const detectedType = detectDocumentType(pdfText || JSON.stringify(extractedData));
  
  return {
    documentType: detectedType,
    documentTypeConfidence: 0.85,
    classificationMethod: method,
    classificationSource: 'backend_authoritative',
    classificationTimestamp: new Date().toISOString(),
    isAuthoritative: true,
    skipFrontendDetection: true
  };
}

// ================================
// AI EXTRACTION WITH DUAL SYSTEM
// ================================

async function extractWithAI(text, aiProvider = 'deepseek', selectedPrompt = null) {
  console.log(`🤖 Starting AI extraction with ${aiProvider}, text length: ${text.length} characters`);
  
  // Detect document type if not specified in prompt
  const documentType = detectDocumentType(text);
  console.log(`📄 Detected document type: ${documentType}`);
  
  // Use selected prompt or determine appropriate prompt
  let prompt, responseStructure;
  
  if (selectedPrompt) {
    console.log(`📋 Using ${selectedPrompt.system} prompt: ${selectedPrompt.metadata.promptName}`);
    prompt = selectedPrompt.prompt;
    
    // Determine response structure based on document type
    if (documentType === 'proforma_invoice') {
      responseStructure = `
      {
        "proforma_invoice": {
          "piNumber": "string",
          "date": "string",
          "supplier": { 
            "name": "string", 
            "contact": "string",
            "email": "string",
            "phone": "string",
            "address": "string"
          },
          "buyer": { 
            "name": "string", 
            "contact": "string",
            "email": "string",
            "phone": "string",
            "address": "string"
          },
          "items": [
            {
              "lineNumber": number,
              "productCode": "string",
              "productName": "string",
              "brand": "string",
              "quantity": number,
              "unit": "string",
              "unitPrice": number,
              "totalPrice": number,
              "projectCode": "string (optional)"
            }
          ],
          "totals": {
            "subtotal": number,
            "freight": number,
            "totalCost": number,
            "currency": "string"
          },
          "terms": {
            "payment": "string",
            "delivery": "string",
            "packaging": "string"
          }
        }
      }`;
    } else {
      responseStructure = `
      {
        "purchase_order": {
          "poNumber": "string",
          "dateIssued": "string",
          "supplier": { "name": "string", "address": "string", "contact": "string" },
          "items": [
            {
              "lineNumber": number,
              "productCode": "string",
              "productName": "string (NOT UOM)",
              "quantity": number,
              "unit": "string",
              "unitPrice": number,
              "totalPrice": number,
              "projectCode": "string (e.g., FS-S3798, BWS-S1046)"
            }
          ],
          "totalAmount": number,
          "deliveryDate": "string",
          "paymentTerms": "string"
        }
      }`;
    }
  } else {
    // Fallback to legacy logic if no prompt selected
    const supplierInfo = identifySupplier(text);
    const legacyPrompt = getLegacyPrompt(supplierInfo, documentType, documentType);
    prompt = legacyPrompt.prompt;
    responseStructure = getResponseStructureForDocumentType(documentType);
  }

  // Add timeout for AI calls
  const aiTimeout = 120000; // 2 minutes for AI processing
  
  try {
    let result;
    const fullPrompt = prompt + '\n\nReturn a JSON object with this structure:\n' + responseStructure + '\n\nText to extract from:\n' + text;
    
    // Wrap AI calls in Promise.race with timeout
    result = await Promise.race([
      (async () => {
        switch (aiProvider) {
          case 'openai':
            if (!openai) throw new Error('OpenAI not configured');
            console.log('🔵 Calling OpenAI API...');
            const completion = await openai.chat.completions.create({
              model: 'gpt-4-turbo',
              messages: [
                { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
                { role: 'user', content: fullPrompt }
              ],
              temperature: selectedPrompt?.metadata?.temperature || 0.1,
              max_tokens: selectedPrompt?.metadata?.maxTokens || 2000,
              response_format: { type: "json_object" }
            });
            return JSON.parse(completion.choices[0].message.content);
            
          case 'anthropic':
            if (!anthropic) throw new Error('Anthropic not configured');
            console.log('🟣 Calling Anthropic API...');
            const message = await anthropic.messages.create({
              model: 'claude-3-opus-20240229',
              max_tokens: selectedPrompt?.metadata?.maxTokens || 1024,
              messages: [{ role: 'user', content: fullPrompt }],
              temperature: selectedPrompt?.metadata?.temperature || 0.1
            });
            return JSON.parse(message.content[0].text);
            
          case 'google':
            if (!genAI) throw new Error('Google AI not configured');
            console.log('🔴 Calling Google AI API...');
            const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
            const geminiResult = await model.generateContent(fullPrompt);
            const response = await geminiResult.response;
            return JSON.parse(response.text());
            
          case 'deepseek':
            if (!deepseek) throw new Error('DeepSeek not configured');
            console.log('🟢 Calling DeepSeek API...');
            const deepseekCompletion = await deepseek.chat.completions.create({
              model: 'deepseek-chat',
              messages: [
                { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
                { role: 'user', content: fullPrompt }
              ],
              temperature: selectedPrompt?.metadata?.temperature || 0.1,
              max_tokens: selectedPrompt?.metadata?.maxTokens || 2000,
              response_format: { type: "json_object" }
            });
            return JSON.parse(deepseekCompletion.choices[0].message.content);
            
          default:
            throw new Error('Invalid AI provider');
        }
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`AI extraction timeout after ${aiTimeout/1000} seconds`)), aiTimeout)
      )
    ]);
    
    console.log('✅ AI extraction completed successfully');
    return result;
  } catch (error) {
    console.error('❌ AI extraction error:', error.message);
    throw error;
  }
}

function getResponseStructureForDocumentType(documentType) {
  if (documentType === 'proforma_invoice') {
    return `
    {
      "proforma_invoice": {
        "piNumber": "string",
        "date": "string",
        "supplier": { "name": "string", "address": "string" },
        "items": [
          {
            "lineNumber": number,
            "productCode": "string",
            "productName": "string",
            "quantity": number,
            "unit": "string",
            "unitPrice": number,
            "totalPrice": number
          }
        ],
        "totalAmount": number
      }
    }`;
  } else {
    return `
    {
      "purchase_order": {
        "poNumber": "string",
        "dateIssued": "string",
        "supplier": { "name": "string", "address": "string" },
        "items": [
          {
            "lineNumber": number,
            "productCode": "string",
            "productName": "string",
            "quantity": number,
            "unit": "string",
            "unitPrice": number,
            "totalPrice": number,
            "projectCode": "string"
          }
        ],
        "totalAmount": number
      }
    }`;
  }
}

// ================================
// ENHANCED PROJECT CODE EXTRACTION
// ================================

function enhanceProjectCodes(extractedData, fullText) {
  console.log('🏢 Enhancing project codes extraction...');
  
  if (!extractedData.items) return extractedData;
  
  const projectCodePatterns = [
    /FS-S\d+/gi,        // PTP format: FS-S3798, FS-S3845
    /BWS-S\d+/gi,       // BWS format: BWS-S1046
    /[A-Z]{2,3}-[A-Z]\d+/gi, // Generic format: XX-X1234
    /Project\s*Code[:\s]+([A-Z0-9-]+)/gi,
    /Job\s*No[:\s]+([A-Z0-9-]+)/gi,
    /Ref[:\s]+([A-Z0-9-]+)/gi
  ];
  
  // Split full text into lines for better context matching
  const textLines = fullText.split('\n');
  
  extractedData.items = extractedData.items.map((item, index) => {
    let projectCode = item.projectCode || '';
    
    if (!projectCode) {
      // Strategy 1: Search in item's own text
      const itemText = [
        item.description,
        item.productName,
        item.notes,
        item.partNumber,
        item.part_number,
        item.productCode
      ].filter(Boolean).join(' ');
      
      for (const pattern of projectCodePatterns) {
        const match = itemText.match(pattern);
        if (match) {
          projectCode = match[0];
          console.log(`✅ Found project code in item text: ${projectCode} for item ${index + 1}`);
          break;
        }
      }
      
      // Strategy 2: Search in nearby text lines if still not found
      if (!projectCode && item.description) {
        for (let i = 0; i < textLines.length; i++) {
          const line = textLines[i];
          
          // If this line contains the item description or part number
          const searchTerms = [
            item.description?.substring(0, 20),
            item.partNumber,
            item.part_number,
            item.productCode
          ].filter(Boolean);
          
          const lineContainsItem = searchTerms.some(term => 
            line.includes(term) && term.length > 3
          );
          
          if (lineContainsItem) {
            // Check current line and next few lines for project codes
            for (let j = i; j < Math.min(i + 3, textLines.length); j++) {
              const searchLine = textLines[j];
              
              for (const pattern of projectCodePatterns) {
                const match = searchLine.match(pattern);
                if (match) {
                  projectCode = match[0];
                  console.log(`✅ Found project code in nearby line: ${projectCode} for item ${index + 1}`);
                  break;
                }
              }
              if (projectCode) break;
            }
          }
          if (projectCode) break;
        }
      }
    }
    
    console.log(`Item ${index + 1}: ${item.description?.substring(0, 30)}... → Project Code: ${projectCode || 'NOT FOUND'}`);
    
    return {
      ...item,
      projectCode: projectCode.trim(),
      // Ensure consistent field names for frontend
      productName: item.description || item.productName || '',
      productCode: item.partNumber || item.part_number || item.productCode || ''
    };
  });
  
  const foundCodes = extractedData.items.filter(item => item.projectCode).length;
  console.log(`🏢 Project code extraction complete: ${foundCodes}/${extractedData.items.length} items have project codes`);
  
  return extractedData;
}

// ================================
// ENHANCED MAIN EXTRACTION ENDPOINT
// ================================

exports.extractFromPDF = async (req, res) => {
  try {
    // Log request details
    console.log(`[${new Date().toISOString()}] 📄 PDF extraction request received`);
    console.log(`File: ${req.file?.originalname || 'No file'}, Size: ${req.file?.size ? (req.file.size / 1024 / 1024).toFixed(2) + 'MB' : 'N/A'}`);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Check file size
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (req.file.size > maxSize) {
      console.log(`❌ File too large: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is 10MB, your file is ${(req.file.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // Extract text from PDF with progress logging
    console.log('📖 Starting PDF text extraction...');
    const startTime = Date.now();
    
    const pdfBuffer = req.file.buffer;
    const pdfData = await pdfParse(pdfBuffer).catch(error => {
      console.error('❌ PDF parsing error:', error);
      throw new Error('Failed to parse PDF. The file may be corrupted or password protected.');
    });
    
    const extractedText = pdfData.text;
    const extractionTime = Date.now() - startTime;
    console.log(`✅ PDF parsed in ${extractionTime}ms. Text length: ${extractedText.length} characters, Pages: ${pdfData.numpages}`);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No text found in PDF'
      });
    }

    // NEW: Get user information and options for dual system
    const user = req.user || { 
      email: req.body.userEmail || req.query.userEmail || 'anonymous',
      role: req.body.userRole || req.query.userRole || 'user'
    };
    
    const options = {
      useNewPrompts: req.body.useNewPrompts, // Explicit user choice
      testMode: req.body.testMode || false,
      debug: req.body.debug || false
    };

    console.log(`👤 User: ${user.email}, Options:`, options);

    // Detect supplier and document type
    const supplierInfo = identifySupplier(extractedText);
    const documentType = detectDocumentType(extractedText);
    
    console.log(`🏢 Supplier: ${supplierInfo.supplier} (confidence: ${supplierInfo.confidence})`);
    console.log(`📋 Document type: ${documentType}`);

    // NEW: Select prompt system
    const promptSystem = selectPromptSystem(user, supplierInfo, options);
    
    // NEW: Get appropriate prompt
    const selectedPrompt = await getPromptForExtraction(
      promptSystem, 
      supplierInfo, 
      documentType, 
      user,
      'pdf'
    );

    console.log(`🎯 Using ${selectedPrompt.system} prompt system: ${selectedPrompt.metadata.promptName}`);

    // Determine which AI provider to use (in order of preference)
    let aiProvider = selectedPrompt.metadata?.aiProvider || 'deepseek'; // Use prompt's preferred provider
    
    // Fallback logic if specified provider not available
    if (aiProvider === 'deepseek' && !deepseek) aiProvider = 'openai';
    if (aiProvider === 'openai' && !openai) aiProvider = 'anthropic';
    if (aiProvider === 'anthropic' && !anthropic) aiProvider = 'google';
    if (aiProvider === 'google' && !genAI) aiProvider = 'deepseek';
    
    // Final check if no providers available
    if (!deepseek && !openai && !anthropic && !genAI) {
      return res.status(500).json({
        success: false,
        message: 'No AI service configured. Please set up API keys.'
      });
    }

    console.log(`🤖 Using AI provider: ${aiProvider} (${selectedPrompt.metadata?.aiProvider ? 'prompt preference' : 'fallback'})`);
    const aiStartTime = Date.now();

    // Extract structured data using AI with selected prompt
    const structuredData = await extractWithAI(extractedText, aiProvider, selectedPrompt).catch(error => {
      console.error('❌ AI extraction failed:', error);
      throw new Error('AI extraction failed. Please try again or contact support.');
    });
    
    const aiTime = Date.now() - aiStartTime;
    console.log(`✅ AI extraction completed in ${aiTime}ms`);

    // Apply project code enhancement
    console.log('🏢 Starting project code enhancement...');
    let enhancedStructuredData = structuredData;
    
    if (structuredData.purchase_order) {
      enhancedStructuredData.purchase_order = enhanceProjectCodes(structuredData.purchase_order, extractedText);
    } else if (structuredData.proforma_invoice) {
      enhancedStructuredData.proforma_invoice = enhanceProjectCodes(structuredData.proforma_invoice, extractedText);
    } else if (structuredData.items) {
      // Handle legacy format
      enhancedStructuredData = enhanceProjectCodes(structuredData, extractedText);
    }
    
    // Validate and enhance the extracted data
    let enhancedData;
    if (structuredData.proforma_invoice) {
      enhancedData = {
        ...structuredData.proforma_invoice,
        extractedAt: new Date().toISOString(),
        aiProvider: aiProvider,
        confidence: 0.85,
        documentType: 'proforma_invoice'
      };
    } else if (structuredData.purchase_order) {
      enhancedData = {
        ...structuredData.purchase_order,
        extractedAt: new Date().toISOString(),
        aiProvider: aiProvider,
        confidence: 0.85,
        documentType: 'purchase_order'
      };
    } else {
      // Legacy format support
      enhancedData = {
        ...structuredData,
        extractedAt: new Date().toISOString(),
        aiProvider: aiProvider,
        confidence: 0.85,
        documentType: documentType
      };
    }

    // Ensure items array exists and is properly formatted
    if (enhancedData.items) {
      enhancedData.items = enhancedData.items.map(item => ({
        ...item,
        productName: item.productName || 'Unknown Product',
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || (item.quantity * item.unitPrice),
        description: item.description || '',
        projectCode: item.projectCode || ''
      }));
    }

    // Calculate total if not provided
    if (!enhancedData.totalAmount && enhancedData.items) {
      enhancedData.totalAmount = enhancedData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    }

    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Total extraction time: ${totalTime}ms`);

    // Create authoritative classification
    const isScannedPDF = !extractedText || extractedText.trim().length < 100;
    const classification = createAuthoritativeClassification(enhancedData, extractedText, { 
      method: isScannedPDF ? 'vision_api' : 'text_extraction' 
    });

    console.log('✅ Backend authoritative classification:', classification.documentType);
    console.log('   Confidence:', classification.documentTypeConfidence);
    console.log('   Method:', classification.classificationMethod);

    // NEW: Enhanced response with dual system metadata
    res.json({
      success: true,
      data: enhancedData,
      classification: classification,
      documentType: classification.documentType,
      extraction_metadata: {
        system_used: selectedPrompt.system,
        prompt_id: selectedPrompt.metadata.promptId,
        prompt_name: selectedPrompt.metadata.promptName,
        prompt_version: selectedPrompt.metadata.version,
        supplier_detected: supplierInfo.supplier,
        supplier_confidence: supplierInfo.confidence,
        user_email: user.email,
        processing_time: totalTime,
        ai_provider: aiProvider,
        ai_provider_requested: selectedPrompt.metadata?.aiProvider,
        confidence_score: 0.85,
        timestamp: new Date().toISOString(),
        document_type: classification.documentType,
        extraction_method: documentType === 'proforma_invoice' ? 'PI_ENHANCED' : 
                          supplierInfo.supplier === 'PTP' ? 'PTP_TEMPLATE' : 'GENERIC',
        classification: classification,
        prompt_system_config: {
          default_mode: PROMPT_SYSTEM_CONFIG.defaultMode,
          ab_testing_enabled: PROMPT_SYSTEM_CONFIG.enableABTesting,
          test_percentage: PROMPT_SYSTEM_CONFIG.testPercentage,
          user_is_test_user: PROMPT_SYSTEM_CONFIG.testUsers.includes(user.email)
        }
      },
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        pagesCount: pdfData.numpages,
        textLength: extractedText.length,
        processingTime: {
          pdfParsing: extractionTime,
          aiExtraction: aiTime,
          total: totalTime
        }
      }
    });

  } catch (error) {
    console.error('❌ PDF extraction error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract data from PDF',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ================================
// NEW: DUAL SYSTEM API ENDPOINTS
// ================================

exports.getPromptSystemStatus = async (req, res) => {
  try {
    const user = req.user || { 
      email: req.query.userEmail || 'anonymous',
      role: req.query.userRole || 'user'
    };
    const supplierInfo = { name: req.query.supplier || 'TEST_SUPPLIER' };
    
    const promptSystem = selectPromptSystem(user, supplierInfo, {});
    const selectedPrompt = await getPromptForExtraction(
      promptSystem, 
      supplierInfo, 
      'purchase_order', 
      user,
      'pdf'
    );
    
    // Get system statistics
    const legacyPrompts = 4; // Base + PTP + PI + Generic variants
    const mcpPrompts = await mcpPromptService.getPromptCount();
    
    res.json({
      success: true,
      current_system: promptSystem,
      selected_prompt: selectedPrompt.metadata,
      system_stats: {
        legacy_prompts: legacyPrompts,
        mcp_prompts: mcpPrompts,
        test_users: PROMPT_SYSTEM_CONFIG.testUsers.length,
        test_percentage: PROMPT_SYSTEM_CONFIG.testPercentage
      },
      user_info: {
        email: user.email,
        role: user.role,
        is_test_user: PROMPT_SYSTEM_CONFIG.testUsers.includes(user.email)
      },
      config: {
        default_mode: PROMPT_SYSTEM_CONFIG.defaultMode,
        ab_testing_enabled: PROMPT_SYSTEM_CONFIG.enableABTesting,
        fallback_enabled: PROMPT_SYSTEM_CONFIG.fallbackToLegacy
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.setPromptSystemPreference = async (req, res) => {
  try {
    const { userEmail, promptSystem, permanent = false } = req.body;
    
    // Validate input
    if (!userEmail || !promptSystem) {
      return res.status(400).json({
        success: false,
        error: 'userEmail and promptSystem are required'
      });
    }
    
    if (!['legacy', 'mcp', 'auto'].includes(promptSystem)) {
      return res.status(400).json({
        success: false,
        error: 'promptSystem must be one of: legacy, mcp, auto'
      });
    }
    
    console.log(`🎛️ User preference set: ${userEmail} -> ${promptSystem} (permanent: ${permanent})`);
    
    res.json({
      success: true,
      message: `Prompt system preference set to ${promptSystem} for ${userEmail}`,
      setting: {
        userEmail,
        promptSystem,
        permanent,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.getPromptSystemAnalytics = async (req, res) => {
  try {
    // Mock analytics for now - you can replace with real data later
    const mockAnalytics = {
      daily_extractions: {
        legacy_system: { count: 45, avg_accuracy: 92, avg_speed: 2.3 },
        mcp_system: { count: 12, avg_accuracy: 96, avg_speed: 2.1 }
      },
      user_distribution: {
        legacy_users: 23,
        mcp_users: 3,
        ab_test_users: 2
      },
      performance_comparison: {
        accuracy_improvement: '+4%',
        speed_improvement: '+8%',
        recommendation: 'Expand MCP system usage'
      },
      top_prompts: [
        { id: 'legacy_base_extraction', name: 'Base Legacy Template', usage: 45, accuracy: 92 },
        { id: 'legacy_ptp_specific', name: 'PTP Legacy Template', usage: 12, accuracy: 96 }
      ]
    };
    
    res.json({
      success: true,
      analytics: mockAnalytics,
      timestamp: new Date().toISOString(),
      period: 'last_7_days'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ================================
// TESTING ENDPOINTS
// ================================

exports.testExtraction = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Test extraction endpoint - implementation coming soon',
      data: null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.batchComparisonTest = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Batch comparison test endpoint - implementation coming soon',
      data: null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ================================
// EXISTING ENDPOINTS (UNCHANGED)
// ================================

exports.extractFromImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No image uploaded' 
      });
    }

    res.json({
      success: false,
      message: 'OCR functionality coming soon. Please upload a PDF instead.',
      data: null
    });

  } catch (error) {
    console.error('Image extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract data from image'
    });
  }
};

exports.extractFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No Excel file uploaded' 
      });
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);

    // Process Excel data into our format
    const structuredData = processExcelData(jsonData);

    res.json({
      success: true,
      data: structuredData,
      metadata: {
        fileName: req.file.originalname,
        rowCount: jsonData.length,
        sheetName: sheetName
      }
    });

  } catch (error) {
    console.error('Excel extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract data from Excel'
    });
  }
};

function processExcelData(rows) {
  const items = rows.map(row => ({
    productName: row['Product'] || row['Item'] || row['Description'] || '',
    quantity: parseInt(row['Quantity'] || row['Qty'] || 1),
    unitPrice: parseFloat(row['Unit Price'] || row['Price'] || 0),
    totalPrice: parseFloat(row['Total'] || row['Amount'] || 0),
    description: row['Description'] || row['Notes'] || ''
  }));

  const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);

  return {
    orderNumber: rows[0]?.['PO Number'] || rows[0]?.['Order Number'] || '',
    clientName: rows[0]?.['Client'] || rows[0]?.['Customer'] || '',
    supplierName: rows[0]?.['Supplier'] || rows[0]?.['Vendor'] || '',
    orderDate: rows[0]?.['Date'] || new Date().toISOString().split('T')[0],
    items: items,
    totalAmount: totalAmount,
    extractedAt: new Date().toISOString(),
    confidence: 0.9
  };
}

exports.extractFromEmail = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No email file uploaded' 
      });
    }

    res.json({
      success: false,
      message: 'Email extraction functionality coming soon. Please upload a PDF, Excel, or image file instead.',
      data: null
    });

  } catch (error) {
    console.error('Email extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract data from email'
    });
  }
};

exports.extractBankPaymentSlip = async (req, res) => {
  try {
    console.log('🏦 TRUE MCP Bank Payment Extraction Starting...');

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    const startTime = Date.now();
    
    // 🔍 Get user context for MCP system routing
    const userEmail = req.headers['x-user-email'] || 
                      req.body.userEmail || 
                      req.body.user_email ||
                      (req.body.user ? JSON.parse(req.body.user).email : null) ||
                      'anonymous';
    
    const userContext = {
      email: userEmail,
      role: req.body.userRole || 'user',
      uid: req.body.uid || 'anonymous'
    };
    
    const isTestUser = userEmail === 'edisonchung@flowsolution.net';
    
    console.log(`👤 Processing bank payment for: ${userEmail}`);
    console.log(`🧪 Is Test User: ${isTestUser}`);

    // Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = pdfData.text;
    
    console.log('📄 Extracted text length:', extractedText.length);

    let aiResponse;
    let systemUsed = 'legacy';
    let promptUsed = 'hardcoded_legacy';
    let promptMetadata = null;

    // 🚀 TRUE MCP SYSTEM INTEGRATION
    if (isTestUser) {
      try {
        console.log('🚀 Attempting TRUE MCP System Integration...');
        
        // 🎯 STEP 1: Query MCP Prompt Service for bank payment prompts
        console.log('📋 Querying MCPPromptService for bank payment prompts...');
        
        const mcpPrompt = await mcpPromptService.getPromptForTask(
          'document_extraction',  // moduleId
          'bank_payment',         // category - this should match your prompt category
          {
            supplier: 'BANK_PAYMENT',
            user: userContext,
            documentType: 'bank_payment_slip',
            filename: req.file.originalname
          }
        );

        console.log('🔍 MCP Prompt Service Response:', {
          promptFound: !!mcpPrompt,
          promptName: mcpPrompt?.name,
          isActive: mcpPrompt?.isActive,
          category: mcpPrompt?.category
        });

        if (mcpPrompt && mcpPrompt.isActive !== false) {
          console.log('✅ MCP Prompt Found:', {
            name: mcpPrompt.name,
            id: mcpPrompt.id,
            category: mcpPrompt.category,
            version: mcpPrompt.version,
            aiProvider: mcpPrompt.aiProvider
          });

          // 🎯 STEP 2: Use the actual MCP prompt for extraction
          systemUsed = 'mcp_true';
          promptUsed = mcpPrompt.name;
          promptMetadata = {
            promptId: mcpPrompt.id,
            promptName: mcpPrompt.name,
            category: mcpPrompt.category,
            version: mcpPrompt.version,
            aiProvider: mcpPrompt.aiProvider,
            temperature: mcpPrompt.temperature,
            maxTokens: mcpPrompt.maxTokens
          };

          // 🚀 STEP 3: Execute AI extraction with MCP prompt
          console.log(`🤖 Executing AI extraction with MCP prompt: ${mcpPrompt.name}`);
          console.log(`🎯 Using AI Provider: ${mcpPrompt.aiProvider || 'deepseek'}`);
          
          const aiProvider = mcpPrompt.aiProvider || 'deepseek';
          const fullPrompt = mcpPrompt.prompt + '\n\nExtract from this bank payment slip text:\n\n' + extractedText;

          // Call the appropriate AI service
          let aiResult;
          if (aiProvider === 'deepseek' && deepseek) {
            const completion = await deepseek.chat.completions.create({
              model: "deepseek-chat",
              messages: [
                { role: "user", content: fullPrompt }
              ],
              temperature: mcpPrompt.temperature || 0.1,
              max_tokens: mcpPrompt.maxTokens || 2500
            });
            aiResult = completion.choices[0].message.content.trim();
          } else if (aiProvider === 'openai' && openai) {
            const completion = await openai.chat.completions.create({
              model: 'gpt-4-turbo',
              messages: [
                { role: "user", content: fullPrompt }
              ],
              temperature: mcpPrompt.temperature || 0.1,
              max_tokens: mcpPrompt.maxTokens || 2500
            });
            aiResult = completion.choices[0].message.content.trim();
          } else {
            throw new Error(`AI provider ${aiProvider} not available or not configured`);
          }

          // Parse AI response
          console.log('🤖 Raw AI Response (first 200 chars):', aiResult.substring(0, 200) + '...');
          
          const cleanedResponse = aiResult
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

          aiResponse = JSON.parse(cleanedResponse);
          
          console.log('✅ TRUE MCP Extraction Successful!');
          console.log('📊 Using dynamic prompt from UI:', mcpPrompt.name);
          console.log('💰 Extracted amounts:', {
            payment: aiResponse.bank_payment?.payment_amount,
            debit: aiResponse.bank_payment?.debit_amount,
            rate: aiResponse.bank_payment?.exchange_rate
          });
          
        } else {
          console.log('❌ No active MCP prompt found for bank_payment category');
          console.log('🔍 Available categories in system:', 'Run GET /api/ai/prompts to see all');
          console.log('🔄 Falling back to legacy system...');
          throw new Error('No MCP prompt available - falling back to legacy');
        }
        
      } catch (mcpError) {
        console.error('❌ TRUE MCP extraction failed:', mcpError.message);
        console.log('🔄 Falling back to enhanced legacy system...');
        // Fall through to legacy system
      }
    }

    // 🔄 LEGACY SYSTEM FALLBACK (Only if MCP fails or user not in test group)
    if (systemUsed === 'legacy') {
      console.log('🔧 Using Enhanced Legacy System (hardcoded prompts)...');
      
      // Your existing hardcoded prompt logic
      const enhancedLegacyPrompt = `
You are an expert at extracting structured data from Hong Leong Bank payment slips.

CRITICAL AMOUNT DETECTION RULES (FIXED LOGIC):
1. **Payment Amount (USD)**: The SMALLER amount being sent to beneficiary
   - Look for: "USD 645.00", "Payment: USD 645", "Foreign Currency: USD 645"
   - This goes to beneficiary (international recipient)
   - Usually the SMALLER numerical value
   
2. **Debit Amount (MYR)**: The LARGER amount charged from sender's account  
   - Look for: "MYR 2,866.38", "Total Debit: 2866.38", "Amount: 2,866.38"
   - This is deducted from sender's local account
   - Usually the LARGER numerical value
   
3. **Exchange Rate**: Calculate as debit_amount ÷ payment_amount
   - Example: 2866.38 ÷ 645 = 4.44 (MYR per USD)
   - Should be reasonable (4.0-5.0 for USD-MYR)

VALIDATION CHECKS:
- payment_amount × exchange_rate ≈ debit_amount (±5% tolerance)
- Payment amount should be SMALLER than debit amount
- Both amounts must be positive numbers > 0

Extract the following information from this bank payment slip text:

Text:
${extractedText}

Return JSON in this exact format:
{
  "bank_payment": {
    "reference_number": "C716070725163829",
    "payment_date": "07/07/2025",
    "payment_amount": 645.00,
    "paid_currency": "USD",
    "debit_amount": 2866.38,
    "debit_currency": "MYR",
    "exchange_rate": 4.44,
    "bank_name": "Hong Leong Bank",
    "account_number": "17301010259",
    "account_name": "FLOW SOLUTION SDN BH",
    "beneficiary_name": "Shenzhen Ou Fade Electronics Co., Ltd.",
    "beneficiary_bank": "JPMorgan Chase Bank NA",
    "beneficiary_country": "HONG KONG",
    "payment_details": "PI-OFD20250624",
    "bank_charges": 50.00,
    "status": "Post-dated"
  },
  "confidence": 0.95,
  "document_type": "bank_payment_slip"
}

CRITICAL: 
- payment_amount should be the SMALLER amount (USD to beneficiary)
- debit_amount should be the LARGER amount (MYR from sender account)
- If amounts seem reversed, swap them and recalculate exchange rate

Return ONLY the JSON object, no explanations or markdown.
      `;

      // Call AI service with hardcoded prompt
      if (deepseek) {
        const completion = await deepseek.chat.completions.create({
          model: "deepseek-chat",
          messages: [{ role: "user", content: enhancedLegacyPrompt }],
          temperature: 0.1,
          max_tokens: 2500
        });

        const aiResult = completion.choices[0].message.content.trim();
        const cleanedResponse = aiResult.replace(/```json/g, '').replace(/```/g, '').trim();
        aiResponse = JSON.parse(cleanedResponse);
        
        systemUsed = isTestUser ? 'legacy_enhanced_fallback' : 'legacy_enhanced';
        promptUsed = 'hardcoded_legacy_v2';
        
        console.log('✅ Legacy system extraction completed');
      }
    }

    const extractionTime = Date.now() - startTime;

    // 🎯 TRUE SYSTEM REPORTING
    const response = {
      success: true,
      data: aiResponse,
      processing_time: extractionTime,
      metadata: {
        file_name: req.file.originalname,
        file_size: req.file.size,
        extraction_method: 'ai_extraction',
        processed_at: new Date().toISOString(),
        
        // 🚀 TRUE MCP METADATA
        system_used: systemUsed,  // Will be 'mcp_true', 'legacy_enhanced_fallback', or 'legacy_enhanced'
        prompt_used: promptUsed,  // Actual prompt name from UI or 'hardcoded_legacy_v2'
        user_email: userEmail,
        is_test_user: isTestUser,
        
        // 🎯 MCP-specific metadata (only if MCP was actually used)
        ...(promptMetadata ? {
          mcp_prompt_id: promptMetadata.promptId,
          mcp_prompt_name: promptMetadata.promptName,
          mcp_prompt_category: promptMetadata.category,
          mcp_prompt_version: promptMetadata.version,
          mcp_ai_provider: promptMetadata.aiProvider,
          mcp_status: 'active_prompt_used_successfully'
        } : {
          mcp_status: isTestUser ? 'no_active_prompts_found_in_category' : 'user_not_in_test_group'
        }),
        
        // Amount validation
        amount_validation: {
          payment_amount: aiResponse.bank_payment?.payment_amount,
          debit_amount: aiResponse.bank_payment?.debit_amount,
          exchange_rate: aiResponse.bank_payment?.exchange_rate,
          amounts_logical: (aiResponse.bank_payment?.payment_amount || 0) < (aiResponse.bank_payment?.debit_amount || 0),
          rate_reasonable: (aiResponse.bank_payment?.exchange_rate || 0) >= 4.0 && (aiResponse.bank_payment?.exchange_rate || 0) <= 5.0
        }
      }
    };

    // 🚀 CLEAR SYSTEM STATUS LOGGING
    if (systemUsed === 'mcp_true') {
      console.log('🎉 TRUE MCP SYSTEM SUCCESS: Using actual prompt from Prompt Management UI!');
      console.log('📝 MCP Details:', {
        prompt_name: promptMetadata.promptName,
        prompt_id: promptMetadata.promptId,
        prompt_category: promptMetadata.category,
        ai_provider: promptMetadata.aiProvider,
        processing_time: `${extractionTime}ms`,
        status: 'Fully integrated MCP system operational'
      });
    } else if (systemUsed.includes('legacy_enhanced')) {
      console.log('🔧 Enhanced Legacy System: Using hardcoded prompts (MCP fallback)');
      console.log('💡 Reason: No active MCP prompts found in bank_payment category');
    } else {
      console.log('🔧 Basic Legacy System: Standard processing');
    }
    
    res.json(response);

  } catch (error) {
    console.error('❌ Bank payment extraction error:', error);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract bank payment data',
      metadata: {
        system_used: 'error',
        user_email: req.headers['x-user-email'] || 'unknown',
        is_test_user: false,
        processed_at: new Date().toISOString(),
        error_type: error.name || 'UnknownError'
      }
    });
  }
};
