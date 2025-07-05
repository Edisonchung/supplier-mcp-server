// controllers/extraction.controller.js
const fs = require('fs').promises;
const extractionService = require('../services/extraction');
const { generateDynamicMockData } = require('../utils/mockData');

// Main PO extraction
exports.extractPO = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log('Processing file:', file.originalname, 'Type:', file.mimetype);
    
    // For now, return enhanced mock data
    // In production, use: const data = await extractionService.extractFromFile(file);
    const data = generateDynamicMockData();
    
    // Clean up uploaded file
    if (file.path) {
      fs.unlink(file.path).catch(err => console.error('Error deleting file:', err));
    }
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    res.json({
      success: true,
      data,
      model: "enhanced-ai-v2",
      confidence: 0.90 + Math.random() * 0.09,
      processingTime: (Date.now() - startTime) / 1000
    });
    
  } catch (error) {
    console.error('Extraction error:', error);
    
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to extract data',
      message: error.message 
    });
  }
};

// Image extraction
exports.extractImage = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    
    // Use extraction service for images
    const data = await extractionService.extractFromImage(file.path);
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data,
      model: 'vision-ai'
    });
  } catch (error) {
    console.error('Image extraction error:', error);
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Failed to extract from image' });
  }
};

// Excel extraction
exports.extractExcel = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }
    
    const data = await extractionService.extractFromExcel(file.path);
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data,
      model: 'excel-parser'
    });
  } catch (error) {
    console.error('Excel extraction error:', error);
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Failed to extract from Excel' });
  }
};

// Email extraction
exports.extractEmail = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No email file uploaded' });
    }
    
    const data = await extractionService.extractFromEmail(file.path);
    await fs.unlink(file.path);
    
    res.json({
      success: true,
      data,
      model: 'email-parser'
    });
  } catch (error) {
    console.error('Email extraction error:', error);
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Failed to extract from email' });
  }
};
