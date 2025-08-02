//routes/ai.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const ModularAIController = require('../controllers/ai/ModularAIController');

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`), false);
    }
  }
});

const aiController = new ModularAIController();

// === Core AI Management Endpoints ===

// GET /api/ai/health - AI system health check
router.get('/health', aiController.getSystemHealth.bind(aiController));

// GET /api/ai/test - Quick functionality test
router.get('/test', aiController.quickTest.bind(aiController));

// === Module Management ===

// GET /api/ai/modules - Get all AI modules
router.get('/modules', aiController.getAllModules.bind(aiController));

// GET /api/ai/modules/:moduleId - Get specific module
router.get('/modules/:moduleId', aiController.getModule.bind(aiController));

// PUT /api/ai/modules/:moduleId - Update module
router.put('/modules/:moduleId', aiController.updateModule.bind(aiController));

// === Prompt Management ===

// GET /api/ai/prompts - Get all prompts (optionally filtered by moduleId)
router.get('/prompts', aiController.getAllPrompts.bind(aiController));

// POST /api/ai/prompts - Save/update prompt
router.post('/prompts', aiController.savePrompt.bind(aiController));

// POST /api/ai/prompts/test - Test a prompt
router.post('/prompts/test', aiController.testPrompt.bind(aiController));

// === Document Processing Endpoints ===

// POST /api/ai/extract/document - Generic document extraction
router.post('/extract/document', 
  upload.single('file'), 
  aiController.extractDocument.bind(aiController)
);

// POST /api/ai/extract/purchase-order - Enhanced PO extraction
router.post('/extract/purchase-order', 
  upload.single('file'), 
  aiController.extractPurchaseOrder.bind(aiController)
);

// POST /api/ai/extract/proforma-invoice - Enhanced PI extraction
router.post('/extract/proforma-invoice', 
  upload.single('file'), 
  aiController.extractProformaInvoice.bind(aiController)
);

// === Legacy Compatibility Endpoints ===

// These maintain backward compatibility with existing frontend
router.post('/extract-po', upload.single('pdf'), async (req, res) => {
  req.body.documentType = 'purchase_order';
  return aiController.extractPurchaseOrder(req, res);
});

router.post('/extract-pi', upload.single('file'), async (req, res) => {
  req.body.documentType = 'proforma_invoice';
  return aiController.extractProformaInvoice(req, res);
});

// === Error Handling Middleware ===

router.use((error, req, res, next) => {
  console.error('AI Route Error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 50MB.',
        code: 'FILE_TOO_LARGE'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field. Use "file" field name.',
        code: 'UNEXPECTED_FILE'
      });
    }
  }
  
  if (error.message.includes('File type') && error.message.includes('not supported')) {
    return res.status(400).json({
      success: false,
      error: error.message,
      code: 'UNSUPPORTED_FILE_TYPE',
      supported_types: [
        'PDF', 'JPEG', 'PNG', 'TIFF', 'Excel', 'Text'
      ]
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal AI service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// === API Documentation ===

router.get('/docs', (req, res) => {
  res.json({
    service: 'HiggsFlow Modular AI API',
    version: '2.0.0',
    description: 'Modular AI service with multi-provider support and supplier-specific intelligence',
    endpoints: {
      system: [
        'GET /api/ai/health - System health check',
        'GET /api/ai/test - Quick functionality test'
      ],
      modules: [
        'GET /api/ai/modules - List all modules',
        'GET /api/ai/modules/:id - Get specific module',
        'PUT /api/ai/modules/:id - Update module'
      ],
      prompts: [
        'GET /api/ai/prompts - List all prompts',
        'POST /api/ai/prompts - Save/update prompt',
        'POST /api/ai/prompts/test - Test prompt'
      ],
      extraction: [
        'POST /api/ai/extract/document - Generic extraction',
        'POST /api/ai/extract/purchase-order - PO extraction',
        'POST /api/ai/extract/proforma-invoice - PI extraction'
      ],
      legacy: [
        'POST /api/ai/extract-po - Legacy PO extraction',
        'POST /api/ai/extract-pi - Legacy PI extraction'
      ]
    },
    features: [
      'Multi-provider AI support (DeepSeek, OpenAI, Claude, Google)',
      'Supplier-specific processing (PTP optimization)',
      'Modular architecture with configurable prompts',
      'Performance tracking and analytics',
      'Automatic fallback between AI providers',
      'Enhanced document extraction accuracy'
    ],
    file_support: [
      'PDF documents',
      'Images (JPEG, PNG, TIFF)',
      'Excel files (XLSX, XLS)',
      'Plain text files'
    ]
  });
});

module.exports = router;
