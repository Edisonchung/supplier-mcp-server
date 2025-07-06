// Supplier Template Definitions
const supplierTemplates = {
  PTP: {
    id: 'PTP',
    name: 'PT. PERINTIS TEKNOLOGI PERDANA',
    patterns: [
      'PT. PERINTIS TEKNOLOGI PERDANA',
      'PT PERINTIS TEKNOLOGI',
      'Kawasan Industri Pulogadung',
      'PERINTIS TEKNOLOGI'
    ],
    extractionRules: {
      productName: {
        location: 'NEXT_LINE_AFTER_PART_NUMBER',
        validation: 'NOT_UOM'
      }
    }
  }
};

// Identify supplier from document text
const identifySupplier = (text) => {
  for (const [key, template] of Object.entries(supplierTemplates)) {
    const matchCount = template.patterns.filter(pattern => 
      text.toUpperCase().includes(pattern.toUpperCase())
    ).length;
    
    if (matchCount > 0) {
      return {
        supplier: key,
        template: template,
        confidence: matchCount / template.patterns.length
      };
    }
  }
  
  return { supplier: 'GENERIC', template: null, confidence: 0 };
};

module.exports = { supplierTemplates, identifySupplier };
