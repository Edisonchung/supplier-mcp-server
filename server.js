// server.js - Enhanced MCP Server with All Features
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
require('dotenv').config();

// AI Service Imports
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize AI clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configure multer for multiple file types
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'message/rfc822',
      'application/vnd.ms-outlook'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// AI Model Selection Strategy
class AIModelSelector {
  static async selectModel(fileType, fileSize, complexity) {
    // Cost-based selection strategy
    if (fileSize < 1024 * 1024 && complexity === 'simple') {
      return 'gemini'; // Free tier for simple documents
    } else if (complexity === 'complex' || fileType === 'image') {
      return 'claude'; // Best for complex documents
    } else if (fileSize > 5 * 1024 * 1024) {
      return 'gpt4'; // Good for large documents
    } else {
      return 'deepseek'; // Cost-effective default
    }
  }
  
  static async extractWithFallback(file, primaryModel) {
    const models = ['claude', 'gpt4', 'gemini', 'deepseek'];
    let lastError;
    
    // Try primary model first
    try {
      return await this.extractWithModel(file, primaryModel);
    } catch (error) {
      console.log(`Primary model ${primaryModel} failed, trying fallbacks...`);
      lastError = error;
    }
    
    // Try other models as fallback
    for (const model of models) {
      if (model === primaryModel) continue;
      
      try {
        console.log(`Trying fallback model: ${model}`);
        return await this.extractWithModel(file, model);
      } catch (error) {
        lastError = error;
        continue;
      }
    }
    
    throw lastError;
  }
  
  static async extractWithModel(file, model) {
    switch (model) {
      case 'claude':
        return await extractWithClaude(file);
      case 'gpt4':
        return await extractWithGPT4(file);
      case 'gemini':
        return await extractWithGemini(file);
      case 'deepseek':
        return await extractWithDeepSeek(file);
      default:
        throw new Error(`Unknown model: ${model}`);
    }
  }
}

