const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Enhanced MCP Server is running',
    version: '2.0.0',
    endpoints: [
      'GET /api/health',
      'POST /api/extract-po',
      'POST /api/extract-image',
      'POST /api/extract-excel',
      'POST /api/extract-email',
      'POST /api/check-duplicate',
      'POST /api/get-recommendations',
      'POST /api/save-correction',
      'POST /api/detect-category'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Enhanced MCP Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
