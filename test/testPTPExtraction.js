const { identifySupplier } = require('../utils/supplierTemplates');

// Test supplier detection
const testTexts = {
  ptp: `
PURCHASE ORDER
PT. PERINTIS TEKNOLOGI PERDANA
Kawasan Industri Pulogadung
Jakarta, Indonesia

PO Number: PO/PTP/2024/001

Line  Part Number
1     400QCR1068                     1.00   PCS   20,500.00
      THRUSTER
2     B247K18x12x1000                10.00  UNI   325,000.00  
      RUBBER HOSE
`,
  generic: `
PURCHASE ORDER
Some Other Company Ltd.
123 Business Street

PO Number: PO/2024/001
`
};

console.log('=== Testing PTP Supplier Detection ===\n');

for (const [key, text] of Object.entries(testTexts)) {
  const result = identifySupplier(text);
  console.log(`Test ${key}:`);
  console.log(`  Detected supplier: ${result.supplier}`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Template: ${result.template ? 'Yes' : 'No'}`);
  console.log('');
}

console.log('Expected results:');
console.log('- PTP text should detect supplier as "PTP" with confidence > 0');
console.log('- Generic text should detect supplier as "GENERIC" with confidence 0');

// Test the extraction flow
console.log('\n=== PTP Extraction Flow ===');
console.log('1. PDF uploaded → extractFromPDF()');
console.log('2. Text extracted → identifySupplier() detects PTP');
console.log('3. extractWithAI() uses getPTPSpecificPrompt()');
console.log('4. AI returns data → applyPTPRules() fixes UOM issues');
console.log('5. Response includes supplier metadata');

console.log('\n=== Example: Fixing PCS → THRUSTER ===');
console.log('Before PTP rules:');
console.log('  { productName: "PCS", productCode: "400QCR1068" }');
console.log('After PTP rules:');
console.log('  { productName: "THRUSTER", productCode: "400QCR1068" }');
