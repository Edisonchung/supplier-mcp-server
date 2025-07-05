// utils/mockData.js

const clients = [
  { name: "Tech Solutions Sdn Bhd", contact: "Ahmad Ibrahim", email: "ahmad@techsolutions.my", phone: "+60 12-345 6789" },
  { name: "Global Electronics Ltd", contact: "Sarah Chen", email: "sarah@globalelec.com", phone: "+60 13-456 7890" },
  { name: "Industrial Supply Co", contact: "John Tan", email: "john@industrialsupply.my", phone: "+60 14-567 8901" },
  { name: "Prime Components Asia", contact: "Lisa Wong", email: "lisa@primecomp.asia", phone: "+60 15-678 9012" },
  { name: "MegaTech Industries", contact: "David Lee", email: "david@megatech.com", phone: "+60 16-789 0123" }
];

const products = [
  { name: "Industrial Sensor Module", code: "ISM-2024", unitPrice: 450.00, category: "Electronics" },
  { name: "Control Panel Unit", code: "CPU-100", unitPrice: 1200.00, category: "Industrial" },
  { name: "Pressure Valve Assembly", code: "PVA-250", unitPrice: 850.00, category: "Industrial" },
  { name: "Temperature Controller", code: "TC-500", unitPrice: 650.00, category: "Electronics" },
  { name: "Safety Switch Module", code: "SSM-300", unitPrice: 320.00, category: "Safety" },
  { name: "Motor Drive Unit", code: "MDU-750", unitPrice: 2200.00, category: "Industrial" },
  { name: "Digital Display Panel", code: "DDP-400", unitPrice: 480.00, category: "Electronics" },
  { name: "Emergency Stop Button", code: "ESB-100", unitPrice: 85.00, category: "Safety" }
];

function generateDynamicMockData() {
  // Randomly select client
  const selectedClient = clients[Math.floor(Math.random() * clients.length)];
  
  // Randomly select 1-4 products
  const numItems = Math.floor(Math.random() * 3) + 1;
  const selectedProducts = [];
  const usedIndices = new Set();
  
  while (selectedProducts.length < numItems) {
    const index = Math.floor(Math.random() * products.length);
    if (!usedIndices.has(index)) {
      usedIndices.add(index);
      const product = products[index];
      const quantity = Math.floor(Math.random() * 10) + 1;
      selectedProducts.push({
        ...product,
        quantity,
        totalPrice: quantity * product.unitPrice,
        stockAvailable: Math.floor(Math.random() * 100) + 10
      });
    }
  }

  // Generate unique PO number
  const poNumber = `PO-2024-${Date.now().toString().slice(-4)}`;
  
  // Random dates
  const orderDate = new Date();
  const requiredDate = new Date();
  requiredDate.setDate(requiredDate.getDate() + Math.floor(Math.random() * 30) + 15);

  return {
    clientPoNumber: poNumber,
    clientName: selectedClient.name,
    clientContact: selectedClient.contact,
    clientEmail: selectedClient.email,
    clientPhone: selectedClient.phone,
    orderDate: orderDate.toISOString().split('T')[0],
    requiredDate: requiredDate.toISOString().split('T')[0],
    items: selectedProducts,
    paymentTerms: ["Net 30", "Net 60", "2/10 Net 30", "Due on Receipt"][Math.floor(Math.random() * 4)],
    deliveryTerms: ["FOB", "CIF", "DDP", "EXW"][Math.floor(Math.random() * 4)],
    
    _validation: {
      errors: [],
      warnings: Math.random() > 0.5 ? [
        {
          field: "clientEmail",
          message: "Email format corrected",
          original: selectedClient.email.replace('.com', ',com'),
          corrected: selectedClient.email
        }
      ] : [],
      corrections: {}
    },
    
    warnings: Math.random() > 0.8 ? [{
      type: "duplicate",
      message: `Similar PO found: PO-2024-${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`,
      similarPO: {
        poNumber: `PO-2024-${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`,
        clientName: selectedClient.name,
        orderDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        totalAmount: Math.floor(Math.random() * 10000) + 1000
      }
    }] : [],
    
    recommendations: generateRecommendations(selectedProducts)
  };
}

function generateRecommendations(items) {
  return [
    {
      type: "price_optimization",
      title: "Cost Saving Opportunities",
      items: items.slice(0, 1).map(item => ({
        product: item.name,
        currentPrice: item.unitPrice,
        averagePrice: item.unitPrice * 0.93,
        potentialSaving: item.unitPrice * 0.07,
        message: `Price is 7% above market average`
      }))
    },
    {
      type: "supplier_recommendation",
      title: "Alternative Suppliers",
      suppliers: [{
        name: ["Premium Electronic Supplies", "Industrial Components Ltd", "TechPro Solutions"][Math.floor(Math.random() * 3)],
        rating: (4.5 + Math.random() * 0.5).toFixed(1),
        recommendationScore: Math.floor(Math.random() * 10) + 85,
        reasons: ["Better pricing", "Faster delivery", "Quality certified"]
      }]
    }
  ];
}

module.exports = {
  generateDynamicMockData,
  clients,
  products
};
