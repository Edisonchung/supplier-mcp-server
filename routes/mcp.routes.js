//routes/mcp.routes.js - FIXED FOR USER CONTEXT FIELDS
const express = require('express');
const router = express.Router();
const multer = require('multer');
const MCPController = require('../controllers/mcp/MCPController');

// FIXED: Configure multer to handle user context fields
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB for text fields
    fields: 20, // Allow multiple non-file fields for user context
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 MCP - Received file:', {
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
      'text/plain',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported for MCP processing`), false);
    }
  }
});

// SOLUTION: Flexible upload for MCP routes that fixes MulterError
const flexibleUpload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
    fields: 30, // Generous limit for user context fields
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 MCP Flexible upload - received file:', {
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
      'text/plain',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported for MCP processing`), false);
    }
  }
}).any(); // Accept files and fields from any field name

const mcpController = new MCPController();

// === MCP System Management ===

// GET /api/mcp/status - Get MCP service status
router.get('/status', mcpController.getStatus.bind(mcpController));

// GET /api/mcp/capabilities - Get MCP capabilities  
router.get('/capabilities', mcpController.getCapabilities.bind(mcpController));

// GET /api/mcp/tools - List available MCP tools
router.get('/tools', mcpController.listTools.bind(mcpController));

// POST /api/mcp/tools/execute - Execute any MCP tool
router.post('/tools/execute', mcpController.executeTool.bind(mcpController));

// === MCP Enhanced Document Processing ===

// POST /api/mcp/extract - Enhanced document extraction
router.post('/extract', 
  upload.single('file'),
  mcpController.extractDocument.bind(mcpController)
);

// POST /api/mcp/classify - Document classification
router.post('/classify',
  mcpController.classifyDocument.bind(mcpController)
);

// POST /api/mcp/batch - Batch document processing
router.post('/batch',
  mcpController.processBatch.bind(mcpController)
);

// === MCP Intelligence Features ===

// POST /api/mcp/analyze/supplier - Supplier performance analysis
router.post('/analyze/supplier',
  mcpController.analyzeSupplier.bind(mcpController)
);

// POST /api/mcp/recommendations - Procurement recommendations
router.post('/recommendations',
  mcpController.getRecommendations.bind(mcpController)
);

// === MCP Streaming & Real-time Features ===

// POST /api/mcp/stream - Start streaming process
router.post('/stream',
  mcpController.startStreamProcess.bind(mcpController)
);

// === MCP Monitoring & Analytics ===

// GET /api/mcp/monitor - System monitoring
router.get('/monitor',
  mcpController.getSystemMonitoring.bind(mcpController)
);

// === FIXED Legacy Compatibility with MCP Enhancement ===

// FIXED: Use flexible upload for legacy routes to handle user context
router.post('/legacy/extract-po', (req, res, next) => {
  console.log('🔍 MCP Legacy PO extraction with flexible upload...');
  console.log('Headers:', req.headers['content-type']);
  
  flexibleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('❌ MCP Multer Error:', {
        code: err.code,
        field: err.field,
        message: err.message
      });
      
      return res.status(400).json({
        success: false,
        error: 'MCP file upload error',
        details: err.message,
        code: err.code
      });
    } else if (err) {
      console.error('❌ MCP Upload Error:', err);
      return res.status(400).json({
        success: false,
        error: 'MCP upload failed',
        details: err.message
      });
    }
    
    // Log received data for debugging
    console.log('📥 MCP Received files:', req.files?.length || 0);
    console.log('📥 MCP Received body fields:', Object.keys(req.body));
    
    // Extract file and user context
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
        error: 'No PDF file received for MCP processing',
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
    
    console.log('👤 MCP User context extracted:', userContext);
    
    // Attach file and user context to request for the controller
    req.file = pdfFile;
    req.userContext = userContext;
    req.body.documentType = 'purchase_order';
    
    // Continue to the actual extraction controller
    next();
  });
}, async (req, res) => {
  // Redirect to new MCP extraction endpoint
  return mcpController.extractDocument(req, res);
});

