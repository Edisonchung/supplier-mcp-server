const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

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

// Add middleware to set AI and MCP headers
app.use((req, res, next) => {
  res.setHeader('X-HiggsFlow-AI-Version', '2.0.0');
  res.setHeader('X-Modular-AI-Enabled', 'true');
  res.setHeader('X-MCP-Version', '2.0.0');
  res.setHeader('X-MCP-WebSocket', `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  res.setHeader('X-Firebase-Enabled', firebaseApp ? 'true' : 'false');
  next();
});

// ✅ NEW: Category Management Routes
// Initialize default categories
const initializeDefaultCategories = async () => {
  if (!db) {
    console.warn('⚠️ Firebase not available, skipping category initialization');
    return;
  }

  try {
    const categoriesRef = collection(db, 'categories');
    const snapshot = await getDocs(categoriesRef);
    
    if (snapshot.empty) {
      console.log('🆕 Initializing default categories...');
      
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
      
      console.log('✅ Default categories initialized successfully');
    } else {
      console.log('✅ Categories already exist, skipping initialization');
    }
  } catch (error) {
    console.error('❌ Failed to initialize categories:', error);
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
    console.error('❌ Error fetching categories:', error);
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
    
    console.log(`✅ Category created: ${name} (${categoryId})`);
    
    res.json({
      success: true,
      message: 'Category created successfully',
      category: { id: categoryId, ...categoryData }
    });
  } catch (error) {
    console.error('❌ Error creating category:', error);
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
    
    console.log(`✅ Category updated: ${categoryId}`);
    
    res.json({
      success: true,
      message: 'Category updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating category:', error);
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
    
    console.log(`✅ Category deleted: ${categoryId}`);
    
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting category:', error);
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
    
    // 🆕 ADD: Firebase/Prompt system health
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
      services: {
        core: 'active',
        modularAI: aiHealth.status,
        mcp: mcpStatus.status,
        ai: 'active',
        promptSystem: promptSystemHealth.status,
        categorySystem: categorySystemHealth.status, // ✅ NEW: Category system status
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
      // 🆕 ADD: Prompt system details
      promptSystem: {
        storage: promptSystemHealth.storage,
        persistence: promptSystemHealth.storage === 'firestore' ? 'permanent' : 'temporary',
        database: promptSystemHealth.database || 'none',
        status: promptSystemHealth.status,
        error: promptSystemHealth.error || null
      },
      // ✅ NEW: Category system details
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
      // 🆕 ADD: Firebase details
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
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        maxFileSize: '10MB'
      },
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0-mcp-enhanced-firebase-categories', // ✅ NEW: Updated version
      endpoints: {
        health: '/health',
        api: '/api',
        ai: '/api/ai',
        mcp: '/api/mcp',
        categories: '/api/categories', // ✅ NEW: Category endpoints
        aiDocs: '/api/ai/docs',
        mcpDocs: '/api/mcp/docs',
        extraction: '/api/purchase-orders/extract',
        bankPayment: '/api/bank-payments/extract',
        enhancedExtraction: '/api/ai/extract/purchase-order',
        enhancedPIExtraction: '/api/ai/extract/proforma-invoice',
        mcpExtraction: '/api/mcp/extract',
        mcpWebSocket: `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`
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
        persistentCategories: categorySystemHealth.storage === 'firestore', // ✅ NEW: Category persistence
        firebaseIntegration: !!firebaseApp,
        dynamicCategoryManagement: !!firebaseApp // ✅ NEW: Dynamic categories feature
      }
    });
  } catch (error) {
    console.warn('Health check partial failure:', error.message);
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
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
      version: '2.0.0-mcp-enhanced-firebase-categories',
      ai_status: 'initializing',
      error: error.message
    });
  }
});

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier MCP Server with Advanced AI, MCP, Firebase & Category Management',
    version: '2.0.0-mcp-enhanced-firebase-categories', // ✅ NEW: Updated version
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
      'Dynamic category management', // ✅ NEW: Category feature
      'Zero data loss on deployments'
    ],
    endpoints: {
      health: '/health',
      api: '/api',
      ai: '/api/ai',
      mcp: '/api/mcp',
      categories: '/api/categories', // ✅ NEW: Category endpoint
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
      mcp: `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`,
      description: 'Real-time MCP communication and streaming'
    },
    // 🆕 ADD: Persistence information
    persistence: {
      prompts: firebaseApp ? 'Firebase Firestore (permanent)' : 'File storage (temporary)',
      categories: firebaseApp ? 'Firebase Firestore (permanent)' : 'Fallback data (temporary)', // ✅ NEW: Category persistence
      dataLoss: firebaseApp ? 'Protected from deployment resets' : 'May be lost on deployment',
      database: firebaseConfig.projectId || 'none'
    },
    // ✅ NEW: Category management information
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
  
  // 🆕 ADD: Firebase-specific errors
  if (err.message && (err.message.includes('Firebase') || err.message.includes('Firestore'))) {
    return res.status(500).json({
      success: false,
      message: 'Firebase service error: ' + err.message,
      context: 'firebase_service'
    });
  }
  
  // ✅ NEW: Category-specific errors
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

// Start server with enhanced logging
const server = app.listen(PORT, async () => {
  console.log(`🚀 HiggsFlow Supplier MCP Server v2.0.0 (MCP-Enhanced + Firebase + Categories) is running on port ${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏱️  Timeout settings: Request: 5min, Response: 5min, Max file: 10MB`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🏦 Bank payment extraction: http://localhost:${PORT}/api/bank-payments/extract`);
  
  // Initialize categories after server starts
  if (firebaseApp && db) {
    await initializeDefaultCategories();
  }
  
  // 🆕 ADD: Firebase status logging
  console.log('\n🔥 Firebase Integration Status:');
  if (firebaseApp && db) {
    console.log(`   ✅ Firebase connected to project: ${firebaseConfig.projectId}`);
    console.log(`   ✅ Firestore database ready for prompt persistence`);
    console.log(`   ✅ Category management system active`);
    console.log(`   ✅ Prompts and categories will survive all deployments`);
  } else {
    console.log(`   ⚠️  Firebase not configured - prompts may be lost on deployment`);
    console.log(`   💡 Add Firebase environment variables to enable persistence`);
  }
  
  // ✅ NEW: Category management endpoints
  console.log('\n📁 Category Management endpoints:');
  console.log(`   📋 GET  http://localhost:${PORT}/api/categories - List all categories`);
  console.log(`   ➕ POST http://localhost:${PORT}/api/categories - Create new category`);
  console.log(`   ✏️  PUT  http://localhost:${PORT}/api/categories/:id - Update category`);
  console.log(`   🗑️  DEL  http://localhost:${PORT}/api/categories/:id - Delete category`);
  
  // Log AI endpoints
  console.log('\n🤖 Modular AI endpoints:');
  console.log(`   🏥 GET  http://localhost:${PORT}/api/ai/health - AI system health`);
  console.log(`   🧪 GET  http://localhost:${PORT}/api/ai/test - Quick functionality test`);
  console.log(`   📦 GET  http://localhost:${PORT}/api/ai/modules - Module management`);
  console.log(`   📝 GET  http://localhost:${PORT}/api/ai/prompts - Prompt management`);
  console.log(`   📄 POST http://localhost:${PORT}/api/ai/extract/purchase-order - Enhanced PO extraction`);
  console.log(`   📋 POST http://localhost:${PORT}/api/ai/extract/proforma-invoice - Enhanced PI extraction`);
  console.log(`   📚 GET  http://localhost:${PORT}/api/ai/docs - AI API documentation`);
  console.log(`   🔄 POST http://localhost:${PORT}/api/ai/extract-po - Legacy compatibility`);
  console.log(`   🔄 POST http://localhost:${PORT}/api/ai/extract-pi - Legacy compatibility`);
  
  // Log new MCP endpoints
  console.log('\n🔗 MCP endpoints (NEW):');
  console.log(`   🔧 GET  http://localhost:${PORT}/api/mcp/status - MCP service status`);
  console.log(`   📋 GET  http://localhost:${PORT}/api/mcp/capabilities - Available capabilities`);
  console.log(`   🛠️  GET  http://localhost:${PORT}/api/mcp/tools - List MCP tools`);
  console.log(`   ⚡ POST http://localhost:${PORT}/api/mcp/tools/execute - Execute MCP tool`);
  console.log(`   📄 POST http://localhost:${PORT}/api/mcp/extract - Enhanced extraction`);
  console.log(`   🏢 POST http://localhost:${PORT}/api/mcp/analyze/supplier - Supplier analysis`);
  console.log(`   💡 POST http://localhost:${PORT}/api/mcp/recommendations - AI recommendations`);
  console.log(`   📦 POST http://localhost:${PORT}/api/mcp/batch - Batch processing`);
  console.log(`   🔄 POST http://localhost:${PORT}/api/mcp/stream - Streaming processes`);
  console.log(`   📊 GET  http://localhost:${PORT}/api/mcp/monitor - System monitoring`);
  console.log(`   📚 GET  http://localhost:${PORT}/api/mcp/docs - MCP API documentation`);
  console.log(`   🌐 WebSocket: ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  
  // Environment variables check
  const requiredEnvVars = ['DEEPSEEK_API_KEY'];
  const optionalEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
  const mcpEnvVars = ['MCP_WS_PORT'];
  // 🆕 ADD: Firebase environment variables
  const firebaseEnvVars = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'
  ];
  
  const missingRequired = requiredEnvVars.filter(envVar => !process.env[envVar]);
  const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);
  const missingMCP = mcpEnvVars.filter(envVar => !process.env[envVar]);
  const missingFirebase = firebaseEnvVars.filter(envVar => !process.env[envVar] && !process.env[`VITE_${envVar}`]);

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
  
  if (missingMCP.length > 0) {
    console.log('\n💡 MCP configuration using defaults:');
    console.log(`   - MCP_WS_PORT: ${process.env.MCP_WS_PORT || 8080} (default)`);
  } else {
    console.log('✅ MCP configuration complete');
  }
  
  // 🆕 ADD: Firebase configuration check
  if (missingFirebase.length > 0) {
    console.log('\n⚠️  Firebase configuration incomplete:');
    console.log('   Missing variables (prompts & categories may be lost on deployment):');
    missingFirebase.forEach(envVar => {
      console.log(`   - ${envVar}`);
    });
    console.log('\n💡 To enable persistent storage, add these to Railway:');
    console.log('   FIREBASE_API_KEY=AIzaSyBxNZe2RYL1vJZgu93C3zdz2r0J-lDYgCY');
    console.log('   FIREBASE_AUTH_DOMAIN=higgsflow-b9f81.firebaseapp.com');
    console.log('   FIREBASE_PROJECT_ID=higgsflow-b9f81');
    console.log('   FIREBASE_STORAGE_BUCKET=higgsflow-b9f81.firebasestorage.app');
    console.log('   FIREBASE_MESSAGING_SENDER_ID=717201513347');
    console.log('   FIREBASE_APP_ID=1:717201513347:web:86abc12a7dcebe914834b6');
  } else {
    console.log('✅ Firebase configuration complete - prompts & categories will persist');
  }
  
  console.log('\n🎯 Features enabled:');
  console.log('   ✅ Modular AI architecture');
  console.log('   ✅ Multi-provider AI support');
  console.log('   ✅ Supplier-specific intelligence (PTP optimization)');
  console.log('   ✅ Enhanced document extraction');
  console.log('   ✅ Performance tracking and analytics');
  console.log('   ✅ Backward compatibility with existing APIs');
  console.log('   ✅ Model Context Protocol (MCP) integration');
  console.log('   ✅ Real-time WebSocket communication');
  console.log('   ✅ Advanced AI tool orchestration');
  console.log('   ✅ Batch processing capabilities');
  console.log('   ✅ Streaming process support');
  console.log(`   ${firebaseApp ? '✅' : '⚠️ '} Persistent prompt storage (Firebase)`);
  console.log(`   ${firebaseApp ? '✅' : '⚠️ '} Dynamic category management (Firebase)`); // ✅ NEW: Category feature status
  console.log(`   ${firebaseApp ? '✅' : '⚠️ '} Zero data loss on deployments`);
  
  console.log('\n🚀 Phase 2 (MCP Enhancement + Firebase + Categories) ready for testing!');
  console.log(`   Test: curl http://localhost:${PORT}/api/mcp/status`);
  console.log(`   Categories: curl http://localhost:${PORT}/api/categories`); // ✅ NEW: Category test
  console.log(`   Docs: http://localhost:${PORT}/api/mcp/docs`);
  console.log(`   WebSocket: ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  console.log(`   Firebase: ${firebaseApp ? 'Connected' : 'Not configured'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = app;
