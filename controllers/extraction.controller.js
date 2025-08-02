const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const { identifySupplier } = require('../utils/supplierTemplates');

// NEW: Import MCP Prompt Service
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
// ENHANCED PI EXTRACTION FUNCTIONS (UNCHANGED)
// ================================

/**
 * Detect document type from content
 */
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

/**
 * Enhanced Proforma Invoice extraction specifically for Chinese suppliers
 */
function extractProformaInvoiceItems(text) {
  console.log('=== ENHANCED PI TABLE EXTRACTION ===');
  
  const items = [];
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  let inItemsSection = false;
  let headerRowIndex = -1;
  
  // Find the items table section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    // Detect start of items table - Chinese supplier format
    if ((line.includes('sr no') || line.includes('sr.no')) && 
        line.includes('items name') && 
        (line.includes('model') || line.includes('brand'))) {
      inItemsSection = true;
      headerRowIndex = i;
      console.log(`Found PI table header at line ${i}: ${lines[i]}`);
      continue;
    }
    
    // Alternative header detection
    if (line.includes('quantity') && line.includes('unit price') && line.includes('total price')) {
      inItemsSection = true;
      headerRowIndex = i;
      console.log(`Found alternative PI table header at line ${i}: ${lines[i]}`);
      continue;
    }
    
    // Detect end of items table
    if (inItemsSection && (
        line.includes('total') && (line.includes('$') || line.includes('usd')) ||
        line.includes('freight') ||
        line.includes('terms and conditions') ||
        line.includes('payment terms')
      )) {
      console.log(`End of PI table at line ${i}: ${lines[i]}`);
      break;
    }
    
    // Extract item rows
    if (inItemsSection && headerRowIndex > -1) {
      // Look for lines that start with a number (Sr NO)
      const itemNumberMatch = line.match(/^(\d+)\s+(.+)/);
      
      if (itemNumberMatch) {
        const srNo = parseInt(itemNumberMatch[1]);
        const remainingText = itemNumberMatch[2];
        
        console.log(`Processing PI item ${srNo}: ${remainingText}`);
        
        const item = parsePIItemRow(srNo, remainingText, lines, i);
        
        if (item) {
          items.push(item);
          console.log(`Extracted PI item:`, item);
        }
      }
    }
  }
  
  console.log(`Total PI items extracted: ${items.length}`);
  return items;
}

/**
 * Parse a single PI item row with enhanced pattern matching for Chinese suppliers
 */