router.post('/legacy/extract-pi', (req, res, next) => {
  console.log('🔍 MCP Legacy PI extraction with flexible upload...');
  console.log('Headers:', req.headers['content-type']);
  
  flexibleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('❌ MCP PI Multer Error:', {
        code: err.code,
        field: err.field,
        message: err.message
      });
      
      return res.status(400).json({
        success: false,
        error: 'MCP PI file upload error',
        details: err.message,
        code: err.code
      });
    } else if (err) {
      console.error('❌ MCP PI Upload Error:', err);
      return res.status(400).json({
        success: false,
        error: 'MCP PI upload failed',
        details: err.message
      });
    }
    
    // Log received data for debugging
    console.log('📥 MCP PI Received files:', req.files?.length || 0);
    console.log('📥 MCP PI Received body fields:', Object.keys(req.body));
    
    // Extract file and user context
    let file = null;
    if (req.files && req.files.length > 0) {
      file = req.files[0]; // Take first file for PI processing
    }
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file received for MCP PI processing',
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
    
    console.log('👤 MCP PI User context extracted:', userContext);
    
    // Attach file and user context to request for the controller
    req.file = file;
    req.userContext = userContext;
    req.body.documentType = 'proforma_invoice';
    
    // Continue to the actual extraction controller
    next();
  });
}, async (req, res) => {
  // Redirect to new MCP extraction endpoint  
  return mcpController.extractDocument(req, res);
});

// === Enhanced Error Handling ===

router.use((error, req, res, next) => {
  console.error('🚨 MCP Route Error:', error);
  
  if (error instanceof multer.MulterError) {
    console.error('🚨 Detailed MCP Multer Error:', {
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
          error: 'Unexpected field in MCP upload. This should be fixed now.',
          code: 'UNEXPECTED_FIELD',
          field: error.field,
          suggestion: 'Try the request again - the flexible upload should handle this.'
        });
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many fields in MCP request',
          code: 'TOO_MANY_FIELDS'
        });
      default:
        return res.status(400).json({
          success: false,
          error: `MCP upload error: ${error.message}`,
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
        'PDF', 'JPEG', 'PNG', 'TIFF', 'Excel', 'Text', 'CSV'
      ]
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal MCP service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// === API Documentation Helper ===

router.get('/docs', (req, res) => {
  res.json({
    service: 'HiggsFlow MCP API',
    version: '2.0.1-multer-fixed',
    description: 'Model Context Protocol enhanced API for advanced AI capabilities. FIXED: MulterError user context handling.',
    recent_fixes: [
      'Fixed MulterError: Unexpected field for user context handling',
      'Added flexible upload configuration for legacy MCP routes',
      'Enhanced error reporting for MCP multer issues',
      'Improved user context extraction from FormData'
    ],
    endpoints: {
      system: [
        'GET /api/mcp/status - Service status',
        'GET /api/mcp/capabilities - Available capabilities',
        'GET /api/mcp/tools - List MCP tools',
        'POST /api/mcp/tools/execute - Execute MCP tool'
      ],
      document_processing: [
        'POST /api/mcp/extract - Enhanced document extraction',
        'POST /api/mcp/classify - Document classification',
        'POST /api/mcp/batch - Batch processing'
      ],
      intelligence: [
        'POST /api/mcp/analyze/supplier - Supplier analysis',
        'POST /api/mcp/recommendations - Procurement recommendations'
      ],
      streaming: [
        'POST /api/mcp/stream - Start streaming process'
      ],
      monitoring: [
        'GET /api/mcp/monitor - System monitoring'
      ],
      legacy: [
        'POST /api/mcp/legacy/extract-po - Legacy PO extraction (FIXED for user context)',
        'POST /api/mcp/legacy/extract-pi - Legacy PI extraction (FIXED for user context)'
      ]
    },
    features: [
      'Model Context Protocol (MCP) integration',
      'Real-time WebSocket communication',
      'Advanced AI tool orchestration',
      'Multi-provider AI fallback',
      'Supplier-specific intelligence',
      'Batch processing capabilities',
      'Real-time monitoring',
      'Legacy API compatibility',
      'Streaming process support',
      'FIXED: User context handling in MulterError'
    ],
    user_context_support: {
      fields: ['email', 'userEmail', 'role', 'uid', 'testMode', 'debug'],
      method: 'FormData with flexible field names',
      status: 'FIXED - no more MulterError in MCP routes'
    },
    websocket: {
      endpoint: `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`,
      description: 'Real-time MCP communication and streaming processes'
    },
    mcp_tools: [
      'extract_purchase_order - Enhanced document extraction',
      'analyze_supplier_performance - Supplier intelligence',
      'generate_procurement_recommendations - AI recommendations',
      'classify_document - Document classification',
      'batch_process_documents - Batch processing',
      'system_health_check - System monitoring'
    ]
  });
});

module.exports = router;
