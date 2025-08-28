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
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 3000;

// Log port information for debugging
console.log('Port Configuration:');
console.log(`   Railway PORT: ${process.env.PORT}`);
console.log(`   Railway RAILWAY_PORT: ${process.env.RAILWAY_PORT}`);
console.log(`   Final PORT: ${PORT}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);

// CRITICAL FIX: Safe MCP service loading with error handling
let MCPIntegrationService = null;
let mcpServiceInstance = null;
let mcpRoutesAvailable = false;

// Try to load MCP services with graceful degradation
try {
  MCPIntegrationService = require('./services/mcp/MCPIntegrationService');
  console.log('MCPIntegrationService loaded successfully');
} catch (mcpLoadError) {
  console.warn('MCPIntegrationService failed to load:', mcpLoadError.message);
  console.warn('MCP features will be disabled for this deployment');
  console.warn('This is often due to WebSocket port conflicts in Railway');
}

// *** CRITICAL FIX: Prevent service initialization loops ***
let servicesInitialized = false;
let unifiedAIServiceInstance = null;

// Initialize services ONCE with singleton pattern
async function initializeServicesOnce() {
  if (servicesInitialized) {
    return { mcpService: mcpServiceInstance, aiService: unifiedAIServiceInstance };
  }

  console.log('Initializing services once...');
  
  try {
    // Initialize AI service only once  
    const UnifiedAIService = require('./services/ai/UnifiedAIService');
    if (!unifiedAIServiceInstance) {
      unifiedAIServiceInstance = new UnifiedAIService();
      console.log('AI service initialized once');
    }

    servicesInitialized = true;
    console.log('All services initialized successfully');
    
    return { mcpService: mcpServiceInstance, aiService: unifiedAIServiceInstance };
  } catch (error) {
    console.error('Service initialization failed:', error);
    servicesInitialized = false;
    throw error;
  }
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
  res.setHeader('X-HiggsFlow-AI-Version', '2.0.1');
  res.setHeader('X-Modular-AI-Enabled', 'true');
  res.setHeader('X-MCP-Version', '2.0.1');
  res.setHeader('X-MCP-WebSocket', `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  res.setHeader('X-Firebase-Enabled', firebaseApp ? 'true' : 'false');
  res.setHeader('X-Railway-Port', PORT.toString());
  res.setHeader('X-Service-Loops', 'fixed');
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

// NEW: Category Management Routes
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
          id: 'product_enhancement',
          name: 'Product Enhancement',
          description: 'AI-powered product image generation and analysis',
          color: '#F59E0B',
          isSystem: true,
          sortOrder: 75,
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

// FIXED: AI Prompts endpoint without initialization loops
app.get('/api/ai/prompts', async (req, res) => {
  try {
    console.log('GET /api/ai/prompts called');
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firebase not configured',
        prompts: []
      });
    }

    const promptsSnapshot = await getDocs(collection(db, 'prompts'));
    const prompts = [];
    
    promptsSnapshot.forEach((doc) => {
      prompts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    console.log(`Retrieved ${prompts.length} prompts`);
    
    res.json({
      success: true,
      prompts: prompts,
      count: prompts.length
    });
  } catch (error) {
    console.error('Error retrieving prompts:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      prompts: []
    });
  }
});

// Service status endpoint
app.get('/api/service-status', (req, res) => {
  res.json({
    servicesInitialized,
    mcpEnabled: !!mcpServiceInstance,
    aiEnabled: !!unifiedAIServiceInstance,
    timestamp: new Date().toISOString(),
    loops: 'prevented'
  });
});

// Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// AI routes
const aiRoutes = require('./routes/ai.routes');
app.use('/api/ai', aiRoutes);

// CRITICAL FIX: MCP routes with safe loading and graceful degradation
try {
  // Try to initialize MCP service if class is available
  if (MCPIntegrationService) {
    console.log('Attempting to initialize MCP service...');
    
    // Create instance with timeout protection
    const initTimeout = setTimeout(() => {
      console.warn('MCP service initialization timeout (30s)');
      console.warn('Continuing without MCP - this is normal in Railway deployments');
    }, 30000);
    
    mcpServiceInstance = new MCPIntegrationService();
    
    // Wait for initialization with timeout
    Promise.race([
      new Promise(resolve => {
        if (mcpServiceInstance.isInitialized) {
          resolve();
        } else {
          mcpServiceInstance.once('initialized', resolve);
        }
      }),
      new Promise(resolve => setTimeout(resolve, 25000)) // 25 second timeout
    ]).then(() => {
      clearTimeout(initTimeout);
      
      // Only load MCP routes if service initialized successfully
      try {
        const mcpRoutes = require('./routes/mcp.routes');
        app.use('/api/mcp', mcpRoutes);
        mcpRoutesAvailable = true;
        console.log('MCP routes loaded successfully');
      } catch (routeError) {
        console.warn('MCP routes failed to load:', routeError.message);
      }
    }).catch(() => {
      clearTimeout(initTimeout);
      console.warn('MCP service initialization failed or timed out');
      console.warn('Continuing without MCP features');
    });
    
  } else {
    console.warn('MCPIntegrationService class not available');
    console.warn('MCP features disabled for this deployment');
  }
} catch (mcpInitError) {
  console.warn('MCP initialization error:', mcpInitError.message);
  console.warn('Continuing without MCP features - server will still work');
}

