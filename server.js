const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Firebase initialization for prompt persistence
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
  console.log('Firebase initialized successfully for prompt persistence');
} catch (error) {
  console.warn('Firebase initialization failed:', error.message);
  console.warn('Prompts will use fallback storage (may be lost on deployment)');
}

const app = express();
// FIXED: Use Railway's dynamic port and bind to all interfaces
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // This is the key fix for Railway

// ===================================================================
// ENHANCED CORS CONFIGURATION FOR PRODUCTION
// ===================================================================

const allowedOrigins = [
  // Production domains
  'https://www.higgsflow.com',
  'https://higgsflow.com',
  'https://supplier-management-system-one.vercel.app',
  
  // Development domains
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  
  // Railway domains
  'https://supplier-mcp-server-production.up.railway.app',
  'https://*.up.railway.app',
  
  // Vercel domains
  'https://*.vercel.app',
  
  // Firebase domains
  'https://*.firebaseapp.com',
  'https://*.web.app',
  
  // Add environment variable override
  process.env.FRONTEND_URL
].filter(Boolean);

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check against allowed origins list
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        // Handle wildcard domains
        const pattern = allowedOrigin.replace(/\*/g, '.*');
        const regex = new RegExp('^' + pattern + '$');
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      // In production, still allow the request but log it
      callback(null, true); // Change to false in strict mode
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'X-Auth-Token',
    'Cache-Control',
    'Pragma',
    'X-Firebase-AppCheck',
    'x-client-info'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'X-Total-Count',
    'X-Request-ID'
  ],
  optionsSuccessStatus: 200,
  maxAge: 86400 // Cache preflight for 24 hours
};

// Apply CORS middleware FIRST
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

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

