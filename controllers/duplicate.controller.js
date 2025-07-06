// controllers/duplicate.controller.js
const { calculateSimilarity, stringSimilarity } = require('../utils/similarity');

exports.checkDuplicate = async (req, res) => {
  try {
    const { poData } = req.body;
    
    // Mock existing POs - in production, fetch from database
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
    
    // Check for duplicates
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
};
