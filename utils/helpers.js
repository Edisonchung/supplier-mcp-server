// utils/helpers.js

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
  
  const correctionBoost = validation.warnings.filter(w => w.corrected).length * 0.02;
  
  return Math.min(0.99, confidence + correctionBoost);
}

module.exports = {
  detectProductCategory,
  detectSupplierCategory,
  getFileType,
  calculateConfidence
};
