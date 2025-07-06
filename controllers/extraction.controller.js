const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize AI clients (use environment variables)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const genAI = process.env.GOOGLE_AI_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// Extract structured data from PDF text using AI
async function extractWithAI(text, aiProvider = 'openai') {
  const prompt = `
    Extract purchase order information from the following text and return a JSON object with this structure:
    {
      "orderNumber": "string",
      "clientName": "string", 
      "supplierName": "string",
      "orderDate": "YYYY-MM-DD",
      "deliveryDate": "YYYY-MM-DD",
      "paymentTerms": "string",
      "items": [
        {
          "productName": "string",
          "quantity": number,
          "unitPrice": number,
          "totalPrice": number,
          "description": "string"
        }
      ],
      "totalAmount": number,
      "currency": "string",
      "notes": "string"
    }
    
    Text to analyze:
    ${text}
    
    Return ONLY valid JSON, no additional text.
  `;

  try {
    let result;
    
    switch (aiProvider) {
      case 'openai':
        if (!openai) throw new Error('OpenAI not configured');
        const completion = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: 'You are a data extraction expert. Always return valid JSON.' },
            { role: 'user', content: prompt }
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
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        });
        result = JSON.parse(message.content[0].text);
        break;
        
      case 'google':
        if (!genAI) throw new Error('Google AI not configured');
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const geminiResult = await model.generateContent(prompt);
        const response = await geminiResult.response;
        result = JSON.parse(response.text());
        break;
        
      default:
        throw new Error('Invalid AI provider');
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
    let aiProvider = 'openai'; // default
    if (!openai && anthropic) aiProvider = 'anthropic';
    else if (!openai && !anthropic && genAI) aiProvider = 'google';
    else if (!openai && !anthropic && !genAI) {
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

    res.json({
      success: true,
      data: enhancedData,
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        pagesCount: pdfData.numpages,
        textLength: extractedText.length
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