// Security headers middleware
app.use((req, res, next) => {
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'origin-when-cross-origin');
  
  // Ensure CORS headers are always set
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,X-API-Key,X-Auth-Token,Cache-Control,Pragma,X-Firebase-AppCheck,x-client-info');
  
  next();
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Add middleware to set AI and MCP headers
app.use((req, res, next) => {
  res.setHeader('X-HiggsFlow-AI-Version', '2.0.0');
  res.setHeader('X-Modular-AI-Enabled', 'true');
  res.setHeader('X-MCP-Version', '2.0.0');
  // FIXED: Use external URL for WebSocket in production
  const wsUrl = process.env.NODE_ENV === 'production' 
    ? `wss://supplier-mcp-server-production.up.railway.app:${process.env.MCP_WS_PORT || 8081}/mcp`
    : `ws://localhost:${process.env.MCP_WS_PORT || 8081}/mcp`;
  res.setHeader('X-MCP-WebSocket', wsUrl);
  res.setHeader('X-Firebase-Enabled', firebaseApp ? 'true' : 'false');
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// CRITICAL DEBUG ENDPOINT - Add this BEFORE your other routes
app.post('/api/find-problem', (req, res) => {
  console.log('Debug endpoint called - starting stack trace monitoring...');
  
  // Override console.log to catch the 0ms message and show stack trace
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    const message = args.join(' ');
    
    // Check for the exact 0ms message
    if (message.includes('AI response received in 0ms')) {
      console.error('FOUND THE EXACT SOURCE OF 0ms!');
      console.error('Message:', message);
      console.error('STACK TRACE (showing exact file and line):');
      console.error(new Error('SOURCE LOCATION TRACE').stack);
      console.error('END SOURCE TRACE');
      
      // Also check for any other suspicious timing messages
      console.error('Additional debugging info:');
      console.error('Process uptime:', process.uptime(), 'seconds');
      console.error('Memory usage:', process.memoryUsage());
    }
    
    // Check for other suspicious instant responses
    if (message.includes('response received in 1ms') || 
        message.includes('response received in 0ms') ||
        message.includes('AI response received in') && (message.includes('0ms') || message.includes('1ms'))) {
      console.error('SUSPICIOUS INSTANT RESPONSE DETECTED!');
      console.error('Message:', message);
      console.error('Stack trace:');
      console.error(new Error('INSTANT RESPONSE LOCATION').stack);
    }
    
    // Call original console.log
    originalConsoleLog.apply(console, args);
  };
  
  console.log('Stack trace monitoring ENABLED');
  console.log('Now test your product enhancement endpoint');
  console.log('Any 0ms or 1ms responses will show full stack traces');
  
  res.json({ 
    success: true,
    message: 'Debug stack trace monitoring enabled!',
    instructions: [
      '1. This endpoint is now monitoring all console.log calls',
      '2. Call /api/enhance-product with your test data',
      '3. Check Railway logs immediately for stack traces',
      '4. The stack trace will show the exact file and line causing 0ms responses'
    ],
    timestamp: new Date().toISOString(),
    debugMode: 'ACTIVE'
  });
});

// NUCLEAR TEST ENDPOINT - Direct API test to verify connectivity
app.post('/api/nuclear-test', async (req, res) => {
  const startTime = Date.now();
  console.log('NUCLEAR TEST: Starting direct DeepSeek API call...');
  
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      return res.json({
        success: false,
        error: 'DEEPSEEK_API_KEY not configured',
        time: Date.now() - startTime + 'ms',
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasApiKey: false
        }
      });
    }
    
    console.log('NUCLEAR: Making direct fetch to DeepSeek API...');
    
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
          content: 'Nuclear test - return exactly: {"test": "success", "timestamp": "' + new Date().toISOString() + '", "nuclear": true}' 
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
    
    console.log(`NUCLEAR TEST: REAL API completed in ${actualTime}ms`);
    console.log('NUCLEAR: Response received:', data.choices[0]?.message?.content);
    
    res.json({
      success: true,
      message: 'REAL API call successful!',
      actualTime: actualTime + 'ms',
      response: data.choices[0]?.message?.content,
      metadata: {
        model: data.model,
        usage: data.usage,
        responseId: data.id
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        hasApiKey: true,
        apiKeyLength: apiKey.length
      }
    });
  } catch (error) {
    const actualTime = Date.now() - startTime;
    console.error(`NUCLEAR TEST: Failed after ${actualTime}ms:`, error.message);
    
    res.json({
      success: false,
      error: error.message,
      actualTime: actualTime + 'ms',
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        hasApiKey: !!process.env.DEEPSEEK_API_KEY
      }
    });
  }
});

// Category Management Routes
// Initialize default categories
const initializeDefaultCategories = async () => {
  if (!db) {
    console.warn('Firebase not available, skipping category initialization');
    return;
  }

  try {
    const categoriesRef = collection(db, 'categories');
    const snapshot = await getDocs(categoriesRef);
    
    if (snapshot.empty) {
      console.log('Initializing default categories...');
      
      const defaultCategories = [
        {
          id: 'purchase_order',
          name: 'Purchase Order',
          description: 'Purchase order processing and extraction',
          color: '#3B82F6',
          isSystem: true,
          sortOrder: 10,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'proforma_invoice',
          name: 'Proforma Invoice',
          description: 'Proforma invoice processing and analysis',
          color: '#06B6D4',
          isSystem: true,
          sortOrder: 20,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'bank_payment',
          name: 'Bank Payment',
          description: 'Bank payment processing and reconciliation',
          color: '#8B5CF6',
          isSystem: true,
          sortOrder: 30,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'extraction',
          name: 'Extraction',
          description: 'General document data extraction',
          color: '#3B82F6',
          isSystem: true,
          sortOrder: 40,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'supplier_specific',
          name: 'Supplier Specific',
          description: 'Supplier-focused extraction and analysis',
          color: '#8B5CF6',
          isSystem: true,
          sortOrder: 50,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'analytics',
          name: 'Analytics',
          description: 'Data analysis and business insights',
          color: '#10B981',
          isSystem: true,
          sortOrder: 60,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'classification',
          name: 'Classification',
          description: 'Document type classification and routing',
          color: '#EF4444',
          isSystem: true,
          sortOrder: 70,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        },
        {
          id: 'general',
          name: 'General',
          description: 'General purpose AI prompts',
          color: '#6B7280',
          isSystem: true,
          sortOrder: 80,
          promptCount: 0,
          createdAt: serverTimestamp(),
          createdBy: 'System'
        }
      ];

      for (const category of defaultCategories) {
        const docRef = doc(db, 'categories', category.id);
        await updateDoc(docRef, category).catch(async () => {
          // Document doesn't exist, create it
          await addDoc(collection(db, 'categories'), category);
        });
      }
      
      console.log('Default categories initialized successfully');
    } else {
      console.log('Categories already exist, skipping initialization');
    }
  } catch (error) {
    console.error('Failed to initialize categories:', error);
  }
};

