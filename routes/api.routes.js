// routes/api.routes.js
const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const multer = require('multer');


// Controllers
const extractionController = require('../controllers/extraction.controller');
const duplicateController = require('../controllers/duplicate.controller');
const recommendationController = require('../controllers/recommendation.controller');

/// Enhanced health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Enhanced MCP Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: ['pdf', 'image', 'excel', 'email', 'multi-ai', 'validation', 'recommendations', 'ptp-detection'],
    capabilities: {
      maxFileSize: '10MB',
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        pdfParsing: '1 minute',
        aiExtraction: '2 minutes'
      },
      aiProviders: {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        google: !!process.env.GOOGLE_AI_API_KEY,
        deepseek: !!process.env.DEEPSEEK_API_KEY
      },
      supplierTemplates: ['PTP', 'GENERIC']
    }
  });
});

// Extraction endpoints
router.post('/extract-po', upload.single('pdf'), extractionController.extractFromPDF);
router.post('/extract-image', upload.single('image'), extractionController.extractFromImage);
router.post('/extract-excel', upload.single('excel'), extractionController.extractFromExcel);
router.post('/extract-email', upload.single('email'), extractionController.extractFromEmail);


// Get current prompt system status for a user
router.get('/prompt-system-status', extractionController.getPromptSystemStatus);

// Set user's prompt system preference  
router.post('/set-prompt-system-preference', extractionController.setPromptSystemPreference);

// Get prompt system analytics and performance data
router.get('/prompt-system-analytics', extractionController.getPromptSystemAnalytics);

// Test extraction with specific system (single file)
router.post('/test-extraction', upload.single('pdf'), extractionController.testExtraction);

// Batch comparison test (multiple files)
router.post('/batch-comparison-test', upload.array('files', 10), extractionController.batchComparisonTest);


// Duplicate and recommendations
router.post('/check-duplicate', duplicateController.checkDuplicate);
router.post('/get-recommendations', recommendationController.getRecommendations);

// Learning and categorization
router.post('/save-correction', recommendationController.saveCorrection);
router.post('/detect-category', recommendationController.detectCategory);

router.post('/bank-payments/extract', upload.single('file'), extractionController.extractBankPaymentSlip);

module.exports = router;
