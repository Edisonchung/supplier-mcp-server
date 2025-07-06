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

// Extract structured data from PDF text using AI
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
async function extractWithAI(text, aiProvider = 'openai') {
  // Detect if this is a PTP document
  const supplierInfo = identifySupplier(text);
  console.log('Detected supplier:', supplierInfo.supplier);
  
  // Choose appropriate prompt based on supplier
  let prompt;
  if (supplierInfo.supplier === 'PTP') {
    prompt = getPTPSpecificPrompt() + `
    
    Return a JSON object with this structure:
    {
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
    }`;
  } else {
    // Use the existing generic prompt
    prompt = `
    Extract purchase order information from the following text and return a JSON object.
    
    CRITICAL RULES FOR PRODUCT EXTRACTION:
    1. The product name/description is usually BELOW the part number, not beside it
    2. UOM values (PCS, UNI, SET, etc.) are NEVER the product name
    3. Look for multi-line product descriptions after each line number
    4. In this format: Line -> Part Number -> Product Description (on next line) -> Quantity -> UOM -> Price
    
    Example:
    Line  Part Number
    1     400QCR1068                     1.00   PCS   20,500.00
          THRUSTER                       <-- This is the product name, NOT "PCS"
    
    Return a JSON object with this structure:
  {
      "orderNumber": "string - the PO number",
      "clientName": "string - the buyer/client company name",
      "supplierName": "string - the supplier/vendor name",
      "orderDate": "YYYY-MM-DD format date",
      "deliveryDate": "YYYY-MM-DD format date",
      "paymentTerms": "string - payment terms like Net 30, etc",
      "currency": "string - currency code like USD, MYR, etc",
      "items": [
        {
          "productName": "string - the product name/description",
          "productCode": "string - the part number or product code",
          "quantity": number,
          "unitPrice": number,
          "totalPrice": number,
          "description": "string - additional description if any"
        }
      ],
      "totalAmount": number,
      "notes": "string - any additional notes or remarks"
    }
    
    Important: 
    - Extract ALL items found in the document
    - Ensure numeric values are numbers, not strings
    - If a field is not found, use empty string for strings and 0 for numbers
    - For items array, it should never be empty if there are line items in the document
    
    Text to extract from:
    ${text}
  `;
  }

  try {
    let result;
    const fullPrompt = prompt + '\n\nText to extract from:\n' + text;
    
    switch (aiProvider) {
      case 'openai':
        if (!openai) throw new Error('OpenAI not configured');
        const completion = await openai.chat.completions.create({
          model: 'gpt-4-turbo',
          messages: [
            { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        });
        result = JSON.parse(completion.choices[0].message.content);
        break;
        
      case 'anthropic':
        if (!anthropic) throw new Error('Anthropic not configured');
        const message = await anthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: fullPrompt }],
          temperature: 0.1
        });
        result = JSON.parse(message.content[0].text);
        break;
        
      case 'google':
        if (!genAI) throw new Error('Google AI not configured');
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const geminiResult = await model.generateContent(fullPrompt);
        const response = await geminiResult.response;
        result = JSON.parse(response.text());
        break;
        
      case 'deepseek':
        if (!deepseek) throw new Error('DeepSeek not configured');
        const deepseekCompletion = await deepseek.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        });
        result = JSON.parse(deepseekCompletion.choices[0].message.content);
        break;
      default:
        throw new Error('Invalid AI provider');
    }
    
    // Apply PTP-specific post-processing if needed
    if (supplierInfo.supplier === 'PTP') {
      result = applyPTPRules(result, text);
    }
    
    return result;
  } catch (error) {
    console.error('AI extraction error:', error);
    throw error;
  }
}

// Main extraction endpoint
exports.extractFromPDF = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Extract text from PDF
    const pdfBuffer = req.file.buffer;
    const pdfData = await pdfParse(pdfBuffer);
    const extractedText = pdfData.text;

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

    // Extract structured data using AI
    const structuredData = await extractWithAI(extractedText, aiProvider);

    // Validate and enhance the extracted data
    const enhancedData = {
      ...structuredData,
      extractedAt: new Date().toISOString(),
      aiProvider: aiProvider,
      confidence: 0.85, // You can implement confidence scoring based on data completeness
      items: structuredData.items?.map(item => ({
        ...item,
        productName: item.productName || 'Unknown Product',
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || (item.quantity * item.unitPrice),
        description: item.description || ''
      })) || [],
      recommendations: generateRecommendations(structuredData)
    };

    // Calculate total if not provided
    if (!enhancedData.totalAmount) {
      enhancedData.totalAmount = enhancedData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    }
    // Add supplier detection info to response
    const supplierInfo = identifySupplier(extractedText);



    res.json({
      success: true,
      data: enhancedData,
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        pagesCount: pdfData.numpages,
        textLength: extractedText.length,
        supplier: supplierInfo.supplier,
        supplierConfidence: supplierInfo.confidence,
        extractionMethod: supplierInfo.supplier === 'PTP' ? 'PTP_TEMPLATE' : 'GENERIC'
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
  if (!data.orderNumber) {
    recommendations.push({
      field: 'orderNumber',
      message: 'Order number not found. Please verify.',
      severity: 'high'
    });
  }
  
  if (!data.deliveryDate) {
    recommendations.push({
      field: 'deliveryDate',
      message: 'No delivery date specified. Consider adding one.',
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
  if (!data.paymentTerms) {
    recommendations.push({
      field: 'paymentTerms',
      message: 'Payment terms not specified. Default to 30 days?',
      severity: 'low'
    });
  }
  
  return recommendations;
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
