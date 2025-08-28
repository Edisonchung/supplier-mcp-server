const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// CRITICAL FIX: Railway port handling
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 3000;

// Log port information for debugging
console.log('🔧 Port Configuration:');
console.log(`   Railway PORT: ${process.env.PORT}`);
console.log(`   Railway RAILWAY_PORT: ${process.env.RAILWAY_PORT}`);
console.log(`   Final PORT: ${PORT}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);

// 🆕 ADD: Firebase initialization for prompt persistence
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp } = require('firebase/firestore');

// Initialize Firebase for the backend
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID
};

// Global Firebase initialization
let firebaseApp = null;
let db = null;

try {
  firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  console.log('🔥 Firebase initialized successfully for prompt persistence');
} catch (error) {
  console.warn('⚠️ Firebase initialization failed:', error.message);
  console.warn('📝 Prompts will use fallback storage (may be lost on deployment)');
}

const app = express();

// 🔧 CRITICAL FIX: Safe MCP service loading with error handling
let MCPIntegrationService = null;
let mcpServiceInstance = null;
let mcpRoutesAvailable = false;

// Try to load MCP services with graceful degradation
try {
  MCPIntegrationService = require('./services/mcp/MCPIntegrationService');
  console.log('✅ MCPIntegrationService loaded successfully');
} catch (mcpLoadError) {
  console.warn('⚠️ MCPIntegrationService failed to load:', mcpLoadError.message);
  console.warn('🔧 MCP features will be disabled for this deployment');
  console.warn('📝 This is often due to WebSocket port conflicts in Railway');
}

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

// Add middleware to set AI and MCP headers
app.use((req, res, next) => {
  res.setHeader('X-HiggsFlow-AI-Version', '2.0.0');
  res.setHeader('X-Modular-AI-Enabled', 'true');
  res.setHeader('X-MCP-Version', '2.0.0');
  res.setHeader('X-MCP-WebSocket', `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  res.setHeader('X-Firebase-Enabled', firebaseApp ? 'true' : 'false');
  res.setHeader('X-MCP-Available', mcpRoutesAvailable ? 'true' : 'false');
  res.setHeader('X-Railway-Port', PORT.toString());
  next();
});

// 🔧 CRITICAL DEBUG ENDPOINT
app.post('/api/find-problem', (req, res) => {
  console.log('🔍 Debug endpoint called - starting stack trace monitoring...');
  
  // Override console.log to catch the 0ms message and show stack trace
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    const message = args.join(' ');
    
    if (message.includes('✅ AI response received in 0ms')) {
      console.error('🚨🚨🚨 FOUND THE EXACT SOURCE OF 0ms! 🚨🚨🚨');
      console.error('🚨 Message:', message);
      console.error('🚨 STACK TRACE (showing exact file and line):');
      console.error(new Error('SOURCE LOCATION TRACE').stack);
      console.error('🚨🚨🚨 END SOURCE TRACE 🚨🚨🚨');
    }
    
    originalConsoleLog.apply(console, args);
  };
  
  res.json({ 
    success: true,
    message: 'Debug stack trace monitoring enabled!',
    timestamp: new Date().toISOString(),
    debugMode: 'ACTIVE'
  });
});

// 🔧 NUCLEAR TEST ENDPOINT
app.post('/api/nuclear-test', async (req, res) => {
  const startTime = Date.now();
  console.log('🧪 NUCLEAR TEST: Starting direct DeepSeek API call...');
  
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      return res.json({
        success: false,
        error: 'DEEPSEEK_API_KEY not configured',
        time: Date.now() - startTime + 'ms'
      });
    }
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ 
          role: 'user', 
          content: 'Nuclear test - return: {"test": "success", "timestamp": "' + new Date().toISOString() + '"}' 
        }],
        max_tokens: 100,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    const actualTime = Date.now() - startTime;
    
    res.json({
      success: true,
      message: 'REAL API call successful!',
      actualTime: actualTime + 'ms',
      response: data.choices[0]?.message?.content
    });
  } catch (error) {
    const actualTime = Date.now() - startTime;
    res.json({
      success: false,
      error: error.message,
      actualTime: actualTime + 'ms'
    });
  }
});