function parsePIItemRow(srNo, rowText, allLines, currentIndex) {
  try {
    // Handle multi-line item descriptions
    let fullItemText = rowText;
    
    // Check if next line might be continuation (no leading number)
    if (currentIndex + 1 < allLines.length) {
      const nextLine = allLines[currentIndex + 1].trim();
      if (nextLine && !nextLine.match(/^\d+\s+/) && !nextLine.toLowerCase().includes('total')) {
        fullItemText += ' ' + nextLine;
        console.log(`Combined with next line: ${fullItemText}`);
      }
    }
    
    // Enhanced regex patterns for Chinese supplier PI formats
    const patterns = [
      // Pattern 1: BEARING 32222 SKF 100 $ 13.00 7.43KG $ 1,300.00 743KG
      /^(\w+)\s+([A-Z0-9\/-]+)\s+([A-Z]+)\s+(\d+)\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG/i,
      
      // Pattern 2: BEARING HM518445/10 SKF 100 $ 6.00 2.88KG $ 600.00 288KG
      /^(\w+)\s+([A-Z0-9\/-]+)\s+([A-Z]+)\s+(\d+)\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG/i,
      
      // Pattern 3: BEARING 6309-2Z SKF 10 $ 4.63 0.88KG $ 46.31 8.8KG
      /^(\w+)\s+([A-Z0-9\/-Z]+)\s+([A-Z]+)\s+(\d+)\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG\s+\$\s*([\d,]+\.?\d*)\s+([\d.]+)KG/i,
      
      // Pattern 4: For items without clear separators
      /(\w+)\s+([A-Z0-9\/-Z]+)\s+([A-Z]+).*?(\d+).*?\$\s*([\d,]+\.?\d*).*?\$\s*([\d,]+\.?\d*)/i,
      
      // Pattern 5: More flexible pattern for complex models
      /^(\w+)\s+([A-Z0-9\/-]+(?:\s[A-Z0-9\/-]+)*)\s+([A-Z]+)\s+(\d+)\s+\$\s*([\d,]+\.?\d*).*?\$\s*([\d,]+\.?\d*)/i
    ];
    
    for (const pattern of patterns) {
      const match = fullItemText.match(pattern);
      
      if (match) {
        const [, itemType, model, brand, quantity, unitPriceStr, , totalPriceStr] = match;
        
        // Clean and parse numbers
        const qty = parseInt(quantity) || 0;
        const unitPrice = parseFloat(unitPriceStr.replace(/,/g, '')) || 0;
        const totalPrice = parseFloat(totalPriceStr.replace(/,/g, '')) || 0;
        
        const item = {
          lineNumber: srNo,
          productCode: model.trim(),
          productName: `${itemType} ${model}`.trim(),
          brand: brand.trim(),
          quantity: qty,
          unit: 'PCS',
          unitPrice: unitPrice,
          totalPrice: totalPrice,
          
          // Additional fields for PI
          category: itemType.toLowerCase(),
          specifications: fullItemText // Keep original for reference
        };
        
        console.log(`Successfully parsed PI item ${srNo}:`, item);
        return item;
      }
    }
    
    // Fallback: extract what we can
    console.log(`Using fallback parsing for PI item ${srNo}: ${fullItemText}`);
    
    // Extract numbers and basic info
    const numbers = fullItemText.match(/[\d,]+\.?\d*/g) || [];
    const words = fullItemText.split(/\s+/).filter(w => w.length > 0);
    
    return {
      lineNumber: srNo,
      productCode: extractProductCode(words),
      productName: extractProductName(words),
      brand: extractBrand(words),
      quantity: numbers.length > 0 ? parseInt(numbers[0].replace(/,/g, '')) : 1,
      unit: 'PCS',
      unitPrice: numbers.length > 1 ? parseFloat(numbers[1].replace(/,/g, '')) : 0,
      totalPrice: numbers.length > 2 ? parseFloat(numbers[2].replace(/,/g, '')) : 0,
      specifications: fullItemText
    };
    
  } catch (error) {
    console.error(`Error parsing PI item ${srNo}:`, error);
    return null;
  }
}

/**
 * Helper functions for fallback parsing
 */
function extractProductCode(words) {
  // Look for alphanumeric codes (like 32222, HM518445/10, 6309-2Z)
  for (const word of words) {
    if (/^[A-Z0-9\/-]+$/i.test(word) && word.length > 2) {
      return word;
    }
  }
  return words[1] || '';
}

function extractProductName(words) {
  // Usually starts with the item type (BEARING, etc.)
  const itemType = words.find(w => /^[A-Z]+$/i.test(w) && w.length > 3);
  const productCode = extractProductCode(words);
  
  if (itemType && productCode) {
    return `${itemType} ${productCode}`;
  }
  
  return words.slice(0, 3).join(' ');
}

function extractBrand(words) {
  // Common bearing brands
  const knownBrands = ['SKF', 'FAG', 'NSK', 'TIMKEN', 'NTN', 'KOYO', 'MCGILL'];
  
  for (const word of words) {
    if (knownBrands.includes(word.toUpperCase())) {
      return word.toUpperCase();
    }
  }
  
  return '';
}

/**
 * Extract PI-specific information
 */
