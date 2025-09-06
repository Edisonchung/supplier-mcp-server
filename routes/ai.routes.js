//routes/ai.routes.js - UPDATED WITH MULTER FIX FOR USER CONTEXT
const express = require('express');
const router = express.Router();
const multer = require('multer');
const ModularAIController = require('../controllers/ai/ModularAIController');

// FIXED: Configure multer to handle user context fields
const storage = multer.memoryStorage(); // Use memory storage for better handling

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB for text fields
    fields: 20, // Allow multiple non-file fields for user context
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 Received file:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    
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

// SOLUTION: Flexible upload that accepts any field names (fixes MulterError)
const flexibleUpload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
    fields: 30, // Generous limit for user context fields
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 Flexible upload - received file:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    
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
}).any(); // Accept files and fields from any field name

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

// === Prompt Management with Enhanced Error Handling ===

// GET /api/ai/prompts - Get all prompts (optionally filtered by moduleId)
router.get('/prompts', async (req, res) => {
  try {
    console.log('📋 GET /api/ai/prompts called');
    return await aiController.getAllPrompts(req, res);
  } catch (error) {
    console.error('❌ GET /prompts error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: 'GET /api/ai/prompts'
    });
  }
});

// 🔧 DEBUG: Add debug route for troubleshooting
router.post('/prompts/debug', async (req, res) => {
  try {
    console.log('🔍 Debug route called with body:', req.body);
    
    // Test if UnifiedAIService exists
    const UnifiedAIService = require('../services/ai/UnifiedAIService');
    console.log('✅ UnifiedAIService loaded');
    
    // Test if we can create instance
    const aiService = new UnifiedAIService();
    console.log('✅ UnifiedAIService instance created');
    
    // Test if we can wait for initialization
    await aiService.initPromise;
    console.log('✅ UnifiedAIService initialized');
    
    // Test if we can get prompts
    const prompts = await aiService.getPrompts();
    console.log(`✅ Got ${prompts.length} prompts`);
    
    // Test basic prompt data
    const testPromptData = {
      name: "Debug Test Prompt",
      prompt: "This is a test prompt for debugging Firebase integration",
      category: "test",
      aiProvider: "deepseek",
      temperature: 0.1,
      maxTokens: 1000,
      isActive: true,
      suppliers: ['ALL']
    };
    
    console.log('🔍 Testing prompt save with data:', testPromptData);
    
    // Try to save
    const result = await aiService.savePrompt(testPromptData);
    console.log('✅ Save result:', result);
    
    // Try to get the saved prompt
    const allPromptsAfter = await aiService.getPrompts();
    console.log(`✅ Prompts after save: ${allPromptsAfter.length}`);
    
    res.json({
      success: true,
      message: 'Debug test completed successfully',
      data: {
        promptsCountBefore: prompts.length,
        promptsCountAfter: allPromptsAfter.length,
        saveResult: result,
        testPromptData,
        firebaseStatus: 'working'
      }
    });
    
  } catch (error) {
    console.error('❌ Debug route error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : 'Error details hidden in production',
      route: 'POST /api/ai/prompts/debug'
    });
  }
});

// 🔧 SIMPLE: Direct PromptManager test
router.post('/prompts/simple-test', async (req, res) => {
  try {
    console.log('🧪 Simple test route called');
    
    // Direct call to PromptManager
    const PromptManager = require('../services/ai/PromptManager');
    const promptManager = new PromptManager();
    
    // Give it time to initialize Firebase
    console.log('⏳ Waiting for PromptManager initialization...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const testPrompt = {
      name: "Simple Test Prompt",
      prompt: "Direct test of PromptManager Firebase integration",
      category: "test",
      aiProvider: "deepseek"
    };
    
    console.log('💾 Attempting direct save...');
    const result = await promptManager.savePrompt(testPrompt);
    console.log('✅ Direct save result:', result);
    
    res.json({
      success: true,
      message: 'Simple test completed',
      result,
      method: 'direct_prompt_manager'
    });
    
  } catch (error) {
    console.error('❌ Simple test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: 'POST /api/ai/prompts/simple-test'
    });
  }
});

