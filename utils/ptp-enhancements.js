const { identifySupplier } = require('../utils/supplierTemplates');

// Get PTP-specific prompt
const getPTPSpecificPrompt = () => {
  return `
    Extract purchase order information from this PT. PERINTIS TEKNOLOGI PERDANA document.
    
    CRITICAL PTP-SPECIFIC RULES:
    1. This supplier uses a multi-line format where product names appear BELOW the part number line
    2. The format is: Line Number | Part Number | Quantity | UOM | Price
    3. The product description/name is on the NEXT LINE below, indented
    4. NEVER use UOM values (PCS, UNI, SET, EA, etc.) as the product name
    5. Look for descriptive text on the line following the part number
    
    Example PTP Format:
    Line  Part Number
    1     400QCR1068                     1.00   PCS   20,500.00
          THRUSTER                       <-- This is the product name
    2     B247K18x12x1000                10.00  UNI   325,000.00  
          RUBBER HOSE                    <-- This is the product name
    
    Return a JSON object with proper product names extracted from the lines below part numbers.
    
    Structure:
    {
      "poNumber": "string",
      "dateIssued": "string (ISO format)",
      "supplier": {
        "name": "PT. PERINTIS TEKNOLOGI PERDANA",
        "address": "string",
        "contact": "string"
      },
      "items": [
        {
          "lineNumber": number,
          "productCode": "string (the part number)",
          "productName": "string (from the line below part number, NEVER a UOM)",
          "quantity": number,
          "unit": "string (PCS/UNI/SET/etc)",
          "unitPrice": number,
          "totalPrice": number
        }
      ],
      "totals": {
        "subtotal": number,
        "tax": number,
        "grandTotal": number
      },
      "deliveryDate": "string (ISO format)",
      "paymentTerms": "string"
    }
    
    Return ONLY valid JSON.`;
};

// Apply PTP-specific post-processing rules
const applyPTPRules = (extractedData, originalText) => {
  if (extractedData.items) {
    extractedData.items = extractedData.items.map(item => {
      // Fix common PTP extraction errors
      if (['PCS', 'UNI', 'SET', 'EA', 'UNIT'].includes(item.productName)) {
        console.log(`Fixing PTP extraction: "${item.productName}" is not a valid product name`);
        
        // Try to find the real product name
        const lines = originalText.split('\n');
        const codeLineIndex = lines.findIndex(line => 
          item.productCode && line.includes(item.productCode)
        );
        
        if (codeLineIndex !== -1 && codeLineIndex < lines.length - 1) {
          const nextLine = lines[codeLineIndex + 1].trim();
          if (nextLine && 
              !['PCS', 'UNI', 'SET', 'EA'].includes(nextLine) && 
              !/^\d+\.?\d*$/.test(nextLine) && // Not just numbers
              nextLine.length > 2) {
            item.productName = nextLine;
            console.log(`Fixed product name to: "${nextLine}"`);
          }
        }
      }
      
      return item;
    });
  }
  
  // Ensure supplier name is correct for PTP
  if (extractedData.supplier) {
    extractedData.supplier.name = 'PT. PERINTIS TEKNOLOGI PERDANA';
  }
  
  return extractedData;
};