function extractPIInfo(text) {
  console.log('Extracting PI-specific information...');
  
  const piData = {
    documentType: 'proforma_invoice'
  };
  
  // Extract PI/Quote number
  const piNumberPatterns = [
    /QUOTE NO\.?:\s*([A-Z0-9-]+)/i,
    /PI NO\.?:\s*([A-Z0-9-]+)/i,
    /INVOICE NO\.?:\s*([A-Z0-9-]+)/i,
    /PROFORMA NO\.?:\s*([A-Z0-9-]+)/i
  ];
  
  for (const pattern of piNumberPatterns) {
    const match = text.match(pattern);
    if (match) {
      piData.piNumber = match[1];
      break;
    }
  }
  
  // Extract date
  const dateMatch = text.match(/DATE:\s*(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
  if (dateMatch) {
    piData.date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }
  
  // Extract supplier info
  piData.supplier = extractSupplierInfo(text);
  
  // Extract buyer info
  piData.buyer = extractBuyerInfo(text);
  
  // Extract items using enhanced method
  piData.items = extractProformaInvoiceItems(text);
  
  // Extract totals
  piData.totals = extractPITotals(text);
  
  // Extract terms
  piData.terms = extractPITerms(text);
  
  console.log(`PI extraction complete. Found ${piData.items.length} items.`);
  return piData;
}

function extractSupplierInfo(text) {
  const lines = text.split('\n');
  let inShipperSection = false;
  const supplier = {};
  
  for (const line of lines) {
    if (line.includes('SHIPPER') || line.includes('SELLER')) {
      inShipperSection = true;
      continue;
    }
    
    if (line.includes('RECEIVER') || line.includes('BUYER')) {
      inShipperSection = false;
      continue;
    }
    
    if (inShipperSection) {
      if (line.includes('Company Name:')) {
        supplier.name = line.replace(/Company Name:\s*/, '').trim();
      } else if (line.includes('Contact Person:')) {
        supplier.contact = line.replace(/Contact Person:\s*/, '').trim();
      } else if (line.includes('E-MAIL:') || line.includes('Email:')) {
        supplier.email = line.replace(/E-MAIL:\s*/, '').replace(/Email:\s*/, '').trim();
      } else if (line.includes('Phone:')) {
        supplier.phone = line.replace(/Phone:\s*/, '').trim();
      } else if (line.includes('Address:')) {
        supplier.address = line.replace(/Address:\s*/, '').trim();
      }
    }
  }
  
  return supplier;
}

function extractBuyerInfo(text) {
  const lines = text.split('\n');
  let inReceiverSection = false;
  const buyer = {};
  
  for (const line of lines) {
    if (line.includes('RECEIVER') || line.includes('BUYER')) {
      inReceiverSection = true;
      continue;
    }
    
    if (line.includes('TERMS AND CONDITIONS') || line.includes('Sr NO')) {
      inReceiverSection = false;
      continue;
    }
    
    if (inReceiverSection) {
      if (line.includes('Company Name:')) {
        buyer.name = line.replace(/Company Name:\s*/, '').trim();
      } else if (line.includes('Contact Person:')) {
        buyer.contact = line.replace(/Contact Person:\s*/, '').trim();
      } else if (line.includes('Email:')) {
        buyer.email = line.replace(/Email:\s*/, '').trim();
      } else if (line.includes('PH:')) {
        buyer.phone = line.replace(/PH:\s*/, '').trim();
      } else if (line.includes('Address:')) {
        buyer.address = line.replace(/Address:\s*/, '').trim();
      }
    }
  }
  
  return buyer;
}

function extractPITotals(text) {
  const subtotalMatch = text.match(/TOTAL\s+\$\s*([\d,]+\.?\d*)/i);
  const freightMatch = text.match(/FREIGHT\s+\$\s*([\d,]+\.?\d*)/i);
  const totalCostMatch = text.match(/TOTAL COST\s+\$\s*([\d,]+\.?\d*)/i);
  
  return {
    subtotal: subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, '')) : 0,
    freight: freightMatch ? parseFloat(freightMatch[1].replace(/,/g, '')) : 0,
    totalCost: totalCostMatch ? parseFloat(totalCostMatch[1].replace(/,/g, '')) : 0,
    currency: 'USD'
  };
}

function extractPITerms(text) {
  const paymentMatch = text.match(/Terms of payment[：:]\s*([^;\n]+)/i);
  const deliveryMatch = text.match(/Delivery time[：:]\s*([^;\n]+)/i);
  const brandMatch = text.match(/Brand[：:]\s*([^;\n]+)/i);
  const packagingMatch = text.match(/Packaging[：:]\s*([^;\n]+)/i);
  
  return {
    payment: paymentMatch ? paymentMatch[1].trim() : '',
    delivery: deliveryMatch ? deliveryMatch[1].trim() : '',
    brand: brandMatch ? brandMatch[1].trim() : '',
    packaging: packagingMatch ? packagingMatch[1].trim() : ''
  };
}

// Apply PTP-specific post-processing rules
const applyPTPRules = (extractedData, originalText) => {
  if (extractedData.items) {
    extractedData.items = extractedData.items.map(item => {
      // Fix common PTP extraction errors
      if (['PCS', 'UNI', 'SET', 'EA', 'UNIT'].includes(item.productName)) {
        console.log(`Fixing PTP extraction: "${item.productName}" is not a valid product name`);
        
        // Try to find the real product name
        const lines = originalText.split('\n');
        const codeLineIndex = lines.findIndex(line => 
          item.productCode && line.includes(item.productCode)
        );
        
        if (codeLineIndex !== -1 && codeLineIndex < lines.length - 1) {
          const nextLine = lines[codeLineIndex + 1].trim();
          if (nextLine && 
              !['PCS', 'UNI', 'SET', 'EA'].includes(nextLine) && 
              !/^\d+\.?\d*$/.test(nextLine) && // Not just numbers
              nextLine.length > 2) {
            item.productName = nextLine;
            console.log(`Fixed product name to: "${nextLine}"`);
          }
        }
      }
      
      return item;
    });
  }
  
  // Ensure supplier name is correct for PTP
  if (extractedData.supplier) {
    extractedData.supplier.name = 'PT. PERINTIS TEKNOLOGI PERDANA';
  }
  
  return extractedData;
};

