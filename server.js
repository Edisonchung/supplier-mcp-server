// mcp-server/server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer
const upload = multer({ 
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'MCP Server is running',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'MCP Server is running'
  });
});

// Mock data for PO-020748
const mockPOData = {
  success: true,
  data: {
    clientPoNumber: "PO-020748",
    clientName: "Flow Solution Sdn. Bhd.",
    clientContact: "",
    clientEmail: "",
    clientPhone: "",
    orderDate: "2024-11-14",
    requiredDate: "2024-12-23",
    items: [
      {
        productName: "THRUSTER",
        productCode: "400QCR1068",
        quantity: 1,
        unitPrice: 20500.00,
        totalPrice: 20500.00
      },
      {
        productName: "SIMATIC S7-400 POWER SUPPLY",
        productCode: "400QCR0662",
        quantity: 1,
        unitPrice: 1950.00,
        totalPrice: 1950.00
      }
    ],
    paymentTerms: "60D",
    deliveryTerms: "DDP"
  },
  model: "Mock"
};

// PDF extraction endpoint
app.post('/api/extract-po', upload.single('pdf'), (req, res) => {
  try {
    console.log('Received PDF:', req.file?.originalname);
    
    // Clean up uploaded file
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    // Return mock data
    res.json(mockPOData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});