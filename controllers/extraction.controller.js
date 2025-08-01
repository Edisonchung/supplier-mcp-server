const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const { identifySupplier } = require('../utils/supplierTemplates');

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
// ENHANCED PI EXTRACTION FUNCTIONS
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

// ================================
// EXISTING FUNCTIONS (UPDATED)
// ================================

// Get PTP-specific prompt
const getPTPSpecificPrompt = () => {
  return `
    Extract purchase order information from this PT. PERINTIS TEKNOLOGI PERDANA document.
    
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
};

// Get Proforma Invoice specific prompt
const getPISpecificPrompt = () => {
  return `
    Extract proforma invoice information from this Chinese supplier document.
    
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
};

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

// Enhanced AI extraction with document type detection
async function extractWithAI(text, aiProvider = 'deepseek') {
  console.log(`Starting AI extraction with ${aiProvider}, text length: ${text.length} characters`);
  
  // Detect document type
  const documentType = detectDocumentType(text);
  console.log(`Detected document type: ${documentType}`);
  
  // If it's a PI, use enhanced PI extraction first
  if (documentType === 'proforma_invoice') {
    console.log('Using enhanced PI extraction method...');
    try {
      const piData = extractPIInfo(text);
      if (piData.items && piData.items.length > 0) {
        console.log(`Enhanced PI extraction successful: ${piData.items.length} items found`);
        return {
          proforma_invoice: piData
        };
      }
    } catch (error) {
      console.log('Enhanced PI extraction failed, falling back to AI:', error.message);
    }
  }
  
  // Detect if this is a PTP document
  const supplierInfo = identifySupplier(text);
  console.log('Detected supplier:', supplierInfo.supplier);
  
  // Choose appropriate prompt based on document type and supplier
  let prompt;
  let responseStructure;
  
  if (documentType === 'proforma_invoice') {
    prompt = getPISpecificPrompt();
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
            "totalPrice": number
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
  } else if (supplierInfo.supplier === 'PTP') {
    prompt = getPTPSpecificPrompt();
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
            "totalPrice": number
          }
        ],
        "totalAmount": number,
        "deliveryDate": "string",
        "paymentTerms": "string"
      }
    }`;
  } else {
    // Use the existing generic prompt
    prompt = `
    Extract ${documentType === 'proforma_invoice' ? 'proforma invoice' : 'purchase order'} information from the following text and return a JSON object.
    
    CRITICAL RULES FOR PRODUCT EXTRACTION:
    1. The product name/description is usually BELOW the part number, not beside it
    2. UOM values (PCS, UNI, SET, etc.) are NEVER the product name
    3. Look for multi-line product descriptions after each line number
    4. In this format: Line -> Part Number -> Product Description (on next line) -> Quantity -> UOM -> Price
    
    Example:
    Line  Part Number
    1     400QCR1068                     1.00   PCS   20,500.00
          THRUSTER                       <-- This is the product name, NOT "PCS"
    `;
    
    responseStructure = `
    {
      "${documentType === 'proforma_invoice' ? 'proforma_invoice' : 'purchase_order'}": {
        // Standard structure based on document type
      }
    }`;
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
            console.log('Calling OpenAI API...');
            const completion = await openai.chat.completions.create({
              model: 'gpt-4-turbo',
              messages: [
                { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
                { role: 'user', content: fullPrompt }
              ],
              temperature: 0.1,
              response_format: { type: "json_object" }
            });
            return JSON.parse(completion.choices[0].message.content);
            
          case 'anthropic':
            if (!anthropic) throw new Error('Anthropic not configured');
            console.log('Calling Anthropic API...');
            const message = await anthropic.messages.create({
              model: 'claude-3-opus-20240229',
              max_tokens: 1024,
              messages: [{ role: 'user', content: fullPrompt }],
              temperature: 0.1
            });
            return JSON.parse(message.content[0].text);
            
          case 'google':
            if (!genAI) throw new Error('Google AI not configured');
            console.log('Calling Google AI API...');
            const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
            const geminiResult = await model.generateContent(fullPrompt);
            const response = await geminiResult.response;
            return JSON.parse(response.text());
            
          case 'deepseek':
            if (!deepseek) throw new Error('DeepSeek not configured');
            console.log('Calling DeepSeek API...');
            const deepseekCompletion = await deepseek.chat.completions.create({
              model: 'deepseek-chat',
              messages: [
                { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
                { role: 'user', content: fullPrompt }
              ],
              temperature: 0.1,
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
    if (supplierInfo.supplier === 'PTP') {
      console.log('Applying PTP-specific rules...');
      if (result.purchase_order) {
        result.purchase_order = applyPTPRules(result.purchase_order, text);
      }
    }
    
    console.log('AI extraction completed successfully');
    return result;
  } catch (error) {
    console.error('AI extraction error:', error.message);
    throw error;
  }
}

// Main extraction endpoint
exports.extractFromPDF = async (req, res) => {
  try {
    // Log request details
    console.log(`[${new Date().toISOString()}] PDF extraction request received`);
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
      console.log(`File too large: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is 10MB, your file is ${(req.file.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // Extract text from PDF with progress logging
    console.log('Starting PDF text extraction...');
    const startTime = Date.now();
    
    const pdfBuffer = req.file.buffer;
    const pdfData = await pdfParse(pdfBuffer).catch(error => {
      console.error('PDF parsing error:', error);
      throw new Error('Failed to parse PDF. The file may be corrupted or password protected.');
    });
    
    const extractedText = pdfData.text;
    const extractionTime = Date.now() - startTime;
    console.log(`PDF parsed in ${extractionTime}ms. Text length: ${extractedText.length} characters, Pages: ${pdfData.numpages}`);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No text found in PDF'
      });
    }

    // Determine which AI provider to use (in order of preference)
    let aiProvider = 'deepseek'; // default to cost-effective DeepSeek
    if (!deepseek && openai) aiProvider = 'openai';
    else if (!deepseek && !openai && anthropic) aiProvider = 'anthropic';
    else if (!deepseek && !openai && !anthropic && genAI) aiProvider = 'google';
    else if (!deepseek && !openai && !anthropic && !genAI) {
      return res.status(500).json({
        success: false,
        message: 'No AI service configured. Please set up API keys.'
      });
    }

    console.log(`Using AI provider: ${aiProvider}`);
    const aiStartTime = Date.now();

    // Extract structured data using AI
    const structuredData = await extractWithAI(extractedText, aiProvider).catch(error => {
      console.error('AI extraction failed:', error);
      throw new Error('AI extraction failed. Please try again or contact support.');
    });
    
    const aiTime = Date.now() - aiStartTime;
    console.log(`AI extraction completed in ${aiTime}ms`);

    // Detect document type for response formatting
    const documentType = detectDocumentType(extractedText);
    
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
        description: item.description || ''
      }));
    }

    // Calculate total if not provided
    if (!enhancedData.totalAmount && enhancedData.items) {
      enhancedData.totalAmount = enhancedData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    }

    // Add supplier detection info to response
    const supplierInfo = identifySupplier(extractedText);

    const totalTime = Date.now() - startTime;
    console.log(`Total extraction time: ${totalTime}ms`);

    res.json({
      success: true,
      data: enhancedData,
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        pagesCount: pdfData.numpages,
        textLength: extractedText.length,
        documentType: documentType,
        supplier: supplierInfo.supplier,
        supplierConfidence: supplierInfo.confidence,
        extractionMethod: documentType === 'proforma_invoice' ? 'PI_ENHANCED' : 
                         supplierInfo.supplier === 'PTP' ? 'PTP_TEMPLATE' : 'GENERIC',
        processingTime: {
          pdfParsing: extractionTime,
          aiExtraction: aiTime,
          total: totalTime
        }
      }
    });

  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract data from PDF',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
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


// Bank Payment Slip extraction support

/**
 * Extract Bank Payment Slip data using AI
 */
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
// OTHER EXTRACTION METHODS (UNCHANGED)
// ================================

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