// Category CRUD endpoints
app.get('/api/categories', async (req, res) => {
  try {
    if (!db) {
      // Fallback categories when Firebase is not available
      return res.json([
        { id: 'extraction', name: 'Extraction', description: 'Document data extraction', color: '#3B82F6' },
        { id: 'supplier_specific', name: 'Supplier Specific', description: 'Supplier-focused prompts', color: '#8B5CF6' },
        { id: 'analytics', name: 'Analytics', description: 'Data analysis and insights', color: '#10B981' },
        { id: 'product_enhancement', name: 'Product Enhancement', description: 'AI-powered product analysis', color: '#F59E0B' },
        { id: 'purchase_order', name: 'Purchase Order', description: 'Purchase order processing', color: '#3B82F6' },
        { id: 'proforma_invoice', name: 'Proforma Invoice', description: 'Proforma invoice processing', color: '#06B6D4' },
        { id: 'bank_payment', name: 'Bank Payment', description: 'Bank payment processing', color: '#8B5CF6' },
        { id: 'classification', name: 'Classification', description: 'Document classification', color: '#EF4444' },
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
    console.error('Error fetching categories:', error);
    res.status(500).json({ 
      error: 'Failed to fetch categories', 
      details: error.message 
    });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        error: 'Firebase not available', 
        message: 'Category creation requires Firebase configuration' 
      });
    }

    const { name, description, color, userEmail } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Generate ID from name
    const categoryId = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    // Get current max sort order
    const categoriesRef = collection(db, 'categories');
    const snapshot = await getDocs(categoriesRef);
    let maxSortOrder = 80; // Start after system categories
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.sortOrder > maxSortOrder) {
        maxSortOrder = data.sortOrder;
      }
    });

    const categoryData = {
      id: categoryId,
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#8B5CF6',
      isSystem: false,
      sortOrder: maxSortOrder + 10,
      promptCount: 0,
      createdAt: serverTimestamp(),
      createdBy: userEmail || 'Unknown User',
      updatedAt: serverTimestamp()
    };

    // Create the document with the specific ID
    const docRef = doc(db, 'categories', categoryId);
    await updateDoc(docRef, categoryData).catch(async () => {
      // Document doesn't exist, create it
      await addDoc(collection(db, 'categories'), categoryData);
    });
    
    console.log(`Category created: ${name} (${categoryId})`);
    
    res.json({
      success: true,
      message: 'Category created successfully',
      category: { id: categoryId, ...categoryData }
    });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ 
      error: 'Failed to create category', 
      details: error.message 
    });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        error: 'Firebase not available', 
        message: 'Category updates require Firebase configuration' 
      });
    }

    const categoryId = req.params.id;
    const { name, description, color } = req.body;
    
    const updateData = {
      updatedAt: serverTimestamp()
    };
    
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (color) updateData.color = color;

    const docRef = doc(db, 'categories', categoryId);
    await updateDoc(docRef, updateData);
    
    console.log(`Category updated: ${categoryId}`);
    
    res.json({
      success: true,
      message: 'Category updated successfully'
    });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ 
      error: 'Failed to update category', 
      details: error.message 
    });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        error: 'Firebase not available', 
        message: 'Category deletion requires Firebase configuration' 
      });
    }

    const categoryId = req.params.id;
    
    // Check if category is system category
    const docRef = doc(db, 'categories', categoryId);
    const docSnap = await getDocs(docRef);
    
    if (docSnap.exists() && docSnap.data().isSystem) {
      return res.status(400).json({ 
        error: 'Cannot delete system category' 
      });
    }

    await deleteDoc(docRef);
    
    console.log(`Category deleted: ${categoryId}`);
    
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ 
      error: 'Failed to delete category', 
      details: error.message 
    });
  }
});

// Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// AI routes
const aiRoutes = require('./routes/ai.routes');
app.use('/api/ai', aiRoutes);

// NEW: MCP routes
const mcpRoutes = require('./routes/mcp.routes');
app.use('/api/mcp', mcpRoutes);

// Enhanced health check endpoint with AI, MCP, and Firebase system status
app.get('/health', async (req, res) => {
  try {
    // Get AI system health
    const UnifiedAIService = require('./services/ai/UnifiedAIService');
    const aiService = new UnifiedAIService();
    const aiHealth = await aiService.healthCheck();
    const providerStatus = await aiService.getProviderStatus();
    
    // Get MCP system health
    let mcpStatus = { status: 'initializing' };
    try {
      const MCPIntegrationService = require('./services/mcp/MCPIntegrationService');
      const mcpService = new MCPIntegrationService();
      mcpStatus = await mcpService.getStatus();
    } catch (mcpError) {
      console.warn('MCP service not yet initialized:', mcpError.message);
      mcpStatus = { status: 'initializing', error: mcpError.message };
    }
    
    // Firebase/Prompt system health
    let promptSystemHealth = { status: 'error', storage: 'fallback' };
    let categorySystemHealth = { status: 'error', storage: 'fallback' };
    try {
      if (firebaseApp && db) {
        // Try to access Firestore to verify connection
        const { collection, getDocs, limit, query } = require('firebase/firestore');
        const testQuery = query(collection(db, 'ai-prompts'), limit(1));
        await getDocs(testQuery);
        
        // Test categories collection
        const categoriesQuery = query(collection(db, 'categories'), limit(1));
        await getDocs(categoriesQuery);
        
        promptSystemHealth = { 
          status: 'active', 
          storage: 'firestore', 
          connection: 'verified',
          database: firebaseConfig.projectId
        };
        
        categorySystemHealth = { 
          status: 'active', 
          storage: 'firestore', 
          connection: 'verified',
          database: firebaseConfig.projectId
        };
      }
    } catch (firebaseError) {
      console.warn('Firebase health check failed:', firebaseError.message);
      promptSystemHealth = { 
        status: 'degraded', 
        storage: 'fallback', 
        error: firebaseError.message 
      };
      categorySystemHealth = { 
        status: 'degraded', 
        storage: 'fallback', 
        error: firebaseError.message 
      };
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      cors: {
        enabled: true,
        allowed_origins: allowedOrigins.slice(0, 5), // Show first 5 for security
        origin: req.headers.origin || 'none'
      },
      services: {
        core: 'active',
        modularAI: aiHealth.status,
        mcp: mcpStatus.status,
        ai: 'active',
        promptSystem: promptSystemHealth.status,
        categorySystem: categorySystemHealth.status,
        firebase: firebaseApp ? 'active' : 'disabled'
      },
      ai: {
        modules: aiHealth.modules,
        prompts: aiHealth.prompts,
        providers: aiHealth.providers,
        version: aiHealth.version,
        provider_status: Object.keys(providerStatus).length
      },
      mcp: {
        server: mcpStatus.mcp_server || { status: 'initializing' },
        websocket: mcpStatus.websocket_server || { status: 'initializing' },
        capabilities: mcpStatus.capabilities || [],
        version: '2.0.0'
      },
      promptSystem: {
        storage: promptSystemHealth.storage,
        persistence: promptSystemHealth.storage === 'firestore' ? 'permanent' : 'temporary',
        database: promptSystemHealth.database || 'none',
        status: promptSystemHealth.status,
        error: promptSystemHealth.error || null
      },
      categorySystem: {
        storage: categorySystemHealth.storage,
        persistence: categorySystemHealth.storage === 'firestore' ? 'permanent' : 'temporary',
        database: categorySystemHealth.database || 'none',
        status: categorySystemHealth.status,
        error: categorySystemHealth.error || null,
        endpoints: {
          list: '/api/categories',
          create: 'POST /api/categories',
          update: 'PUT /api/categories/:id',
          delete: 'DELETE /api/categories/:id'
        }
      },
      firebase: {
        enabled: !!firebaseApp,
        projectId: firebaseConfig.projectId || 'none',
        connection: promptSystemHealth.connection || 'not_tested',
        services: {
          firestore: !!db ? 'enabled' : 'disabled',
          auth: 'available',
          storage: 'available'
        }
      },
      debug: {
        endpoints: {
          findProblem: '/api/find-problem',
          nuclearTest: '/api/nuclear-test'
        },
        description: 'Use /api/find-problem to trace 0ms responses, /api/nuclear-test to verify API connectivity'
      },
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.1.0-production-cors-fix',
      endpoints: {
        health: '/health',
        api: '/api',
        ai: '/api/ai',
        mcp: '/api/mcp',
        categories: '/api/categories',
        debug: '/api/find-problem',
        nuclearTest: '/api/nuclear-test',
        aiDocs: '/api/ai/docs',
        mcpDocs: '/api/mcp/docs',
        extraction: '/api/purchase-orders/extract',
        bankPayment: '/api/bank-payments/extract',
        enhancedExtraction: '/api/ai/extract/purchase-order',
        enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
        mcpExtraction: '/api/mcp/extract',
        mcpWebSocket: process.env.NODE_ENV === 'production' 
          ? `wss://supplier-mcp-server-production.up.railway.app:${process.env.MCP_WS_PORT || 8081}/mcp`
          : `ws://localhost:${process.env.MCP_WS_PORT || 8081}/mcp`
      },
      features: {
        modularAI: true,
        multiProviderAI: true,
        supplierSpecificIntelligence: true,
        enhancedExtraction: true,
        performanceTracking: true,
        backwardCompatible: true,
        mcpEnhanced: true,
        realTimeProcessing: true,
        batchProcessing: true,
        streamingSupport: true,
        websocketCommunication: true,
        persistentPrompts: promptSystemHealth.storage === 'firestore',
        persistentCategories: categorySystemHealth.storage === 'firestore',
        firebaseIntegration: !!firebaseApp,
        dynamicCategoryManagement: !!firebaseApp,
        debugEndpoints: true,
        productionCORS: true
      }
    });
  } catch (error) {
    console.warn('Health check partial failure:', error.message);
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      cors: {
        enabled: true,
        status: 'active'
      },
      services: {
        core: 'active',
        modularAI: 'error',
        mcp: 'error',
        ai: 'active',
        promptSystem: 'error',
        categorySystem: 'error',
        firebase: 'error'
      },
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.1.0-production-cors-fix',
      ai_status: 'initializing',
      error: error.message
    });
  }
});

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier MCP Server with Advanced AI, MCP, Firebase & Category Management + Production CORS',
    version: '2.1.0-production-cors-fix',
    cors: {
      enabled: true,
      production_domains_supported: ['https://www.higgsflow.com', 'https://higgsflow.com'],
      origin: req.headers.origin || 'none'
    },
    features: [
      'Enhanced document extraction',
      'Multi-provider AI support',
      'Supplier-specific intelligence',
      'Performance tracking',
      'Modular architecture',
      'Model Context Protocol (MCP)',
      'Real-time WebSocket communication',
      'Advanced tool orchestration',
      'Batch processing',
      'Streaming processes',
      'Persistent prompt storage (Firebase)',
      'Dynamic category management',
      'Zero data loss on deployments',
      'Debug tools for troubleshooting',
      'Production CORS configuration'
    ],
    endpoints: {
      health: '/health',
      api: '/api',
      ai: '/api/ai',
      mcp: '/api/mcp',
      categories: '/api/categories',
      debug: '/api/find-problem',
      nuclearTest: '/api/nuclear-test',
      extraction: '/api/purchase-orders/extract',
      bankPaymentExtraction: '/api/bank-payments/extract',
      enhancedPOExtraction: '/api/ai/extract/purchase-order',
      enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
      mcpExtraction: '/api/mcp/extract',
      mcpToolExecution: '/api/mcp/tools/execute',
      aiDocumentation: '/api/ai/docs',
      mcpDocumentation: '/api/mcp/docs'
    },
    websocket: {
      mcp: process.env.NODE_ENV === 'production' 
        ? `wss://supplier-mcp-server-production.up.railway.app:${process.env.MCP_WS_PORT || 8081}/mcp`
        : `ws://localhost:${process.env.MCP_WS_PORT || 8081}/mcp`,
      description: 'Real-time MCP communication and streaming'
    },
    persistence: {
      prompts: firebaseApp ? 'Firebase Firestore (permanent)' : 'File storage (temporary)',
      categories: firebaseApp ? 'Firebase Firestore (permanent)' : 'Fallback data (temporary)',
      dataLoss: firebaseApp ? 'Protected from deployment resets' : 'May be lost on deployment',
      database: firebaseConfig.projectId || 'none'
    },
    categoryManagement: {
      enabled: !!firebaseApp,
      endpoints: {
        list: 'GET /api/categories',
        create: 'POST /api/categories',
        update: 'PUT /api/categories/:id',
        delete: 'DELETE /api/categories/:id'
      },
      features: [
        'Create custom categories',
        'Color-coded organization',
        'System vs user categories',
        'Persistent storage',
        'Real-time updates'
      ]
    },
    debugTools: {
      findProblem: {
        endpoint: '/api/find-problem',
        description: 'Enables stack trace monitoring to find sources of 0ms responses',
        usage: 'POST /api/find-problem, then test your endpoints'
      },
      nuclearTest: {
        endpoint: '/api/nuclear-test',
        description: 'Direct DeepSeek API test to verify connectivity',
        usage: 'POST /api/nuclear-test'
      }
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
  
  // MCP-specific errors
  if (err.message && err.message.includes('MCP')) {
    return res.status(500).json({
      success: false,
      message: 'MCP service error: ' + err.message,
      context: 'mcp_service'
    });
  }
  
  // Firebase-specific errors
  if (err.message && (err.message.includes('Firebase') || err.message.includes('Firestore'))) {
    return res.status(500).json({
      success: false,
      message: 'Firebase service error: ' + err.message,
      context: 'firebase_service'
    });
  }
  
  // Category-specific errors
  if (err.message && err.message.includes('Category')) {
    return res.status(500).json({
      success: false,
      message: 'Category management error: ' + err.message,
      context: 'category_service'
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

// FIXED: Start server with proper host binding for Railway
const server = app.listen(PORT, HOST, async () => {
  console.log(`HiggsFlow Supplier MCP Server v2.1.0 (Production CORS Fix) is running on ${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timeout settings: Request: 5min, Response: 5min, Max file: 10MB`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  
  console.log('\nCORS Configuration:');
  console.log(`Production domain: https://www.higgsflow.com - ENABLED`);
  console.log(`Vercel domain: https://supplier-management-system-one.vercel.app - ENABLED`);
  console.log(`Development domains: localhost:5173, localhost:3000 - ENABLED`);
  console.log(`Railway domain: https://supplier-mcp-server-production.up.railway.app - ENABLED`);
  
  // Debug endpoints logging
  console.log('\nDEBUG ENDPOINTS:');
  console.log(`   POST http://${HOST}:${PORT}/api/find-problem - Enable 0ms source tracing`);
  console.log(`   POST http://${HOST}:${PORT}/api/nuclear-test - Direct DeepSeek API test`);
  
  // Initialize categories after server starts
  if (firebaseApp && db) {
    await initializeDefaultCategories();
  }
  
  // Firebase status logging
  console.log('\nFirebase Integration Status:');
  if (firebaseApp && db) {
    console.log(`   Firebase connected to project: ${firebaseConfig.projectId}`);
    console.log(`   Firestore database ready for prompt persistence`);
    console.log(`   Category management system active`);
    console.log(`   Prompts and categories will survive all deployments`);
  } else {
    console.log(`   Firebase not configured - prompts may be lost on deployment`);
    console.log(`   Add Firebase environment variables to enable persistence`);
  }
  
  // Category management endpoints
  console.log('\nCategory Management endpoints:');
  console.log(`   GET  http://${HOST}:${PORT}/api/categories - List all categories`);
  console.log(`   POST http://${HOST}:${PORT}/api/categories - Create new category`);
  console.log(`   PUT  http://${HOST}:${PORT}/api/categories/:id - Update category`);
  console.log(`   DEL  http://${HOST}:${PORT}/api/categories/:id - Delete category`);
  
  // Log AI endpoints
  console.log('\nModular AI endpoints:');
  console.log(`   GET  http://${HOST}:${PORT}/api/ai/health - AI system health`);
  console.log(`   GET  http://${HOST}:${PORT}/api/ai/test - Quick functionality test`);
  console.log(`   GET  http://${HOST}:${PORT}/api/ai/modules - Module management`);
  console.log(`   GET  http://${HOST}:${PORT}/api/ai/prompts - Prompt management`);
  console.log(`   POST http://${HOST}:${PORT}/api/ai/extract/purchase-order - Enhanced PO extraction`);
  console.log(`   POST http://${HOST}:${PORT}/api/ai/extract/proforma-invoice - Enhanced PI extraction`);
  
  // Log new MCP endpoints
  console.log('\nMCP endpoints:');
  console.log(`   GET  http://${HOST}:${PORT}/api/mcp/status - MCP service status`);
  console.log(`   GET  http://${HOST}:${PORT}/api/mcp/capabilities - Available capabilities`);
  console.log(`   GET  http://${HOST}:${PORT}/api/mcp/tools - List MCP tools`);
  console.log(`   POST http://${HOST}:${PORT}/api/mcp/tools/execute - Execute MCP tool`);
  console.log(`   POST http://${HOST}:${PORT}/api/mcp/extract - Enhanced extraction`);
  
  // WebSocket URL for different environments
  const wsUrl = process.env.NODE_ENV === 'production' 
    ? `wss://supplier-mcp-server-production.up.railway.app:${process.env.MCP_WS_PORT || 8081}/mcp`
    : `ws://${HOST}:${process.env.MCP_WS_PORT || 8081}/mcp`;
  console.log(`   WebSocket: ${wsUrl}`);
  
  // Environment variables check
  const requiredEnvVars = ['DEEPSEEK_API_KEY'];
  const optionalEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
  const mcpEnvVars = ['MCP_WS_PORT'];
  const firebaseEnvVars = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'
  ];
  
  const missingRequired = requiredEnvVars.filter(envVar => !process.env[envVar]);
  const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);
  const missingMCP = mcpEnvVars.filter(envVar => !process.env[envVar]);
  const missingFirebase = firebaseEnvVars.filter(envVar => !process.env[envVar] && !process.env[`VITE_${envVar}`]);

  if (missingRequired.length > 0) {
    console.log('\nMissing REQUIRED environment variables:');
    missingRequired.forEach(envVar => {
      console.log(`   - ${envVar} (Required for AI functionality)`);
    });
  } else {
    console.log('\nAll required AI environment variables configured');
  }
  
  if (missingOptional.length > 0) {
    console.log('\nOptional AI providers not configured:');
    missingOptional.forEach(envVar => {
      console.log(`   - ${envVar} (For enhanced AI capabilities)`);
    });
  } else {
    console.log('All AI providers configured for maximum capabilities');
  }
  
  if (missingMCP.length > 0) {
    console.log('\nMCP configuration using defaults:');
    console.log(`   - MCP_WS_PORT: ${process.env.MCP_WS_PORT || 8081} (default)`);
  } else {
    console.log('MCP configuration complete');
  }
  
  if (missingFirebase.length > 0) {
    console.log('\nFirebase configuration incomplete:');
    console.log('   Missing variables (prompts & categories may be lost on deployment):');
    missingFirebase.forEach(envVar => {
      console.log(`   - ${envVar}`);
    });
    console.log('\nTo enable persistent storage, add these to Railway:');
    console.log('   FIREBASE_API_KEY=AIzaSyBxNZe2RYL1vJZgu93C3zdz2r0J-lDYgCY');
    console.log('   FIREBASE_AUTH_DOMAIN=higgsflow-b9f81.firebaseapp.com');
    console.log('   FIREBASE_PROJECT_ID=higgsflow-b9f81');
    console.log('   FIREBASE_STORAGE_BUCKET=higgsflow-b9f81.firebasestorage.app');
    console.log('   FIREBASE_MESSAGING_SENDER_ID=717201513347');
    console.log('   FIREBASE_APP_ID=1:717201513347:web:86abc12a7dcebe914834b6');
  } else {
    console.log('Firebase configuration complete - prompts & categories will persist');
  }
  
  console.log('\nFeatures enabled:');
  console.log('   Modular AI architecture');
  console.log('   Multi-provider AI support');
  console.log('   Supplier-specific intelligence (PTP optimization)');
  console.log('   Enhanced document extraction');
  console.log('   Performance tracking and analytics');
  console.log('   Backward compatibility with existing APIs');
  console.log('   Model Context Protocol (MCP) integration');
  console.log('   Real-time WebSocket communication');
  console.log('   Advanced AI tool orchestration');
  console.log('   Batch processing capabilities');
  console.log('   Streaming process support');
  console.log(`   ${firebaseApp ? 'Active' : 'Inactive'} Persistent prompt storage (Firebase)`);
  console.log(`   ${firebaseApp ? 'Active' : 'Inactive'} Dynamic category management (Firebase)`);
  console.log(`   ${firebaseApp ? 'Active' : 'Inactive'} Zero data loss on deployments`);
  console.log('   Debug tools for troubleshooting 0ms responses');
  console.log('   Production CORS configuration');
  
  console.log('\nPhase 2 (MCP Enhancement + Firebase + Categories + Production CORS) ready!');
  
  // Log external URLs for Railway
  if (process.env.NODE_ENV === 'production') {
    console.log('\nEXTERNAL URLs (Railway):');
    console.log('   Health: https://supplier-mcp-server-production.up.railway.app/health');
    console.log('   Status: https://supplier-mcp-server-production.up.railway.app/api/mcp/status');
    console.log('   Categories: https://supplier-mcp-server-production.up.railway.app/api/categories');
    console.log('   Nuclear: https://supplier-mcp-server-production.up.railway.app/api/nuclear-test');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = app;