// Enhanced AI extraction with document type detection and dual system support
async function extractWithAI(text, aiProvider = 'deepseek', selectedPrompt = null) {
  console.log(`🤖 Starting AI extraction with ${aiProvider}, text length: ${text.length} characters`);
  
  // Detect document type if not specified in prompt
  const documentType = detectDocumentType(text);
  console.log(`📄 Detected document type: ${documentType}`);
  
  // If it's a PI and we're using legacy system, use enhanced PI extraction first
  if (documentType === 'proforma_invoice' && (!selectedPrompt || selectedPrompt.system === 'legacy')) {
    console.log('📊 Using enhanced PI extraction method...');
    try {
      const piData = extractPIInfo(text);
      if (piData.items && piData.items.length > 0) {
        console.log(`✅ Enhanced PI extraction successful: ${piData.items.length} items found`);
        return {
          proforma_invoice: piData
        };
      }
    } catch (error) {
      console.log('⚠️ Enhanced PI extraction failed, falling back to AI:', error.message);
    }
  }
  
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
    
    // Apply PTP-specific post-processing if needed
    const supplierInfo = identifySupplier(text);
    if (supplierInfo.supplier === 'PTP') {
      console.log('🔧 Applying PTP-specific rules...');
      if (result.purchase_order) {
        result.purchase_order = applyPTPRules(result.purchase_order, text);
      }
    }
    
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
// ENHANCED MAIN EXTRACTION ENDPOINT
// ================================

// Main extraction endpoint with dual system support
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

    // NEW: Enhanced response with dual system metadata
    res.json({
      success: true,
      data: enhancedData,
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
        document_type: documentType,
        extraction_method: documentType === 'proforma_invoice' ? 'PI_ENHANCED' : 
                          supplierInfo.supplier === 'PTP' ? 'PTP_TEMPLATE' : 'GENERIC',
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

    // NEW: Track usage analytics (fire and forget)
    if (PROMPT_SYSTEM_CONFIG.analytics.trackUsage) {
      trackExtractionUsage(selectedPrompt, user, supplierInfo, {
        success: true,
        processingTime: totalTime,
        aiProvider: aiProvider,
        documentType: documentType
      }).catch(error => console.warn('📊 Analytics tracking failed:', error.message));
    }

  } catch (error) {
    console.error('❌ PDF extraction error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract data from PDF',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Fallback pattern-based extraction for bank payment slips
 */
function extractBankPaymentFallback(text) {
  console.log('🔄 Using pattern-based fallback extraction');

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Helper function to extract field values
  const extractField = (patterns, defaultValue = null) => {
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    
    for (const pattern of patternArray) {
      for (const line of lines) {
        const match = line.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
    return defaultValue;
  };

  // Helper function to extract amounts
  const extractAmount = (patterns) => {
    const amountStr = extractField(patterns);
    if (!amountStr) return null;
    
    const cleanAmount = amountStr.replace(/[^\d.-]/g, '');
    const amount = parseFloat(cleanAmount);
    return isNaN(amount) ? null : amount;
  };

  // Extract data using patterns
  const referenceNumber = extractField([
    /Reference Number[:\s]*([A-Z0-9]+)/i,
    /([C][0-9]{12,})/i
  ]);

  const paymentDate = extractField([
    /Payment Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/i
  ]);

  const paidAmount = extractAmount([
    /Debit Amount[:\s]*([0-9.,]+).*?USD/i,
    /([0-9.,]+).*?USD/i
  ]);

  const debitAmount = extractAmount([
    /Payment Amount[:\s]*([0-9.,]+).*?MYR/i,
    /([0-9.,]+).*?MYR/i
  ]);

  const exchangeRate = extractAmount([
    /Exchange Rate[:\s]*([0-9.,]+)/i
  ]);

  const beneficiaryName = extractField([
    /Beneficiary Name[:\s]*(.+?)(?:\n|$)/i,
    /Beneficiary[:\s]*(.+?)(?:\n|$)/i
  ]);

  const paymentDetails = extractField([
    /Payment Details[:\s]*(.+?)(?:\n|$)/i,
    /Details[:\s]*(.+?)(?:\n|$)/i
  ]);

  return {
    bank_payment: {
      reference_number: referenceNumber,
      payment_date: paymentDate,
      payment_amount: paidAmount,
      paid_currency: 'USD',
      debit_amount: debitAmount,
      debit_currency: 'MYR',
      exchange_rate: exchangeRate,
      bank_name: 'Hong Leong Bank',
      account_number: extractField([/Account Number[:\s]*([0-9]+)/i]),
      account_name: extractField([/Account Name[:\s]*(.+?)(?:\n|$)/i]) || 'FLOW SOLUTION SDN BH',
      beneficiary_name: beneficiaryName,
      beneficiary_bank: extractField([/Beneficiary Bank.*?Name[:\s]*(.+?)(?:\n|$)/i]),
      beneficiary_country: 'HONG KONG',
      payment_details: paymentDetails,
      bank_charges: extractAmount([/Charges[:\s]*([0-9.,]+)/i]) || 50.00,
      status: extractField([/Status[:\s]*(.+?)(?:\n|$)/i]) || 'Completed'
    },
    confidence: 0.75,
    document_type: 'bank_payment_slip'
  };
}

// Extract from image files (OCR)
exports.extractFromImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No image uploaded' 
      });
    }

    // For now, return a message that OCR is coming soon
    // You can implement Tesseract.js here later
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

// Extract from Excel files
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

// Process Excel data into standard format
function processExcelData(rows) {
  // This is a basic implementation - customize based on your Excel format
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

// Extract from email files (.eml, .msg)
exports.extractFromEmail = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No email file uploaded' 
      });
    }

    // For now, return a message that email extraction is coming soon
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

// Generate smart recommendations based on extracted data
function generateRecommendations(data) {
  const recommendations = [];
  
  // Check for missing critical fields
  if (!data.piNumber && !data.poNumber && !data.orderNumber) {
    recommendations.push({
      field: 'documentNumber',
      message: 'Document number not found. Please verify.',
      severity: 'high'
    });
  }
  
  if (!data.deliveryDate && !data.date) {
    recommendations.push({
      field: 'date',
      message: 'No date specified. Consider adding one.',
      severity: 'medium'
    });
  }
  
  // Check for pricing anomalies
  data.items?.forEach((item, index) => {
    if (item.unitPrice <= 0) {
      recommendations.push({
        field: `items[${index}].unitPrice`,
        message: `Unit price for ${item.productName} seems incorrect.`,
        severity: 'high'
      });
    }
    
    if (item.quantity <= 0) {
      recommendations.push({
        field: `items[${index}].quantity`,
        message: `Quantity for ${item.productName} seems incorrect.`,
        severity: 'high'
      });
    }
  });
  
  // Payment terms validation
  if (!data.paymentTerms && !data.terms?.payment) {
    recommendations.push({
      field: 'paymentTerms',
      message: 'Payment terms not specified. Default to 30 days?',
      severity: 'low'
    });
  }
  
  return recommendations;
}

// ================================
// NEW: DUAL SYSTEM TESTING & COMPARISON ENDPOINTS
// ================================

// NEW: Test extraction with specific system
exports.testExtraction = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded for testing' 
      });
    }

    const { forceSystem = 'mcp', compareWithLegacy = false } = req.body;
    const user = req.user || { 
      email: req.body.userEmail || 'test@flowsolution.net',
      role: 'admin'
    };

    console.log(`🧪 Test extraction requested - Force: ${forceSystem}, Compare: ${compareWithLegacy}`);

    // Extract PDF text
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = pdfData.text;
    
    if (compareWithLegacy) {
      // Run both systems and compare
      console.log('🆚 Running comparison test...');
      
      const supplierInfo = identifySupplier(extractedText);
      const documentType = detectDocumentType(extractedText);
      
      // Get both prompts
      const legacyPrompt = getLegacyPrompt(supplierInfo, documentType, documentType);
      const mcpPrompt = await getPromptForExtraction('mcp', supplierInfo, documentType, user, 'pdf');
      
      const startTime = Date.now();
      
      // Run extractions in parallel
      const [legacyResult, mcpResult] = await Promise.all([
        extractWithAI(extractedText, 'deepseek', legacyPrompt).catch(err => ({ error: err.message })),
        extractWithAI(extractedText, 'deepseek', mcpPrompt).catch(err => ({ error: err.message }))
      ]);
      
      const totalTime = Date.now() - startTime;
      
      // Compare results
      const comparison = {
        test_metadata: {
          file_name: req.file.originalname,
          file_size: req.file.size,
          supplier_detected: supplierInfo.supplier,
          document_type: documentType,
          processing_time: totalTime,
          timestamp: new Date().toISOString()
        },
        legacy_system: {
          prompt_used: legacyPrompt.metadata.promptName,
          prompt_id: legacyPrompt.metadata.promptId,
          success: !legacyResult.error,
          error: legacyResult.error || null,
          data: legacyResult.error ? null : legacyResult,
          item_count: legacyResult.error ? 0 : (legacyResult.purchase_order?.items?.length || legacyResult.proforma_invoice?.items?.length || 0)
        },
        mcp_system: {
          prompt_used: mcpPrompt.metadata.promptName,
          prompt_id: mcpPrompt.metadata.promptId,
          success: !mcpResult.error,
          error: mcpResult.error || null,
          data: mcpResult.error ? null : mcpResult,
          item_count: mcpResult.error ? 0 : (mcpResult.purchase_order?.items?.length || mcpResult.proforma_invoice?.items?.length || 0)
        },
        recommendation: generateTestRecommendation(legacyResult, mcpResult)
      };
      
      res.json({
        success: true,
        comparison: comparison
      });
      
    } else {
      // Single system test
      console.log(`🎯 Testing ${forceSystem} system only...`);
      
      const supplierInfo = identifySupplier(extractedText);
      const documentType = detectDocumentType(extractedText);
      
      const selectedPrompt = forceSystem === 'mcp' 
        ? await getPromptForExtraction('mcp', supplierInfo, documentType, user, 'pdf')
        : getLegacyPrompt(supplierInfo, documentType, documentType);
      
      const startTime = Date.now();
      const result = await extractWithAI(extractedText, 'deepseek', selectedPrompt);
      const processingTime = Date.now() - startTime;
      
      res.json({
        success: true,
        test_result: {
          system_used: forceSystem,
          prompt_used: selectedPrompt.metadata.promptName,
          prompt_id: selectedPrompt.metadata.promptId,
          processing_time: processingTime,
          data: result,
          metadata: {
            file_name: req.file.originalname,
            supplier_detected: supplierInfo.supplier,
            document_type: documentType,
            timestamp: new Date().toISOString()
          }
        }
      });
    }

  } catch (error) {
    console.error('❌ Test extraction error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

function generateTestRecommendation(legacyResult, mcpResult) {
  if (legacyResult.error && mcpResult.error) {
    return {
      recommendation: 'Both systems failed',
      reason: 'Document may be corrupted or unsupported format',
      suggested_action: 'Check document quality and try again'
    };
  }
  
  if (legacyResult.error && !mcpResult.error) {
    return {
      recommendation: 'Use MCP system',
      reason: 'Legacy system failed, MCP system succeeded',
      suggested_action: 'Deploy MCP prompts for this document type'
    };
  }
  
  if (!legacyResult.error && mcpResult.error) {
    return {
      recommendation: 'Use Legacy system',
      reason: 'MCP system failed, Legacy system succeeded',
      suggested_action: 'Improve MCP prompts for this document type'
    };
  }
  
  // Both succeeded - compare quality
  const legacyItems = legacyResult.purchase_order?.items?.length || legacyResult.proforma_invoice?.items?.length || 0;
  const mcpItems = mcpResult.purchase_order?.items?.length || mcpResult.proforma_invoice?.items?.length || 0;
  
  if (mcpItems > legacyItems) {
    return {
      recommendation: 'Use MCP system',
      reason: `MCP extracted ${mcpItems} items vs ${legacyItems} from Legacy`,
      suggested_action: 'MCP system shows better extraction completeness'
    };
  } else if (legacyItems > mcpItems) {
    return {
      recommendation: 'Use Legacy system',
      reason: `Legacy extracted ${legacyItems} items vs ${mcpItems} from MCP`,
      suggested_action: 'Legacy system shows better extraction completeness'
    };
  } else {
    return {
      recommendation: 'Both systems equivalent',
      reason: `Both extracted ${legacyItems} items`,
      suggested_action: 'Choose based on other factors (speed, cost, etc.)'
    };
  }
}

// NEW: Batch comparison test
exports.batchComparisonTest = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded for batch testing'
      });
    }

    console.log(`🧪 Batch comparison test with ${files.length} files`);

    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`📄 Processing file ${i + 1}/${files.length}: ${file.originalname}`);

      try {
        // Process each file with both systems
        const pdfData = await pdfParse(file.buffer);
        const extractedText = pdfData.text;
        
        const supplierInfo = identifySupplier(extractedText);
        const documentType = detectDocumentType(extractedText);
        
        const legacyPrompt = getLegacyPrompt(supplierInfo, documentType, documentType);
        const mcpPrompt = await getPromptForExtraction('mcp', supplierInfo, documentType, { email: 'batch@test.com' }, 'pdf');
        
        const startTime = Date.now();
        
        const [legacyResult, mcpResult] = await Promise.all([
          extractWithAI(extractedText, 'deepseek', legacyPrompt).catch(err => ({ error: err.message })),
          extractWithAI(extractedText, 'deepseek', mcpPrompt).catch(err => ({ error: err.message }))
        ]);
        
        const processingTime = Date.now() - startTime;
        
        results.push({
          file_name: file.originalname,
          file_index: i + 1,
          supplier: supplierInfo.supplier,
          document_type: documentType,
          processing_time: processingTime,
          legacy: {
            success: !legacyResult.error,
            items_extracted: legacyResult.error ? 0 : (legacyResult.purchase_order?.items?.length || legacyResult.proforma_invoice?.items?.length || 0),
            error: legacyResult.error
          },
          mcp: {
            success: !mcpResult.error,
            items_extracted: mcpResult.error ? 0 : (mcpResult.purchase_order?.items?.length || mcpResult.proforma_invoice?.items?.length || 0),
            error: mcpResult.error
          }
        });

      } catch (error) {
        console.error(`❌ Failed to process ${file.originalname}:`, error);
        errors.push({
          file_name: file.originalname,
          file_index: i + 1,
          error: error.message
        });
      }
    }

    // Generate batch summary
    const summary = {
      total_files: files.length,
      successful_comparisons: results.length,
      failed_files: errors.length,
      legacy_stats: {
        success_rate: (results.filter(r => r.legacy.success).length / results.length * 100).toFixed(1) + '%',
        avg_items: results.length > 0 ? (results.reduce((sum, r) => sum + r.legacy.items_extracted, 0) / results.length).toFixed(1) : 0
      },
      mcp_stats: {
        success_rate: (results.filter(r => r.mcp.success).length / results.length * 100).toFixed(1) + '%',
        avg_items: results.length > 0 ? (results.reduce((sum, r) => sum + r.mcp.items_extracted, 0) / results.length).toFixed(1) : 0
      },
      recommendation: generateBatchRecommendation(results)
    };

    res.json({
      success: true,
      batch_comparison: {
        summary: summary,
        detailed_results: results,
        errors: errors,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Batch comparison test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

function generateBatchRecommendation(results) {
  if (results.length === 0) return 'No data to analyze';
  
  const legacySuccesses = results.filter(r => r.legacy.success).length;
  const mcpSuccesses = results.filter(r => r.mcp.success).length;
  
  const legacyTotalItems = results.reduce((sum, r) => sum + r.legacy.items_extracted, 0);
  const mcpTotalItems = results.reduce((sum, r) => sum + r.mcp.items_extracted, 0);
  
  if (mcpSuccesses > legacySuccesses) {
    return `MCP system recommended: ${mcpSuccesses}/${results.length} successes vs ${legacySuccesses}/${results.length} for Legacy`;
  } else if (legacySuccesses > mcpSuccesses) {
    return `Legacy system recommended: ${legacySuccesses}/${results.length} successes vs ${mcpSuccesses}/${results.length} for MCP`;
  } else if (mcpTotalItems > legacyTotalItems) {
    return `MCP system recommended: Better item extraction (${mcpTotalItems} vs ${legacyTotalItems} total items)`;
  } else if (legacyTotalItems > mcpTotalItems) {
    return `Legacy system recommended: Better item extraction (${legacyTotalItems} vs ${mcpTotalItems} total items)`;
  } else {
    return 'Both systems perform equally - choose based on other factors';
  }
}'development' ? error.stack : undefined
    });
  }
};

