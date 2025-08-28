const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();

console.log(`Starting HiggsFlow Server on port ${PORT}...`);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', credentials: true }));

// IMMEDIATE response endpoints - these respond instantly
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Server Running',
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    railway: true
  });
});

// Start server IMMEDIATELY
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT} - Railway ready!`);
  
  // Initialize services AFTER server is listening
  initializeServicesAsync();
});

// Initialize services asynchronously after server starts
async function initializeServicesAsync() {
  console.log('Initializing services in background...');
  
  try {
    // Firebase initialization (async)
    setTimeout(() => initializeFirebase(), 1000);
    
    // AI services (async)
    setTimeout(() => initializeAI(), 2000);
    
    // Routes (async)
    setTimeout(() => initializeRoutes(), 3000);
    
  } catch (error) {
    console.warn('Service initialization error (non-fatal):', error.message);
  }
}

async function initializeFirebase() {
  try {
    const { initializeApp } = require('firebase/app');
    const { getFirestore, collection, getDocs } = require('firebase/firestore');
    
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID
    };
    
    const firebaseApp = initializeApp(firebaseConfig);
    const db = getFirestore(firebaseApp);
    
    console.log('Firebase initialized successfully');
    
    // Add categories endpoint
    app.get('/api/categories', async (req, res) => {
      try {
        const categoriesRef = collection(db, 'categories');
        const snapshot = await getDocs(categoriesRef);
        
        const categories = [];
        snapshot.forEach((doc) => {
          categories.push({ id: doc.id, ...doc.data() });
        });
        
        res.json(categories.length > 0 ? categories : [
          { id: 'extraction', name: 'Extraction', description: 'Document extraction', color: '#3B82F6' },
          { id: 'general', name: 'General', description: 'General prompts', color: '#6B7280' }
        ]);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
  } catch (error) {
    console.warn('Firebase initialization failed:', error.message);
  }
}

async function initializeAI() {
  try {
    const UnifiedAIService = require('./services/ai/UnifiedAIService');
    const aiService = new UnifiedAIService();
    console.log('AI Service initialized successfully');
    
    // Add AI test endpoint
    app.get('/api/ai/test', async (req, res) => {
      try {
        const health = await aiService.healthCheck();
        res.json({ success: true, health });
      } catch (error) {
        res.json({ success: false, error: error.message });
      }
    });
    
  } catch (error) {
    console.warn('AI Service initialization failed:', error.message);
  }
}

async function initializeRoutes() {
  try {
    // Load API routes if available
    const apiRoutes = require('./routes/api.routes');
    app.use('/api', apiRoutes);
    console.log('API Routes loaded');
  } catch (error) {
    console.warn('API Routes not loaded:', error.message);
  }
  
  try {
    // Load AI routes if available
    const aiRoutes = require('./routes/ai.routes');
    app.use('/api/ai', aiRoutes);
    console.log('AI Routes loaded');
  } catch (error) {
    console.warn('AI Routes not loaded:', error.message);
  }
  
  console.log('All services initialized!');
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  server.close(() => {
    console.log('Server closed');
  });
});

module.exports = app;
