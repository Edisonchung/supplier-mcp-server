//routes/mcp.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const MCPController = require('../controllers/mcp/MCPController');

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

// === Legacy Compatibility with MCP Enhancement ===

// These routes provide backward compatibility while upgrading to MCP
router.post('/legacy/extract-po', 
  upload.single('pdf'),
  async (req, res) => {
    // Redirect to new MCP extraction endpoint
    req.body.documentType = 'purchase_order';
    return mcpController.extractDocument(req, res);
  }
);

router.post('/legacy/extract-pi',
  upload.single('file'),
  async (req, res) => {
    // Redirect to new MCP extraction endpoint  
    req.body.documentType = 'proforma_invoice';
    return mcpController.extractDocument(req, res);
  }
);

// === Error Handling ===

router.use((error, req, res, next) => {
  console.error('MCP Route Error:', error);
  
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
        'PDF', 'JPEG', 'PNG', 'TIFF', 'Excel', 'Text', 'CSV'
      ]
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal MCP service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// === API Documentation Helper ===

router.get('/docs', (req, res) => {
  res.json({
    service: 'HiggsFlow MCP API',
    version: '2.0.0',
    description: 'Model Context Protocol enhanced API for advanced AI capabilities',
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
        'POST /api/mcp/legacy/extract-po - Legacy PO extraction',
        'POST /api/mcp/legacy/extract-pi - Legacy PI extraction'
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
      'Streaming process support'
    ],
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