// NEW: Analytics tracking function
async function trackExtractionUsage(selectedPrompt, user, supplierInfo, metrics) {
  try {
    const analyticsData = {
      timestamp: new Date().toISOString(),
      prompt_system: selectedPrompt.system,
      prompt_id: selectedPrompt.metadata.promptId,
      prompt_name: selectedPrompt.metadata.promptName,
      user_email: user.email,
      supplier: supplierInfo.supplier,
      success: metrics.success,
      processing_time: metrics.processingTime,
      ai_provider: metrics.aiProvider,
      document_type: metrics.documentType
    };
    
    // Here you could store this in a database or send to analytics service
    console.log('📊 Analytics tracked:', analyticsData);
    
    // Example: Store in database or send to analytics API
    // await analyticsService.track(analyticsData);
    
  } catch (error) {
    console.warn('📊 Analytics tracking error:', error.message);
  }
}

// ================================
// NEW: DUAL SYSTEM API ENDPOINTS
// ================================

// NEW: Endpoint to get current prompt system status
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
    const legacyPrompts = getLegacyPromptCount();
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

// NEW: Endpoint to toggle prompt system for testing
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
    
    // For now, we'll just return the setting (you could store this in database)
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

// NEW: Endpoint to get prompt system analytics
exports.getPromptSystemAnalytics = async (req, res) => {
  try {
    // This would typically come from a database or analytics service
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
        { id: 'legacy_ptp_specific', name: 'PTP Legacy Template', usage: 12, accuracy: 96 },
        { id: 'mcp_pi_advanced', name: 'Advanced PI MCP', usage: 8, accuracy: 94 }
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

const getLegacyPromptCount = () => {
  // Count your existing hardcoded prompts
  return 4; // Base + PTP + PI + Generic variants
};

// ================================
// ENHANCED PROJECT CODE EXTRACTION
// ================================

/**
 * Enhanced project code extraction for PO documents
 */
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
// EXISTING EXTRACTION METHODS (UNCHANGED)
// ================================

// Bank Payment Slip extraction support
exports.extractBankPaymentSlip = async (req, res) => {
  try {
    console.log('🏦 Bank Payment Slip extraction request received');

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    const startTime = Date.now();

    // Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = pdfData.text;
    
    console.log('📄 Extracted text length:', extractedText.length);

    // Use AI to structure the bank payment data
    const aiPrompt = `
You are an expert at extracting structured data from Hong Leong Bank payment slips.

Extract the following information from this bank payment slip text and return ONLY a valid JSON object:

Text:
${extractedText}

Return JSON in this exact format:
{
  "bank_payment": {
    "reference_number": "C716200525115916",
    "payment_date": "20/05/2025",
    "payment_amount": 1860.00,
    "paid_currency": "USD",
    "debit_amount": 8230.50,
    "debit_currency": "MYR",
    "exchange_rate": 4.4240,
    "bank_name": "Hong Leong Bank",
    "account_number": "17301010259",
    "account_name": "FLOW SOLUTION SDN BH",
    "beneficiary_name": "Qingzhou Tianhong Electromechanical Co. LTD",
    "beneficiary_bank": "JPMorgan Chase Bank NA",
    "beneficiary_country": "HONG KONG",
    "payment_details": "TH-202500135,202500134,202500182",
    "bank_charges": 50.00,
    "status": "In Process at Bank"
  },
  "confidence": 0.95,
  "document_type": "bank_payment_slip"
}

Extract all numerical values as numbers, not strings. If any field is not found, use null.
Return ONLY the JSON object, no explanations or markdown.
`;

    // Call AI service (DeepSeek)
    let aiResponse;
    try {
      if (deepseek) {
        const completion = await deepseek.chat.completions.create({
          model: "deepseek-chat",
          messages: [
            {
              role: "user", 
              content: aiPrompt
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        });

        const aiResult = completion.choices[0].message.content.trim();
        console.log('🤖 AI Raw Response:', aiResult);

        // Parse AI response
        const cleanedResponse = aiResult
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();

        aiResponse = JSON.parse(cleanedResponse);
        console.log('✅ AI Parsed Response:', aiResponse);

      } else {
        throw new Error('DeepSeek API not configured');
      }
    } catch (aiError) {
      console.error('❌ AI extraction failed:', aiError);
      
      // Fallback to pattern-based extraction
      aiResponse = extractBankPaymentFallback(extractedText);
    }

    const extractionTime = Date.now() - startTime;

    // Return structured response
    res.json({
      success: true,
      data: aiResponse,
      processing_time: extractionTime,
      metadata: {
        file_name: req.file.originalname,
        file_size: req.file.size,
        extraction_method: aiResponse.confidence > 0.8 ? 'ai_extraction' : 'pattern_fallback',
        processed_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Bank payment slip extraction error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract bank payment data',
      error: process.env.NODE_ENV ===