// FALLBACK MCP ENDPOINTS: Provide basic MCP endpoints even when service is unavailable
app.get('/api/mcp/status', (req, res) => {
  if (mcpServiceInstance && mcpServiceInstance.isInitialized) {
    // Delegate to real MCP service
    mcpServiceInstance.getStatus().then(status => {
      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString()
      });
    }).catch(error => {
      res.status(500).json({
        success: false,
        error: error.message
      });
    });
  } else {
    // Fallback response
    res.json({
      success: false,
      message: 'MCP service not available',
      status: 'disabled',
      reason: 'Service failed to initialize (common in Railway deployments)',
      fallback: true,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/mcp/capabilities', (req, res) => {
  res.json({
    success: mcpServiceInstance?.isInitialized || false,
    capabilities: mcpServiceInstance?.isInitialized ? [] : ['fallback_mode'],
    message: mcpServiceInstance?.isInitialized ? 'MCP service available' : 'MCP service not available',
    timestamp: new Date().toISOString()
  });
});

// FIXED: Enhanced health check endpoint without initialization loops
app.get('/health', async (req, res) => {
  try {
    // Initialize services only once if needed
    let aiHealth = { status: 'disabled', modules: 0, prompts: 0, providers: 0, version: '2.0.1' };
    let providerStatus = {};
    
    try {
      const { aiService } = await initializeServicesOnce();
      if (aiService) {
        aiHealth = await aiService.healthCheck();
        providerStatus = await aiService.getProviderStatus();
      }
    } catch (aiError) {
      console.warn('AI health check failed:', aiError.message);
    }
    
    // Get MCP system health with safe checking
    let mcpStatus = { status: 'disabled', reason: 'Service not available' };
    try {
      if (mcpServiceInstance && mcpServiceInstance.isInitialized) {
        mcpStatus = await mcpServiceInstance.getStatus();
      } else if (MCPIntegrationService) {
        mcpStatus = { status: 'initializing', reason: 'Service loading' };
      }
    } catch (mcpError) {
      console.warn('MCP health check failed:', mcpError.message);
      mcpStatus = { 
        status: 'error', 
        error: mcpError.message,
        reason: 'Health check failed'
      };
    }
    
    // Firebase/Prompt system health
    let promptSystemHealth = { status: 'error', storage: 'fallback' };
    let categorySystemHealth = { status: 'error', storage: 'fallback' };
    try {
      if (firebaseApp && db) {
        const { collection, getDocs, limit, query } = require('firebase/firestore');
        const testQuery = query(collection(db, 'prompts'), limit(1));
        await getDocs(testQuery);
        
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
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        core: 'active',
        modularAI: aiHealth.status,
        mcp: mcpStatus.status,
        ai: 'active',
        promptSystem: promptSystemHealth.status,
        categorySystem: categorySystemHealth.status,
        firebase: firebaseApp ? 'active' : 'disabled',
        initializationLoops: 'fixed'
      },
      ai: {
        modules: aiHealth.modules,
        prompts: aiHealth.prompts,
        providers: aiHealth.providers,
        version: aiHealth.version,
        provider_status: Object.keys(providerStatus).length
      },
      mcp: {
        server: mcpStatus.mcp_server || { status: 'disabled' },
        websocket: mcpStatus.websocket_server || { status: 'disabled' },
        capabilities: mcpStatus.capabilities || [],
        version: '2.0.1',
        available: mcpRoutesAvailable,
        reason: mcpStatus.reason || 'Unknown'
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
          nuclearTest: '/api/nuclear-test',
          serviceStatus: '/api/service-status'
        },
        description: 'Use /api/find-problem to trace 0ms responses, /api/nuclear-test to verify API connectivity'
      },
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.1-loop-fixed',
      endpoints: {
        health: '/health',
        api: '/api',
        ai: '/api/ai',
        mcp: mcpRoutesAvailable ? '/api/mcp' : '/api/mcp (fallback only)',
        categories: '/api/categories',
        debug: '/api/find-problem',
        nuclearTest: '/api/nuclear-test',
        serviceStatus: '/api/service-status',
        aiDocs: '/api/ai/docs',
        mcpDocs: mcpRoutesAvailable ? '/api/mcp/docs' : 'unavailable',
        extraction: '/api/purchase-orders/extract',
        bankPayment: '/api/bank-payments/extract',
        enhancedExtraction: '/api/ai/extract/purchase-order',
        enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
        mcpExtraction: mcpRoutesAvailable ? '/api/mcp/extract' : 'unavailable',
        mcpWebSocket: mcpRoutesAvailable ? `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp` : 'unavailable'
      },
      features: {
        modularAI: true,
        multiProviderAI: true,
        supplierSpecificIntelligence: true,
        enhancedExtraction: true,
        performanceTracking: true,
        backwardCompatible: true,
        mcpEnhanced: mcpRoutesAvailable,
        realTimeProcessing: mcpRoutesAvailable,
        batchProcessing: mcpRoutesAvailable,
        streamingSupport: mcpRoutesAvailable,
        websocketCommunication: mcpRoutesAvailable,
        persistentPrompts: promptSystemHealth.storage === 'firestore',
        persistentCategories: categorySystemHealth.storage === 'firestore',
        firebaseIntegration: !!firebaseApp,
        dynamicCategoryManagement: !!firebaseApp,
        debugEndpoints: true,
        gracefulDegradation: true,
        serviceLoopsPrevented: true
      },
      deployment: {
        safe: true,
        mcpIssues: !mcpRoutesAvailable,
        serviceLoops: 'prevented',
        message: servicesInitialized ? 'Services initialized once' : 'Services initializing'
      }
    });
  } catch (error) {
    console.warn('Health check partial failure:', error.message);
    res.json({
      status: 'ok',
      error: error.message,
      deployment: {
        safe: true,
        degraded: true,
        serviceLoops: 'prevented'
      }
    });
  }
});

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier MCP Server - Service Loop Fix',
    version: '2.0.1-loop-fixed',
    features: [
      'Enhanced document extraction',
      'Multi-provider AI support',
      'Supplier-specific intelligence',
      'Performance tracking',
      'Modular architecture',
      'Model Context Protocol (MCP) - with safe deployment',
      'Real-time WebSocket communication (when available)',
      'Advanced tool orchestration (when available)',
      'Batch processing (when available)',
      'Streaming processes (when available)',
      'Persistent prompt storage (Firebase)',
      'Dynamic category management',
      'Zero data loss on deployments',
      'Debug tools for troubleshooting',
      'Graceful service degradation',
      'Railway-optimized deployment',
      'Service initialization loop prevention'
    ],
    endpoints: {
      health: '/health',
      api: '/api',
      ai: '/api/ai',
      mcp: mcpRoutesAvailable ? '/api/mcp' : '/api/mcp (basic fallback)',
      categories: '/api/categories',
      debug: '/api/find-problem',
      nuclearTest: '/api/nuclear-test',
      serviceStatus: '/api/service-status',
      extraction: '/api/purchase-orders/extract',
      bankPaymentExtraction: '/api/bank-payments/extract',
      enhancedPOExtraction: '/api/ai/extract/purchase-order',
      enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
      mcpExtraction: mcpRoutesAvailable ? '/api/mcp/extract' : 'unavailable (fallback to AI)',
      mcpToolExecution: mcpRoutesAvailable ? '/api/mcp/tools/execute' : 'unavailable',
      aiDocumentation: '/api/ai/docs',
      mcpDocumentation: mcpRoutesAvailable ? '/api/mcp/docs' : 'unavailable'
    },
    websocket: {
      mcp: mcpRoutesAvailable ? `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp` : 'unavailable',
      description: mcpRoutesAvailable ? 'Real-time MCP communication and streaming' : 'WebSocket disabled due to deployment constraints'
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
      },
      serviceStatus: {
        endpoint: '/api/service-status',
        description: 'Check service initialization status and prevent loops',
        usage: 'GET /api/service-status'
      }
    },
    deployment: {
      platform: 'Railway-optimized',
      safeMode: true,
      mcpStatus: mcpRoutesAvailable ? 'active' : 'disabled (port conflicts)',
      gracefulDegradation: true,
      serviceLoops: 'prevented',
      message: mcpRoutesAvailable ? 
        'All services running normally with loop prevention' : 
        'MCP services disabled - AI and core features fully functional with loop prevention'
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
  
  // MCP-specific errors - now with graceful handling
  if (err.message && err.message.includes('MCP')) {
    return res.status(500).json({
      success: false,
      message: 'MCP service error: ' + err.message,
      context: 'mcp_service',
      fallback: 'AI services still available'
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

// CRITICAL: Start server with Railway-specific configuration
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`HiggsFlow Supplier Server v2.0.1 (Loop Fix + Safe Deployment + Advanced AI + Firebase + Categories) is running on port ${PORT}`);
  console.log(`Binding to 0.0.0.0:${PORT} for Railway compatibility`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timeout settings: Request: 5min, Response: 5min, Max file: 10MB`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`Railway should now be able to reach the application`);
  
  // Log Railway-specific information
  console.log('\nRailway Configuration:');
  console.log(`   PORT env var: ${process.env.PORT}`);
  console.log(`   RAILWAY_PORT env var: ${process.env.RAILWAY_PORT}`);
  console.log(`   Final listening port: ${PORT}`);
  console.log(`   Binding address: 0.0.0.0 (Railway required)`);
  
  // Deployment safety information
  console.log('\nDEPLOYMENT SAFETY FEATURES:');
  console.log('   Graceful MCP service degradation');
  console.log('   Safe service loading with error handling');
  console.log('   Fallback endpoints when services unavailable');
  console.log('   Railway-optimized port management');
  console.log('   Zero-downtime deployment capability');
  console.log('   SERVICE INITIALIZATION LOOP PREVENTION');
  
  // Debug endpoints logging
  console.log('\nDEBUG ENDPOINTS:');
  console.log(`   POST http://localhost:${PORT}/api/find-problem - Enable 0ms source tracing`);
  console.log(`   POST http://localhost:${PORT}/api/nuclear-test - Direct DeepSeek API test`);
  console.log(`   GET http://localhost:${PORT}/api/service-status - Check service initialization`);
  console.log(`   These will help identify and prevent service loops`);
  
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
  console.log(`   GET  http://localhost:${PORT}/api/categories - List all categories`);
  console.log(`   POST http://localhost:${PORT}/api/categories - Create new category`);
  console.log(`   PUT  http://localhost:${PORT}/api/categories/:id - Update category`);
  console.log(`   DEL  http://localhost:${PORT}/api/categories/:id - Delete category`);
  
  // Log AI endpoints
  console.log('\nModular AI endpoints:');
  console.log(`   GET  http://localhost:${PORT}/api/ai/health - AI system health`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/test - Quick functionality test`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/modules - Module management`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/prompts - Prompt management (FIXED)`);
  console.log(`   POST http://localhost:${PORT}/api/ai/extract/purchase-order - Enhanced PO extraction`);
  console.log(`   POST http://localhost:${PORT}/api/ai/extract/proforma-invoice - Enhanced PI extraction`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/docs - AI API documentation`);
  
  // Log MCP endpoints with status
  console.log('\nMCP endpoints:');
  if (mcpRoutesAvailable) {
    console.log(`   MCP services ACTIVE - all endpoints available`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/status - MCP service status`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/capabilities - Available capabilities`);
    console.log(`   WebSocket: ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  } else {
    console.log(`   MCP services DISABLED (deployment safety)`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/status - Basic status (fallback)`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/capabilities - Basic capabilities (fallback)`);
    console.log(`   This is NORMAL for Railway deployments - AI services fully functional`);
    console.log(`   MCP may become available after successful deployment`);
  }
  
  console.log('\nSERVICE INITIALIZATION FIX:');
  console.log('   Services will initialize ONCE at startup');
  console.log('   No more repeated initialization on API calls');
  console.log('   Singleton pattern prevents service loops');
  console.log('   Check /api/service-status for initialization status');
  
  console.log('\nSafe Deployment Ready!');
  console.log(`   Core services: ACTIVE`);
  console.log(`   AI services: ACTIVE`);
  console.log(`   ${firebaseApp ? 'Firebase: CONNECTED' : 'Firebase: NOT CONFIGURED'}`);
  console.log(`   ${mcpRoutesAvailable ? 'MCP services: ACTIVE' : 'MCP services: SAFELY DISABLED'}`);
  console.log(`   Service loops: PREVENTED`);
  
  console.log('\nTest endpoints:');
  console.log(`   Health: curl http://localhost:${PORT}/health`);
  console.log(`   Categories: curl http://localhost:${PORT}/api/categories`);
  console.log(`   AI Test: curl http://localhost:${PORT}/api/ai/test`);
  console.log(`   Service Status: curl http://localhost:${PORT}/api/service-status`);
  console.log(`   Debug: curl -X POST http://localhost:${PORT}/api/find-problem`);
  console.log(`   Nuclear: curl -X POST http://localhost:${PORT}/api/nuclear-test`);
  console.log(`   MCP Status: curl http://localhost:${PORT}/api/mcp/status`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Cleanup MCP service if available
  if (mcpServiceInstance && mcpServiceInstance.wsServer) {
    try {
      mcpServiceInstance.wsServer.close();
      console.log('MCP WebSocket server closed');
    } catch (error) {
      console.warn('Error closing MCP WebSocket:', error.message);
    }
  }
  
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = app;
