// controllers/recommendation.controller.js
const { detectProductCategory, detectSupplierCategory } = require('../utils/helpers');
const fs = require('fs').promises;

exports.getRecommendations = async (req, res) => {
  try {
    const { poData } = req.body;
    
    const recommendations = {
      priceOptimization: getPriceRecommendations(poData),
      suppliers: getSupplierRecommendations(poData),
      inventory: getInventoryInsights(poData),
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
};

exports.saveCorrection = async (req, res) => {
  try {
    const { field, originalValue, correctedValue } = req.body;
    
    console.log('Learning from correction:', { 
      field, 
      originalValue, 
      correctedValue,
      timestamp: new Date().toISOString()
    });
    
    // Store corrections
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
};

exports.detectCategory = async (req, res) => {
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
};

// Helper functions
function getPriceRecommendations(poData) {
  if (!poData.items) return [];
  
  return poData.items.map(item => ({
    product: item.productName,
    currentPrice: item.unitPrice,
    recommendedPrice: item.unitPrice * 0.95,
    savings: item.unitPrice * 0.05,
    message: `5% savings possible with bulk order`
  }));
}

function getSupplierRecommendations(poData) {
  return [
    {
      name: 'Premium Industrial Supplies',
      rating: 4.8,
      matchScore: 0.92,
      reasons: ['Better prices', 'Faster delivery', 'Bulk discounts']
    }
  ];
}

function getInventoryInsights(poData) {
  if (!poData.items) return [];
  
  return poData.items.map(item => ({
    product: item.productName,
    currentStock: Math.floor(Math.random() * 100) + 20,
    afterOrder: Math.floor(Math.random() * 50),
    reorderPoint: 20,
    alert: Math.random() > 0.5 ? 'Low stock warning' : null
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
  }
  return null;
}

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
