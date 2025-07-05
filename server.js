// mcp-server/server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize AI clients (only if API keys are provided)
const deepseekClient = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1'
}) : null;

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
}) : null;

// Log which services are available
console.log('Available AI services:');
if (deepseekClient) console.log('- DeepSeek');
if (openaiClient) console.log('- OpenAI');
if (genAI) console.log('- Gemini');
if (anthropic) console.log('- Anthropic');
if (!deepseekClient && !openaiClient && !genAI && !anthropic) {
  console.log('WARNING: No AI services configured. Using mock data only.');
}

// Helper function to extract text from PDF using pdf-lib
async function extractTextFromPDF(filePath) {
  try {
    const pdfBuffer = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    // For now, we'll use a simple approach
    // In production, you might want to use pdf.js or another library for better text extraction
    const pages = pdfDoc.getPages();
    let text = '';
    
    // This is a basic implementation - for better results, consider using pdf.js-extract
    text = `PDF with ${pages.length} pages uploaded. Content extraction in progress.`;
    
    // For actual text extraction, we'll need to parse the PDF content
    // This is a placeholder - in production, use a proper PDF text extraction library
    const fileContent = await fs.readFile(filePath, 'utf-8').catch(() => '');
    
    return text + '\n' + fileContent;
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

// Alternative: Simple file reading for testing
async function readPDFFile(filePath) {
  try {
    // For testing, we'll just read the file
    const stats = await fs.stat(filePath);
    console.log(`PDF file size: ${stats.size} bytes`);
    
    // Return a placeholder text for testing
    return "Purchase Order Document - Please implement proper PDF text extraction";
  } catch (error) {
    console.error('Error reading PDF:', error);
    throw new Error('Failed to read PDF file');
  }
}

// Helper function to create extraction prompt
function createExtractionPrompt(pdfText) {
  return `
Extract purchase order information from the following document and return it as a JSON object.
Return ONLY the JSON object without any markdown formatting or additional text.

Required fields:
- clientPoNumber: The purchase order number
- clientName: The client/customer company name
- clientContact: Contact person name
- clientEmail: Contact email
- clientPhone: Contact phone
- orderDate: Order date in YYYY-MM-DD format
- requiredDate: Required/delivery date in YYYY-MM-DD format
- items: Array of items with:
  - productName: Product/item name
  - productCode: Product code/SKU if available, otherwise use empty string
  - quantity: Quantity as number
  - unitPrice: Unit price as number
  - totalPrice: Total price for this line item as number
- paymentTerms: Payment terms (e.g., "Net 30", "COD", etc.)
- deliveryTerms: Delivery/shipping terms

If any field is not found, use empty string for text fields or 0 for numbers.

Document text:
${pdfText}
`;
}

// AI extraction functions
async function extractWithDeepSeek(pdfText) {
  if (!deepseekClient) throw new Error('DeepSeek client not initialized');
  try {
    const response = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: createExtractionPrompt(pdfText) }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });
    
    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('DeepSeek extraction failed:', error);
    throw error;
  }
}

async function extractWithGemini(pdfText) {
  if (!genAI) throw new Error('Gemini client not initialized');
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(createExtractionPrompt(pdfText));
    const response = await result.response;
    const content = response.text();
    return JSON.parse(content);
  } catch (error) {
    console.error('Gemini extraction failed:', error);
    throw error;
  }
}

async function extractWithClaude(pdfText) {
  if (!anthropic) throw new Error('Anthropic client not initialized');
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      temperature: 0.1,
      messages: [
        { role: 'user', content: createExtractionPrompt(pdfText) }
      ]
    });
    
    const content = response.content[0].text;
    return JSON.parse(content);
  } catch (error) {
    console.error('Claude extraction failed:', error);
    throw error;
  }
}

async function extractWithGPT4(pdfText) {
  if (!openaiClient) throw new Error('OpenAI client not initialized');
  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'user', content: createExtractionPrompt(pdfText) }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });
    
    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('GPT-4 extraction failed:', error);
    throw error;
  }
}

// Main extraction function with fallback
async function extractPOData(pdfText) {
  const extractors = [];
  
  if (deepseekClient) extractors.push({ name: 'DeepSeek', fn: extractWithDeepSeek });
  if (genAI) extractors.push({ name: 'Gemini', fn: extractWithGemini });
  if (anthropic) extractors.push({ name: 'Claude', fn: extractWithClaude });
  if (openaiClient) extractors.push({ name: 'GPT-4', fn: extractWithGPT4 });

  if (extractors.length === 0 || pdfText.includes("Please implement proper PDF text extraction")) {
    console.log("No AI services configured or using mock data for testing");
    return {
      success: true,
      data: {
        clientPoNumber: "PO-TEST-001",
        clientName: "Test Company Ltd",
        clientContact: "John Doe",
        clientEmail: "john@testcompany.com",
        clientPhone: "+1-555-0123",
        orderDate: new Date().toISOString().split('T')[0],
        requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        items: [
          {
            productName: "Test Product A",
            productCode: "TEST-001",
            quantity: 10,
            unitPrice: 25.99,
            totalPrice: 259.90
          }
        ],
        paymentTerms: "Net 30",
        deliveryTerms: "FOB"
      },
      model: "Mock"
    };
  }

  for (const extractor of extractors) {
    try {
      console.log(`Attempting extraction with ${extractor.name}...`);
      const result = await extractor.fn(pdfText);
      console.log(`${extractor.name} extraction successful`);
      return { success: true, data: result, model: extractor.name };
    } catch (error) {
      console.error(`${extractor.name} failed:`, error.message);
      continue;
    }
  }

  throw new Error('All AI models failed to extract data');
}

// Create uploads directory on startup
async function ensureUploadsDirectory() {
  try {
    await fs.access('uploads');
  } catch {
    await fs.mkdir('uploads', { recursive: true });
    console.log('Created uploads directory');
  }
}

// API endpoint for PDF extraction
app.post('/api/extract-po', upload.single('pdf'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    console.log(`Processing PDF: ${req.file.originalname}`);
    
    // Extract text from PDF (using simple method for now)
    const pdfText = await readPDFFile(filePath);
    
    // Extract PO data using AI
    const result = await extractPOData(pdfText);
    
    // Clean up uploaded file
    await fs.unlink(filePath);
    
    res.json(result);
  } catch (error) {
    console.error('Extraction error:', error);
    
    // Clean up file if it exists
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to extract data from PDF',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MCP Server is running' });
});

// Initialize server
async function startServer() {
  try {
    await ensureUploadsDirectory();
    
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`MCP Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();