// POST /api/ai/prompts - Create new prompt with enhanced error handling
router.post('/prompts', async (req, res) => {
  try {
    console.log('🔍 POST /api/ai/prompts called with body:', req.body);
    
    // Validate required fields
    if (!req.body.name || !req.body.prompt) {
      return res.status(400).json({
        success: false,
        error: 'Name and prompt content are required',
        route: 'POST /api/ai/prompts'
      });
    }
    
    // Check if controller exists and is properly initialized
    if (!aiController) {
      throw new Error('AI Controller not initialized');
    }
    
    // Check if the method exists
    if (typeof aiController.savePrompt !== 'function') {
      throw new Error('savePrompt method not found on controller');
    }
    
    console.log('✅ Calling controller.savePrompt...');
    return await aiController.savePrompt(req, res);
    
  } catch (error) {
    console.error('❌ POST /prompts error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Error in POST /api/ai/prompts route',
      route: 'POST /api/ai/prompts',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PUT /api/ai/prompts/:id - Update existing prompt with enhanced error handling
router.put('/prompts/:id', async (req, res) => {
  try {
    console.log(`🔍 PUT /api/ai/prompts/${req.params.id} called`);
    return await aiController.updatePrompt(req, res);
  } catch (error) {
    console.error('❌ PUT /prompts/:id error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: `PUT /api/ai/prompts/${req.params.id}`
    });
  }
});

// DELETE /api/ai/prompts/:id - Delete prompt with enhanced error handling
router.delete('/prompts/:id', async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/ai/prompts/${req.params.id} called`);
    return await aiController.deletePrompt(req, res);
  } catch (error) {
    console.error('❌ DELETE /prompts/:id error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: `DELETE /api/ai/prompts/${req.params.id}`
    });
  }
});

// POST /api/ai/prompts/test - Test a prompt with data
router.post('/prompts/test', async (req, res) => {
  try {
    console.log('🧪 POST /api/ai/prompts/test called');
    return await aiController.testPrompt(req, res);
  } catch (error) {
    console.error('❌ POST /prompts/test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: 'POST /api/ai/prompts/test'
    });
  }
});

// GET /api/ai/prompts/:id - Get individual prompt details
router.get('/prompts/:id', async (req, res) => {
  try {
    console.log(`📋 GET /api/ai/prompts/${req.params.id} called`);
    return await aiController.getPrompt(req, res);
  } catch (error) {
    console.error('❌ GET /prompts/:id error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: `GET /api/ai/prompts/${req.params.id}`
    });
  }
});

// POST /api/ai/prompts/:id/test - Test specific prompt
router.post('/prompts/:id/test', async (req, res) => {
  try {
    console.log(`🧪 POST /api/ai/prompts/${req.params.id}/test called`);
    return await aiController.testSpecificPrompt(req, res);
  } catch (error) {
    console.error('❌ POST /prompts/:id/test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      route: `POST /api/ai/prompts/${req.params.id}/test`
    });
  }
});

// 🔧 ADD: Health check specifically for prompt system
router.get('/prompts/health', async (req, res) => {
  try {
    console.log('🏥 AI Prompts health check...');
    
    // Test the entire prompt system
    const UnifiedAIService = require('../services/ai/UnifiedAIService');
    const aiService = new UnifiedAIService();
    await aiService.initPromise;
    
    const prompts = await aiService.getPrompts();
    const health = await aiService.healthCheck();
    
    res.json({
      success: true,
      message: 'AI Prompts system is healthy',
      data: {
        promptsCount: prompts.length,
        systemHealth: health.status,
        firebase: health.firebase || { status: 'unknown' }
      }
    });
    
  } catch (error) {
    console.error('❌ AI Prompts health check failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      service: 'ai-prompts-service'
    });
  }
});

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

// === FIXED Legacy Compatibility Endpoints ===

// FIXED: Use flexible upload for extract-po to handle user context fields
router.post('/extract-po', (req, res, next) => {
  console.log('🔍 Starting PDF extraction with flexible upload...');
  console.log('Headers:', req.headers['content-type']);
  
  // Use flexible upload to handle any field configuration
  flexibleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('❌ Multer Error:', {
        code: err.code,
        field: err.field,
        message: err.message
      });
      
      return res.status(400).json({
        success: false,
        error: 'File upload error',
        details: err.message,
        code: err.code
      });
    } else if (err) {
      console.error('❌ Upload Error:', err);
      return res.status(400).json({
        success: false,
        error: 'Upload failed',
        details: err.message
      });
    }
    
    // Log received data for debugging
    console.log('📥 Received files:', req.files?.length || 0);
    console.log('📥 Received body fields:', Object.keys(req.body));
    
    // Find the PDF file from any field
    let pdfFile = null;
    if (req.files && req.files.length > 0) {
      pdfFile = req.files.find(file => 
        file.mimetype === 'application/pdf' || 
        file.originalname.endsWith('.pdf')
      );
    }
    
    if (!pdfFile) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file received',
        received_files: req.files?.map(f => ({ 
          fieldname: f.fieldname, 
          filename: f.originalname,
          mimetype: f.mimetype 
        })) || []
      });
    }
    
    // Extract user context from body
    const userContext = {
      email: req.body.email || req.body.userEmail || 'anonymous',
      role: req.body.role || 'user',
      uid: req.body.uid || null,
      testMode: req.body.testMode === 'true' || req.body.testMode === true,
      debug: req.body.debug === 'true' || req.body.debug === true
    };
    
    console.log('👤 User context extracted:', userContext);
    
    // Attach file and user context to request for the controller
    req.file = pdfFile;
    req.userContext = userContext;
    req.body.documentType = 'purchase_order';
    
    // Continue to the actual extraction controller
    next();
  });
}, aiController.extractPurchaseOrder.bind(aiController));

// Keep original extract-pi endpoint
router.post('/extract-pi', upload.single('file'), async (req, res) => {
  req.body.documentType = 'proforma_invoice';
  return aiController.extractProformaInvoice(req, res);
});

// === Enhanced Error Handling Middleware ===

router.use((error, req, res, next) => {
  console.error('🚨 AI Route Error:', error);
  
  if (error instanceof multer.MulterError) {
    console.error('🚨 Detailed Multer Error:', {
      code: error.code,
      message: error.message,
      field: error.field,
      stack: error.stack
    });
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          error: 'File too large. Maximum size is 50MB.',
          code: 'FILE_TOO_LARGE'
        });
      case 'LIMIT_UNEXPECTED_FILE':
      case 'UNEXPECTED_FIELD':
        return res.status(400).json({
          success: false,
          error: 'Unexpected field in upload. This should be fixed now.',
          code: 'UNEXPECTED_FIELD',
          field: error.field,
          suggestion: 'Try the request again - the flexible upload should handle this.'
        });
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many fields',
          code: 'TOO_MANY_FIELDS'
        });
      default:
        return res.status(400).json({
          success: false,
          error: `Upload error: ${error.message}`,
          code: error.code
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
  
  // Enhanced error response
  res.status(500).json({
    success: false,
    error: 'Internal AI service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// === API Documentation (UPDATED) ===

router.get('/docs', (req, res) => {
  res.json({
    service: 'HiggsFlow Modular AI API',
    version: '2.0.2-multer-fixed',
    description: 'Modular AI service with multi-provider support, supplier-specific intelligence, and Firebase persistence. FIXED: MulterError user context handling.',
    recent_fixes: [
      'Fixed MulterError: Unexpected field for user context handling',
      'Added flexible upload configuration for extract-po endpoint',
      'Enhanced error reporting for multer issues',
      'Improved user context extraction from FormData'
    ],
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
        'GET /api/ai/prompts/:id - Get individual prompt',
        'POST /api/ai/prompts - Create new prompt',
        'PUT /api/ai/prompts/:id - Update existing prompt',
        'DELETE /api/ai/prompts/:id - Delete prompt',
        'POST /api/ai/prompts/test - Test prompt with data',
        'POST /api/ai/prompts/:id/test - Test specific prompt',
        'GET /api/ai/prompts/health - Prompt system health check'
      ],
      debug: [
        'POST /api/ai/prompts/debug - Debug Firebase integration',
        'POST /api/ai/prompts/simple-test - Direct PromptManager test'
      ],
      extraction: [
        'POST /api/ai/extract/document - Generic extraction',
        'POST /api/ai/extract/purchase-order - PO extraction',
        'POST /api/ai/extract/proforma-invoice - PI extraction'
      ],
      legacy: [
        'POST /api/ai/extract-po - Legacy PO extraction (FIXED for user context)',
        'POST /api/ai/extract-pi - Legacy PI extraction'
      ]
    },
    features: [
      'Multi-provider AI support (DeepSeek, OpenAI, Claude, Google)',
      'Supplier-specific processing (PTP optimization)',
      'Modular architecture with configurable prompts',
      'Performance tracking and analytics',
      'Automatic fallback between AI providers',
      'Enhanced document extraction accuracy',
      'Full CRUD operations for prompt management',
      'Individual prompt testing and validation',
      'Firebase Firestore persistence',
      'Zero data loss on deployments',
      'Enhanced debugging capabilities',
      'FIXED: User context handling in MulterError'
    ],
    file_support: [
      'PDF documents',
      'Images (JPEG, PNG, TIFF)',
      'Excel files (XLSX, XLS)',
      'Plain text files'
    ],
    user_context_support: {
      fields: ['email', 'userEmail', 'role', 'uid', 'testMode', 'debug'],
      method: 'FormData or URL parameters',
      status: 'FIXED - no more MulterError'
    },
    firebase: {
      storage: 'firestore',
      persistence: 'permanent',
      project: 'higgsflow-b9f81'
    },
    prompt_management: {
      crud_operations: {
        create: 'POST /api/ai/prompts',
        read: 'GET /api/ai/prompts or GET /api/ai/prompts/:id',
        update: 'PUT /api/ai/prompts/:id',
        delete: 'DELETE /api/ai/prompts/:id'
      },
      testing: {
        batch_test: 'POST /api/ai/prompts/test',
        individual_test: 'POST /api/ai/prompts/:id/test'
      },
      debugging: {
        debug_test: 'POST /api/ai/prompts/debug',
        simple_test: 'POST /api/ai/prompts/simple-test',
        health_check: 'GET /api/ai/prompts/health'
      }
    }
  });
});

module.exports = router;
