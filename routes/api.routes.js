// routes/api.routes.js
const express = require('express');
const router = express.Router();
const upload = require('../config/multer');

// Controllers
const extractionController = require('../controllers/extraction.controller');
const duplicateController = require('../controllers/duplicate.controller');
const recommendationController = require('../controllers/recommendation.controller');

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Enhanced MCP Server is running',
    features: ['pdf', 'image', 'excel', 'email', 'multi-ai', 'validation', 'recommendations']
  });
});

// Extraction endpoints
router.post('/extract-po', upload.single('pdf'), extractionController.extractFromPDF);
router.post('/extract-image', upload.single('image'), extractionController.extractFromImage);
router.post('/extract-excel', upload.single('excel'), extractionController.extractFromExcel);
router.post('/extract-email', upload.single('email'), extractionController.extractFromEmail);

// Duplicate and recommendations
router.post('/check-duplicate', duplicateController.checkDuplicate);
router.post('/get-recommendations', recommendationController.getRecommendations);

// Learning and categorization
router.post('/save-correction', recommendationController.saveCorrection);
router.post('/detect-category', recommendationController.detectCategory);

module.exports = router;
