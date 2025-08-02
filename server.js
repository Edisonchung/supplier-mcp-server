const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for timeout handling
app.use((req, res, next) => {
  // Set timeout to 5 minutes for all requests
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes
  next();
});

// Body parser middleware with increased limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// CORS middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Add middleware to set AI-related headers
app.use((req, res, next) => {
  res.setHeader('X-HiggsFlow-AI-Version', '2.0.0');
  res.setHeader('X-Modular-AI-Enabled', 'true');
  next();
});

// Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// NEW: Add AI routes
const aiRoutes = require('./routes/ai.routes');
app.use('/api/ai', aiRoutes);

// Enhanced health check endpoint with AI system status
app.get('/health', async (req, res) => {
  try {
    // Get AI system health
    const UnifiedAIService = require('./services/ai/UnifiedAIService');
    const aiService = new UnifiedAIService();
    const aiHealth = await aiService.healthCheck();
    const providerStatus = await aiService.getProviderStatus();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        core: 'active',
        modularAI: aiHealth.status, // New modular AI status
        ai: 'active'
      },
      ai: {
        modules: aiHealth.modules,
        prompts: aiHealth.prompts,
        providers: aiHealth.providers,
        version: aiHealth.version,
        provider_status: Object.keys(providerStatus).length
      },
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0-modular-ai',
      endpoints: {
        health: '/health',
        api: '/api',
        ai: '/api/ai', // New AI management endpoints
        aiDocs: '/api/ai/docs', // AI API documentation
        extraction: '/api/purchase-orders/extract',
        bankPayment: '/api/bank-payments/extract',
        enhancedExtraction: '/api/ai/extract/purchase-order', // Enhanced extraction
        enhancedPIExtraction: '/api/ai/extract/proforma-invoice' // Enhanced PI extraction
      },
      features: {
        modularAI: true, // New feature flag
        multiProviderAI: true,
        supplierSpecificIntelligence: true,
        enhancedExtraction: true,
        performanceTracking: true,
        backwardCompatible: true
      }
    });
  } catch (error) {
    console.warn('AI system not fully initialized:', error.message);
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        core: 'active',
        modularAI: 'initializing',
        ai: 'active'
      },
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0-modular-ai',
      ai_status: 'initializing',
      error: error.message
    });
  }
});

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier MCP Server with Modular AI',
    version: '2.0.0-modular-ai',
    features: [
      'Enhanced document extraction',
      'Multi-provider AI support',
      'Supplier-specific intelligence',
      'Performance tracking',
      'Modular architecture'
    ],
    endpoints: {
      health: '/health',
      api: '/api',
      ai: '/api/ai',
      extraction: '/api/purchase-orders/extract',
      bankPaymentExtraction: '/api/bank-payments/extract',
      enhancedPOExtraction: '/api/ai/extract/purchase-order',
      enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
      aiDocumentation: '/api/ai/docs'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum size is 10MB'
    });
  }
  
  // Multer file type error
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  // AI-specific errors
  if (err.message && err.message.includes('AI')) {
    return res.status(500).json({
      success: false,
      message: 'AI service error: ' + err.message,
      context: 'ai_service'
    });
  }
  
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Start server with enhanced logging
const server = app.listen(PORT, () => {
  console.log(`🚀 HiggsFlow Supplier MCP Server v2.0.0 is running on port ${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏱️  Timeout settings: Request: 5min, Response: 5min, Max file: 10MB`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🏦 Bank payment extraction: http://localhost:${PORT}/api/bank-payments/extract`);
  
  // Log new AI endpoints
  console.log('\n🤖 Modular AI endpoints registered:');
  console.log(`   🏥 GET  http://localhost:${PORT}/api/ai/health - AI system health`);
  console.log(`   🧪 GET  http://localhost:${PORT}/api/ai/test - Quick functionality test`);
  console.log(`   📦 GET  http://localhost:${PORT}/api/ai/modules - Module management`);
  console.log(`   📝 GET  http://localhost:${PORT}/api/ai/prompts - Prompt management`);
  console.log(`   📄 POST http://localhost:${PORT}/api/ai/extract/purchase-order - Enhanced PO extraction`);
  console.log(`   📋 POST http://localhost:${PORT}/api/ai/extract/proforma-invoice - Enhanced PI extraction`);
  console.log(`   📚 GET  http://localhost:${PORT}/api/ai/docs - API documentation`);
  console.log(`   🔄 POST http://localhost:${PORT}/api/ai/extract-po - Legacy compatibility`);
  console.log(`   🔄 POST http://localhost:${PORT}/api/ai/extract-pi - Legacy compatibility`);
  
  // Environment variables check
  const requiredEnvVars = ['DEEPSEEK_API_KEY'];
  const optionalEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
  const missingRequired = requiredEnvVars.filter(envVar => !process.env[envVar]);
  const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);

  if (missingRequired.length > 0) {
    console.log('\n⚠️  Missing REQUIRED environment variables:');
    missingRequired.forEach(envVar => {
      console.log(`   - ${envVar} (Required for AI functionality)`);
    });
  } else {
    console.log('\n✅ All required AI environment variables configured');
  }
  
  if (missingOptional.length > 0) {
    console.log('\n💡 Optional AI providers not configured:');
    missingOptional.forEach(envVar => {
      console.log(`   - ${envVar} (For enhanced AI capabilities)`);
    });
  } else {
    console.log('✅ All AI providers configured for maximum capabilities');
  }
  
  console.log('\n🎯 Features enabled:');
  console.log('   ✅ Modular AI architecture');
  console.log('   ✅ Multi-provider AI support');
  console.log('   ✅ Supplier-specific intelligence (PTP optimization)');
  console.log('   ✅ Enhanced document extraction');
  console.log('   ✅ Performance tracking and analytics');
  console.log('   ✅ Backward compatibility with existing APIs');
  
  console.log('\n🚀 Ready for Phase 1 testing!');
  console.log(`   Run: node scripts/ai/test-modular-ai.js`);
  console.log(`   Or visit: http://localhost:${PORT}/api/ai/docs`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = app;