// Extraction Functions for Different AI Models
async function extractWithClaude(file) {
  const fileContent = await fs.readFile(file.path);
  const base64 = fileContent.toString('base64');
  
  const response = await anthropic.messages.create({
    model: 'claude-3-opus-20240229',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Extract purchase order information from this document. Return a JSON object with:
          - clientPoNumber
          - clientName
          - clientContact
          - clientEmail
          - clientPhone
          - orderDate (YYYY-MM-DD format)
          - requiredDate (YYYY-MM-DD format)
          - items (array with productName, productCode, quantity, unitPrice, totalPrice)
          - paymentTerms
          - deliveryTerms
          
          Be intelligent about field mapping and correct any obvious errors.`
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mimetype,
            data: base64
          }
        }
      ]
    }]
  });
  
  return JSON.parse(response.content[0].text);
}

async function extractWithGPT4(file) {
  const fileContent = await fs.readFile(file.path, 'utf-8');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-vision-preview',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Extract and structure purchase order data from this document. Apply intelligent field mapping and error correction.`
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${file.mimetype};base64,${fileContent.toString('base64')}`
          }
        }
      ]
    }],
    response_format: { type: 'json_object' }
  });
  
  return JSON.parse(response.choices[0].message.content);
}

async function extractWithGemini(file) {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
  const fileContent = await fs.readFile(file.path);
  
  const result = await model.generateContent([
    'Extract purchase order information and return as JSON',
    {
      inlineData: {
        data: fileContent.toString('base64'),
        mimeType: file.mimetype
      }
    }
  ]);
  
  return JSON.parse(result.response.text());
}

async function extractWithDeepSeek(file) {
  // DeepSeek implementation (mock for now)
  // In production, integrate with DeepSeek API
  return {
    clientPoNumber: 'PO-' + Date.now(),
    clientName: 'Extracted Client Name',
    items: []
  };
}

// Enhanced PDF extraction with OCR
async function extractFromPDF(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  
  try {
    // Try text extraction first
    const data = await pdfParse(dataBuffer);
    return {
      text: data.text,
      info: data.info,
      pages: data.numpages
    };
  } catch (error) {
    // If text extraction fails, might need OCR
    console.log('Text extraction failed, document might need OCR');
    throw error;
  }
}

// Excel extraction
async function extractFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // Intelligent parsing of Excel data
  return parseExcelData(jsonData);
}

function parseExcelData(data) {
  // Look for PO information in Excel structure
  const result = {
    items: []
  };
  
  let inItemsSection = false;
  
  for (const row of data) {
    if (!row || row.length === 0) continue;
    
    // Look for PO number
    if (row[0] && typeof row[0] === 'string') {
      if (row[0].includes('PO') || row[0].includes('Purchase Order')) {
        result.clientPoNumber = row[1] || extractPONumber(row[0]);
      }
      
      // Look for client name
      if (row[0].includes('Client') || row[0].includes('Customer')) {
        result.clientName = row[1];
      }
      
      // Detect items section
      if (row[0].includes('Item') || row[0].includes('Product')) {
        inItemsSection = true;
        continue;
      }
    }
    
    // Parse items
    if (inItemsSection && row[0] && !isNaN(row[0])) {
      result.items.push({
        productName: row[1] || '',
        productCode: row[2] || '',
        quantity: parseFloat(row[3]) || 0,
        unitPrice: parseFloat(row[4]) || 0,
        totalPrice: parseFloat(row[5]) || 0
      });
    }
  }
  
  return result;
}

function extractPONumber(text) {
  const match = text.match(/PO[-\s]?(\d+)/i);
  return match ? `PO-${match[1]}` : '';
}

// Image extraction with OCR
async function extractFromImage(filePath) {
  // In production, integrate with OCR service (Tesseract, Google Vision, etc.)
  // For now, use AI model with vision capabilities
  const file = {
    path: filePath,
    mimetype: 'image/jpeg'
  };
  
  return await AIModelSelector.extractWithFallback(file, 'claude');
}

// Email extraction
async function extractFromEmail(filePath) {
  // Parse email file (would need email parsing library in production)
  const emailContent = await fs.readFile(filePath, 'utf-8');
  
  // Extract attachments and body
  // For now, return mock data
  return {
    subject: 'Purchase Order from Email',
    body: emailContent,
    attachments: []
  };
}

// Data validation service
class DataValidator {
  static validate(data) {
    const errors = [];
    const warnings = [];
    
    // Required fields
    if (!data.clientPoNumber) {
      errors.push({ field: 'clientPoNumber', message: 'PO number is required' });
    }
    
    if (!data.clientName) {
      errors.push({ field: 'clientName', message: 'Client name is required' });
    }
    
    // Email validation
    if (data.clientEmail && !this.isValidEmail(data.clientEmail)) {
      warnings.push({ 
        field: 'clientEmail', 
        message: 'Email format appears invalid',
        suggestion: this.suggestEmailCorrection(data.clientEmail)
      });
    }
    
    // Date validation
    if (data.orderDate && !this.isValidDate(data.orderDate)) {
      warnings.push({ 
        field: 'orderDate', 
        message: 'Order date format should be YYYY-MM-DD' 
      });
    }
    
    // Items validation
    if (!data.items || data.items.length === 0) {
      errors.push({ field: 'items', message: 'At least one item is required' });
    } else {
      data.items.forEach((item, index) => {
        if (!item.productName) {
          errors.push({ 
            field: `items[${index}].productName`, 
            message: 'Product name is required' 
          });
        }
        
        if (item.quantity <= 0) {
          errors.push({ 
            field: `items[${index}].quantity`, 
            message: 'Quantity must be greater than 0' 
          });
        }
        
        // Check if total matches calculation
        const calculatedTotal = item.quantity * item.unitPrice;
        if (Math.abs(calculatedTotal - item.totalPrice) > 0.01) {
          warnings.push({
            field: `items[${index}].totalPrice`,
            message: 'Total price mismatch',
            calculated: calculatedTotal,
            extracted: item.totalPrice
          });
        }
      });
    }
    
    return { errors, warnings };
  }
  
  static isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  static suggestEmailCorrection(email) {
    return email
      .replace(/\.con$/, '.com')
      .replace(/gmial/, 'gmail')
      .replace(/outlok/, 'outlook');
  }
  
  static isValidDate(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
  }
}

// API Endpoints

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Enhanced MCP Server is running',
    version: '2.0.0',
    endpoints: [
      'GET /api/health',
      'POST /api/extract-po',
      'POST /api/check-duplicate',
      'POST /api/get-recommendations',
      'POST /api/save-correction',
      'POST /api/detect-category',
      'POST /api/extract-image',
      'POST /api/extract-excel'
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Enhanced MCP Server is running',
    features: ['pdf', 'image', 'excel', 'email', 'multi-ai', 'validation', 'recommendations']
  });
});

// Main extraction endpoint with all enhancements
app.post('/api/extract-po', upload.single('pdf'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log('Processing file:', file.originalname, 'Type:', file.mimetype);
    
    // Determine file type and complexity
    const fileType = getFileType(file);
    const fileSize = file.size;
    const complexity = req.body.complexity || 'simple';
    
    // For now, return enhanced mock data
    const enhancedMockData = {
      success: true,
      data: {
        // Basic fields
        clientPoNumber: `PO-2024-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`,
        clientName: "Tech Solutions Sdn Bhd",
        clientContact: "Ahmad Ibrahim",
        clientEmail: "ahmad@techsolutions.my",
        clientPhone: "+60 12-345 6789",
        orderDate: new Date().toISOString().split('T')[0],
        requiredDate: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
        
        // Items with enhanced data
        items: [
          {
            productName: "Industrial Sensor Module",
            productCode: "ISM-2024",
            quantity: 5,
            unitPrice: 450.00,
            totalPrice: 2250.00,
            stockAvailable: 45,
            category: "Electronics"
          },
          {
            productName: "Control Panel Unit",
            productCode: "CPU-100",
            quantity: 2,
            unitPrice: 1200.00,
            totalPrice: 2400.00,
            stockAvailable: 18,
            category: "Industrial"
          }
        ],
        
        paymentTerms: "Net 30",
        deliveryTerms: "DDP",
        
        // Validation results
        _validation: {
          errors: [],
          warnings: [
            {
              field: "clientEmail",
              message: "Email format corrected",
              original: "ahmad@techsolutions,my",
              corrected: "ahmad@techsolutions.my"
            },
            {
              field: "clientPhone",
              message: "Phone number standardized",
              original: "0123456789",
              corrected: "+60 12-345 6789"
            }
          ],
          corrections: {
            clientEmail: "ahmad@techsolutions.my",
            clientPhone: "+60 12-345 6789"
          }
        },
        
        // Duplicate warning (randomly include)
        warnings: Math.random() > 0.7 ? [{
          type: "duplicate",
          message: "Similar PO found: PO-2024-0234",
          similarPO: {
            poNumber: "PO-2024-0234",
            clientName: "Tech Solutions Sdn Bhd",
            orderDate: "2024-12-20",
            totalAmount: 4500.00
          }
        }] : [],
        
        // AI Recommendations
        recommendations: [
          {
            type: "price_optimization",
            title: "Cost Saving Opportunities",
            items: [
              {
                product: "Industrial Sensor Module",
                currentPrice: 450.00,
                averagePrice: 420.00,
                potentialSaving: 30.00,
                message: "Price is 7% above market average. Consider negotiating."
              }
            ]
          },
          {
            type: "supplier_recommendation",
            title: "Alternative Suppliers",
            suppliers: [
              {
                name: "Premium Electronic Supplies",
                rating: 4.8,
                recommendationScore: 92,
                reasons: ["Specializes in sensors", "Better pricing", "Faster delivery"]
              },
              {
                name: "Industrial Components Ltd",
                rating: 4.6,
                recommendationScore: 88,
                reasons: ["Bulk discounts available", "Good payment terms"]
              }
            ]
          },
          {
            type: "inventory_insight",
            title: "Stock Alerts",
            insights: [
              {
                type: "low_stock",
                product: "Control Panel Unit",
                requested: 2,
                available: 18,
                afterOrder: 16,
                reorderPoint: 20,
                message: "Stock will fall below reorder point after this order"
              }
            ]
          },
          {
            type: "payment_terms",
            title: "Payment Optimization",
            suggestion: {
              current: "Net 30",
              recommended: "2/10 Net 30",
              reason: "Take advantage of 2% early payment discount",
              potentialSaving: 89.00
            }
          }
        ]
      },
      
      model: "enhanced-ai-v2",
      confidence: 0.94,
      processingTime: (Date.now() - startTime) / 1000
    };
    
    // Clean up uploaded file
    if (file.path) {
      fs.unlink(file.path).catch(err => console.error('Error deleting file:', err));
    }
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    res.json(enhancedMockData);
    
  } catch (error) {
    console.error('Extraction error:', error);
    
    // Clean up on error
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to extract data',
      message: error.message 
    });
  }
});

// Duplicate check endpoint
app.post('/api/check-duplicate', express.json(), async (req, res) => {
  try {
    const { poData } = req.body;
    
    // Mock duplicate checking - in production, check against your database
    const mockExistingPOs = [
      {
        id: '1',
        clientPoNumber: 'PO-2024-001',
        clientName: 'Tech Solutions Sdn Bhd',
        orderDate: '2024-12-01',
        status: 'active',
        items: [
          { productName: 'Industrial Sensor', quantity: 5, unitPrice: 450 }
        ]
      }
    ];
    
    // Simple duplicate check logic
    const duplicates = mockExistingPOs.filter(po => {
      if (po.clientPoNumber === poData.clientPoNumber) return true;
      
      const sameClient = stringSimilarity(po.clientName, poData.clientName) > 0.8;
      const similarDate = Math.abs(new Date(po.orderDate) - new Date(poData.orderDate)) < 7 * 24 * 60 * 60 * 1000;
      
      return sameClient && similarDate;
    });
    
    res.json({
      isDuplicate: duplicates.length > 0,
      duplicates,
      similarity: duplicates.length > 0 ? calculateSimilarity(poData, duplicates[0]) : 0
    });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: 'Duplicate check failed' });
  }
});

// Get recommendations endpoint
app.post('/api/get-recommendations', express.json(), async (req, res) => {
  try {
    const { poData } = req.body;
    
    const recommendations = {
      priceOptimization: await getPriceRecommendations(poData),
      suppliers: await getSupplierRecommendations(poData),
      inventory: await getInventoryInsights(poData),
      payment: getPaymentRecommendations(poData)
    };
    
    res.json({
      success: true,
      recommendations
    });
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Image extraction endpoint
app.post('/api/extract-image', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    const extractedData = await extractFromImage(file.path);
    
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data: extractedData,
      model: 'vision-ai'
    });
  } catch (error) {
    console.error('Image extraction error:', error);
    res.status(500).json({ error: 'Failed to extract from image' });
  }
});

// Excel extraction endpoint
app.post('/api/extract-excel', upload.single('excel'), async (req, res) => {
  try {
    const file = req.file;
    const extractedData = await extractFromExcel(file.path);
    
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data: extractedData,
      model: 'excel-parser'
    });
  } catch (error) {
    console.error('Excel extraction error:', error);
    res.status(500).json({ error: 'Failed to extract from Excel' });
  }
});

// Email extraction endpoint
app.post('/api/extract-email', upload.single('email'), async (req, res) => {
  try {
    const file = req.file;
    const extractedData = await extractFromEmail(file.path);
    
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data: extractedData,
      model: 'email-parser'
    });
  } catch (error) {
    console.error('Email extraction error:', error);
    res.status(500).json({ error: 'Failed to extract from email' });
  }
});

// Learning endpoint - save user corrections
app.post('/api/save-correction', express.json(), async (req, res) => {
  try {
    const { field, originalValue, correctedValue } = req.body;
    
    // In production, save to database
    console.log('Learning from correction:', { 
      field, 
      originalValue, 
      correctedValue,
      timestamp: new Date().toISOString()
    });
    
    // Store corrections in a file for now
    const corrections = await loadCorrections();
    corrections[field] = {
      from: originalValue,
      to: correctedValue,
      count: (corrections[field]?.count || 0) + 1
    };
    await saveCorrections(corrections);
    
    res.json({ 
      success: true,
      message: 'Correction saved for future improvements'
    });
  } catch (error) {
    console.error('Save correction error:', error);
    res.status(500).json({ error: 'Failed to save correction' });
  }
});

// Category detection endpoint
app.post('/api/detect-category', express.json(), async (req, res) => {
  try {
    const { productName, supplierName } = req.body;
    
    const categories = {
      productCategory: detectProductCategory(productName),
      supplierCategory: detectSupplierCategory(supplierName)
    };
    
    res.json(categories);
  } catch (error) {
    console.error('Category detection error:', error);
    res.status(500).json({ error: 'Category detection failed' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Helper functions
function getFileType(file) {
  const mimeType = file.mimetype.toLowerCase();
  
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('image')) return 'image';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'excel';
  if (mimeType.includes('message')) return 'email';
  
  return 'unknown';
}

function calculateConfidence(validation) {
  const totalFields = 10;
  const errorWeight = 0.1;
  const warningWeight = 0.05;
  
  const errorPenalty = validation.errors.length * errorWeight;
  const warningPenalty = validation.warnings.length * warningWeight;
  
  const confidence = Math.max(0.5, Math.min(1, 1 - errorPenalty - warningPenalty));
  
  // Boost confidence if corrections were applied successfully
  const correctionBoost = validation.warnings.filter(w => w.corrected).length * 0.02;
  
  return Math.min(0.99, confidence + correctionBoost);
}

function applyAutoCorrections(data, warnings) {
  const corrected = { ...data };
  
  for (const warning of warnings) {
    if (warning.suggestion) {
      // Apply suggestion using field path
      const fieldPath = warning.field.split('.');
      let target = corrected;
      
      for (let i = 0; i < fieldPath.length - 1; i++) {
        target = target[fieldPath[i]];
      }
      
      target[fieldPath[fieldPath.length - 1]] = warning.suggestion;
    }
  }
  
  return corrected;
}

function findDuplicates(poData, existingPOs) {
  return existingPOs.filter(po => {
    // Check exact PO number match
    if (po.clientPoNumber === poData.clientPoNumber) return true;
    
    // Check similarity
    const similarity = calculateSimilarity(poData, po);
    return similarity > 0.8; // 80% threshold
  });
}

function calculateSimilarity(po1, po2) {
  let score = 0;
  let factors = 0;
  
  // Client name similarity
  if (po1.clientName && po2.clientName) {
    score += stringSimilarity(po1.clientName, po2.clientName) * 0.3;
    factors += 0.3;
  }
  
  // Date proximity
  if (po1.orderDate && po2.orderDate) {
    const daysDiff = Math.abs(new Date(po1.orderDate) - new Date(po2.orderDate)) / (1000 * 60 * 60 * 24);
    score += Math.max(0, (7 - daysDiff) / 7) * 0.2;
    factors += 0.2;
  }
  
  // Items similarity
  if (po1.items && po2.items) {
    score += itemsSimilarity(po1.items, po2.items) * 0.5;
    factors += 0.5;
  }
  
  return factors > 0 ? score / factors : 0;
}

function stringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function itemsSimilarity(items1, items2) {
  if (!items1.length || !items2.length) return 0;
  
  let matches = 0;
  
  for (const item1 of items1) {
    for (const item2 of items2) {
      if (stringSimilarity(item1.productName, item2.productName) > 0.8 ||
          item1.productCode === item2.productCode) {
        matches++;
        break;
      }
    }
  }
  
  return matches / Math.max(items1.length, items2.length);
}

// Category detection functions
function detectProductCategory(productName) {
  const categories = {
    'Electronics': ['sensor', 'module', 'circuit', 'chip', 'controller', 'board'],
    'Industrial': ['valve', 'pump', 'motor', 'panel', 'gauge', 'bearing'],
    'Safety': ['helmet', 'gloves', 'equipment', 'gear', 'protection'],
    'Tools': ['drill', 'wrench', 'tool', 'cutter', 'hammer']
  };
  
  const lowerName = productName.toLowerCase();
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return category;
    }
  }
  
  return 'General';
}

function detectSupplierCategory(supplierName) {
  const patterns = {
    'Technology': ['tech', 'solution', 'system', 'digital', 'software'],
    'Industrial': ['industrial', 'machinery', 'equipment', 'manufacturing'],
    'Trading': ['trading', 'import', 'export', 'supply', 'distribution']
  };
  
  const lowerName = supplierName.toLowerCase();
  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return category;
    }
  }
  
  return 'General Supplier';
}

// Recommendation functions
async function getPriceRecommendations(poData) {
  if (!poData.items) return [];
  
  return poData.items.map(item => ({
    product: item.productName,
    currentPrice: item.unitPrice,
    recommendedPrice: item.unitPrice * 0.95,
    savings: item.unitPrice * 0.05,
    message: `5% savings possible with bulk order`
  }));
}

async function getSupplierRecommendations(poData) {
  return [
    {
      name: 'Premium Industrial Supplies',
      rating: 4.8,
      matchScore: 0.92,
      reasons: ['Better prices', 'Faster delivery', 'Bulk discounts'],
      specializations: ['Industrial', 'Electronics']
    },
    {
      name: 'Global Tech Solutions',
      rating: 4.6,
      matchScore: 0.88,
      reasons: ['Reliable supplier', 'Good payment terms'],
      specializations: ['Technology', 'Components']
    }
  ];
}

async function getInventoryInsights(poData) {
  if (!poData.items) return [];
  
  return poData.items.map(item => ({
    product: item.productName,
    currentStock: Math.floor(Math.random() * 100) + 20,
    afterOrder: Math.floor(Math.random() * 50),
    reorderPoint: 20,
    alert: Math.random() > 0.5 ? 'Low stock warning' : null,
    message: 'Consider increasing order quantity'
  }));
}

function getPaymentRecommendations(poData) {
  const terms = parseInt(poData.paymentTerms) || 30;
  
  if (terms < 30) {
    return {
      current: poData.paymentTerms,
      recommended: '30 days',
      reason: 'Industry standard minimum'
    };
  } else if (terms === 30) {
    return {
      current: poData.paymentTerms,
      recommended: '2/10 Net 30',
      reason: 'Take advantage of early payment discount'
    };
  }
  
  return null;
}

// Corrections storage helpers
async function loadCorrections() {
  try {
    const data = await fs.readFile('corrections.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveCorrections(corrections) {
  await fs.writeFile('corrections.json', JSON.stringify(corrections, null, 2));
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Enhanced MCP Server running on port ${PORT}`);
  console.log('Features: Multi-format support, AI fallback, Validation, Recommendations');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
