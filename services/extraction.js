// services/extraction.js
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;

// Extract from PDF
async function extractFromPDF(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  
  try {
    const data = await pdfParse(dataBuffer);

     // ✅ ENHANCED: Preserve line structure for better project code detection
    const lines = data.text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    return {
      text: data.text,
      lines: lines,
      info: data.info,
      pages: data.numpages,
      projectCodesPreview: extractProjectCodesPreview(data.text)
    };
  } catch (error) {
    console.log('Text extraction failed, document might need OCR');
    throw error;
  }
}

// ✅ ADD THIS HELPER FUNCTION
function extractProjectCodesPreview(text) {
  const patterns = [/FS-S\d+/gi, /BWS-S\d+/gi, /[A-Z]{2,3}-[A-Z]\d+/gi];
  const found = [];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  
  return [...new Set(found)]; // Remove duplicates
}

// Extract from Excel
async function extractFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  return parseExcelData(jsonData);
}

// Extract from Image (placeholder)
async function extractFromImage(filePath) {
  // In production, use OCR service
  return {
    clientPoNumber: 'IMG-' + Date.now(),
    clientName: 'Image Extraction Placeholder',
    items: []
  };
}

// Extract from Email (placeholder)
async function extractFromEmail(filePath) {
  const emailContent = await fs.readFile(filePath, 'utf-8');
  return {
    subject: 'Purchase Order from Email',
    body: emailContent.substring(0, 100) + '...',
    attachments: []
  };
}

// Helper function to parse Excel data
function parseExcelData(data) {
  const result = {
    items: []
  };
  
  let inItemsSection = false;
  
  for (const row of data) {
    if (!row || row.length === 0) continue;
    
    if (row[0] && typeof row[0] === 'string') {
      if (row[0].includes('PO') || row[0].includes('Purchase Order')) {
        result.clientPoNumber = row[1] || extractPONumber(row[0]);
      }
      
      if (row[0].includes('Client') || row[0].includes('Customer')) {
        result.clientName = row[1];
      }
      
      if (row[0].includes('Item') || row[0].includes('Product')) {
        inItemsSection = true;
        continue;
      }
    }
    
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

module.exports = {
  extractFromPDF,
  extractFromExcel,
  extractFromImage,
  extractFromEmail
};