// Categories endpoint
app.get('/api/categories', async (req, res) => {
  try {
    if (!db) {
      return res.json([
        { id: 'extraction', name: 'Extraction', description: 'Document data extraction', color: '#3B82F6' },
        { id: 'supplier_specific', name: 'Supplier Specific', description: 'Supplier-focused prompts', color: '#8B5CF6' },
        { id: 'analytics', name: 'Analytics', description: 'Data analysis and insights', color: '#10B981' },
        { id: 'purchase_order', name: 'Purchase Order', description: 'Purchase order processing', color: '#3B82F6' },
        { id: 'general', name: 'General', description: 'General purpose prompts', color: '#6B7280' }
      ]);
    }

    const categoriesRef = collection(db, 'categories');
    const q = query(categoriesRef, orderBy('sortOrder', 'asc'));
    const snapshot = await getDocs(q);
    
    const categories = [];
    snapshot.forEach((doc) => {
      categories.push({ 
        id: doc.id, 
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });
    
    res.json(categories);
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ 
      error: 'Failed to fetch categories', 
      details: error.message 
    });
  }
});

// Routes with safe loading
try {
  const apiRoutes = require('./routes/api.routes');
  app.use('/api', apiRoutes);
  console.log('✅ API Routes loaded');
} catch (routeError) {
  console.warn('⚠️ API Routes failed to load:', routeError.message);
}

try {
  const aiRoutes = require('./routes/ai.routes');
  app.use('/api/ai', aiRoutes);
  console.log('✅ AI Routes loaded');
} catch (aiRouteError) {
  console.warn('⚠️ AI Routes failed to load:', aiRouteError.message);
}

// MCP routes with safe loading - INTENTIONALLY DISABLED
console.log('🚫 MCP routes intentionally disabled for Railway deployment safety');

// Fallback MCP endpoints
app.get('/api/mcp/status', (req, res) => {
  res.json({
    success: false,
    message: 'MCP service not available',
    status: 'disabled',
    reason: 'Service disabled for Railway deployment safety',
    fallback: true,
    timestamp: new Date().toISOString()
  });
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Get AI system health
    let aiHealth = { status: 'unknown' };
    try {
      const UnifiedAIService = require('./services/ai/UnifiedAIService');
      const aiService = new UnifiedAIService();
      aiHealth = await aiService.healthCheck();
    } catch (aiError) {
      aiHealth = { status: 'error', error: aiError.message };
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
      services: {
        core: 'active',
        modularAI: aiHealth.status,
        mcp: 'intentionally_disabled',
        ai: 'active',
        firebase: firebaseApp ? 'active' : 'disabled'
      },
      railway: {
        port: PORT,
        env_port: process.env.PORT,
        railway_port: process.env.RAILWAY_PORT,
        node_env: process.env.NODE_ENV
      },
      version: '2.0.0-railway-port-fix',
      endpoints: {
        health: '/health',
        api: '/api',
        categories: '/api/categories',
        debug: '/api/find-problem',
        nuclearTest: '/api/nuclear-test'
      }
    });
  } catch (error) {
    console.warn('Health check error:', error.message);
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
      services: {
        core: 'active'
      },
      error: error.message,
      version: '2.0.0-railway-port-fix'
    });
  }
});

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier Server - Railway Port Fixed',
    version: '2.0.0-railway-port-fix',
    port: PORT,
    status: 'running',
    timestamp: new Date().toISOString(),
    railway: {
      detected_port: PORT,
      env_port: process.env.PORT,
      working: true
    },
    features: [
      'Enhanced document extraction',
      'Multi-provider AI support',
      'Railway-optimized deployment',
      'Port conflict resolution',
      'Safe MCP degradation'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
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

// CRITICAL: Start server with Railway-specific configuration
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 HiggsFlow Supplier Server (Railway Port Fix) is running on port ${PORT}`);
  console.log(`🔧 Binding to 0.0.0.0:${PORT} for Railway compatibility`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🎯 Railway should now be able to reach the application`);
  
  // Log Railway-specific information
  console.log('\n🚂 Railway Configuration:');
  console.log(`   PORT env var: ${process.env.PORT}`);
  console.log(`   RAILWAY_PORT env var: ${process.env.RAILWAY_PORT}`);
  console.log(`   Final listening port: ${PORT}`);
  console.log(`   Binding address: 0.0.0.0 (Railway required)`);
  
  // Initialize Firebase categories if available
  if (firebaseApp && db) {
    try {
      const categoriesRef = collection(db, 'categories');
      const snapshot = await getDocs(categoriesRef);
      console.log(`✅ Firebase categories loaded: ${snapshot.size} categories`);
    } catch (fbError) {
      console.warn('⚠️ Firebase category check failed:', fbError.message);
    }
  }
  
  console.log('\n✅ Server ready for Railway traffic!');
});

// CRITICAL: Enhanced error handling for Railway
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    console.error('🔧 Railway may have assigned a different port');
    console.error('📋 Check Railway environment variables');
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

// Additional Railway-specific error handling
process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;
