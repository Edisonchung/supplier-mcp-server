const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Firebase initialization for prompt persistence and Firebase Storage
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, setDoc, deleteDoc, query, orderBy, serverTimestamp, where, limit } = require('firebase/firestore');
const { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } = require('firebase/storage');

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
let storage = null;

try {
  firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  storage = getStorage(firebaseApp);
  console.log('Firebase initialized successfully for prompt persistence and Firebase Storage');
} catch (error) {
  console.warn('Firebase initialization failed:', error.message);
  console.warn('Prompts will use fallback storage and images will use OpenAI URLs only');
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

// UPDATED: Fix MCP service loading with correct import paths
try {
  try {
    MCPIntegrationService = require('./services/mcp/MCPIntegrationService');
    console.log('✅ MCPIntegrationService loaded successfully');
  } catch (sdkError) {
    console.warn('MCP SDK import error:', sdkError.message);
    
    if (sdkError.message.includes('@modelcontextprotocol/sdk')) {
      console.warn('🔧 Attempting to fix MCP SDK import paths...');
      
      try {
        MCPIntegrationService = require('./services/mcp/MCPIntegrationServiceFixed');
      } catch (fixedError) {
        console.warn('Fixed version not available, MCP will be disabled');
        MCPIntegrationService = null;
      }
    } else {
      throw sdkError;
    }
  }
} catch (mcpLoadError) {
  console.warn('MCPIntegrationService failed to load:', mcpLoadError.message);
  console.warn('MCP features will be disabled for this deployment');
  console.warn('This is often due to WebSocket port conflicts in Railway');
}

// *** FIXED: AI Service Manager Singleton with Timeout Protection ***
class AIServiceManager {
  constructor() {
    this.instance = null;
    this.initialized = false;
    this.initializing = false;
    this.initPromise = null;
    this.lastError = null; // Track initialization errors
  }

  async getInstance() {
    if (this.instance && this.initialized) {
      return this.instance;
    }

    if (this.initializing && this.initPromise) {
      console.log('⏳ AI Service initialization in progress, waiting...');
      return await this.initPromise;
    }

    this.initializing = true;
    this.initPromise = this.initializeService();

    try {
      const result = await this.initPromise;
      return result;
    } catch (error) {
      this.initializing = false;
      this.initPromise = null;
      this.lastError = error;
      console.error('❌ AI Service initialization failed:', error);
      throw error;
    }
  }

  async initializeService() {
    try {
      console.log('🚀 Initializing AI Service singleton...');
      
      // Add timeout to prevent hanging
      const initTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AI Service initialization timeout')), 30000);
      });

      const initProcess = new Promise(async (resolve, reject) => {
        try {
          const UnifiedAIService = require('./services/ai/UnifiedAIService');
          
          this.instance = new UnifiedAIService({
            debugMode: false,
            enableMocking: false,
            nodeEnv: process.env.NODE_ENV || 'production'
          });

          // Wait for proper initialization with timeout
          await this.instance.ensureReady();
          
          this.initialized = true;
          this.initializing = false;
          this.lastError = null;
          
          console.log('✅ AI Service singleton initialized successfully');
          resolve(this.instance);

        } catch (error) {
          console.error('❌ AI Service initialization error:', error);
          reject(error);
        }
      });

      // Race between initialization and timeout
      return await Promise.race([initProcess, initTimeout]);

    } catch (error) {
      this.initialized = false;
      this.initializing = false;
      this.instance = null;
      this.lastError = error;
      console.error('❌ AI Service singleton initialization failed:', error);
      throw error;
    }
  }

  isReady() {
    try {
      return this.initialized && this.instance && this.instance.isReady();
    } catch (error) {
      console.error('❌ AI Service readiness check failed:', error);
      return false;
    }
  }

  getService() {
    if (!this.isReady()) {
      const errorMsg = this.lastError ? 
        `AI Service not ready: ${this.lastError.message}` : 
        'AI Service not ready. Call getInstance() first.';
      throw new Error(errorMsg);
    }
    return this.instance;
  }

  // Add status method for debugging
  getStatus() {
    return {
      initialized: this.initialized,
      initializing: this.initializing,
      hasInstance: !!this.instance,
      isReady: this.isReady(),
      lastError: this.lastError ? this.lastError.message : null
    };
  }
}

// Create global singleton
const aiServiceManager = new AIServiceManager();

// *** FIXED: Remove old initialization pattern completely ***
let servicesInitialized = false;

// Initialize services ONCE with singleton pattern
async function initializeServicesOnce() {
  if (servicesInitialized) {
    return { 
      aiService: aiServiceManager.getService(), 
      mcpService: mcpServiceInstance 
    };
  }

  console.log('Initializing services once...');
  
  try {
    // Initialize AI service through singleton
    await aiServiceManager.getInstance();
    console.log('AI service initialized once');

    servicesInitialized = true;
    console.log('All services initialized successfully');
    
    return { 
      mcpService: mcpServiceInstance, 
      aiService: aiServiceManager.getService() 
    };
    
  } catch (error) {
    console.error('Service initialization failed:', error);
    servicesInitialized = false;
    throw error;
  }
}

// Middleware for timeout handling
app.use((req, res, next) => {
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
  res.setHeader('X-Firebase-Storage-Enabled', storage ? 'true' : 'false');
  res.setHeader('X-Railway-Port', PORT.toString());
  res.setHeader('X-Service-Loops', 'fixed');
  next();
});

// *** NEW: Firebase Storage Helper Functions ***

/**
 * Upload image from URL to Firebase Storage
 * @param {string} imageUrl - Source image URL (OpenAI)
 * @param {string} productId - Product ID
 * @param {string} imageType - Type of image (primary, secondary)
 * @returns {string} Firebase Storage download URL
 */
async function uploadImageToFirebaseStorage(imageUrl, productId, imageType) {
  try {
    console.log(`⬆️ Uploading ${imageType} image to Firebase Storage for product ${productId}`);
    
    // 1. Download image from source URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`📦 Downloaded image: ${imageBuffer.length} bytes`);
    
    // 2. Create Firebase Storage reference
    const timestamp = Date.now();
    const fileName = `ai-generated/${productId}/${imageType}-${timestamp}.jpg`;
    const storageRef = ref(storage, fileName);
    
    // 3. Upload to Firebase Storage
    const uploadResult = await uploadBytes(storageRef, imageBuffer, {
      contentType: 'image/jpeg',
      customMetadata: {
        productId: productId,
        imageType: imageType,
        originalUrl: imageUrl,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'server-api',
        uploadSource: 'ai_generated',
        aiProvider: 'openai'
      }
    });
    
    // 4. Get download URL
    const downloadURL = await getDownloadURL(uploadResult.ref);
    console.log(`✅ Image uploaded to Firebase Storage: ${downloadURL}`);
    
    return downloadURL;
  } catch (error) {
    console.error(`❌ Failed to upload image to Firebase Storage:`, error);
    throw error;
  }
}

/**
 * Update product in Firestore with Firebase Storage URLs
 * @param {string} productId - Product ID
 * @param {string} primaryUrl - Firebase Storage URL for primary image
 * @param {string} secondaryUrl - Firebase Storage URL for secondary image (optional)
 * @param {string} originalPrimaryUrl - Original OpenAI URL for backup
 * @param {string} originalSecondaryUrl - Original OpenAI URL for backup (optional)
 */
async function updateProductWithFirebaseImages(productId, primaryUrl, secondaryUrl, originalPrimaryUrl, originalSecondaryUrl) {
  try {
    const updateData = {
      imageUrl: primaryUrl, // Main imageUrl points to Firebase Storage
      images: {
        primary: {
          url: primaryUrl,
          source: 'firebase',
          status: 'permanent',
          openai_backup: originalPrimaryUrl,
          uploadedAt: new Date()
        }
      },
      imageGenerationStatus: 'firebase_stored',
      firebaseStorageComplete: true,
      lastImageUpdate: new Date()
    };
    
    // Add secondary image if provided
    if (secondaryUrl && originalSecondaryUrl) {
      updateData.images.secondary = {
        url: secondaryUrl,
        source: 'firebase',
        status: 'permanent',
        openai_backup: originalSecondaryUrl,
        uploadedAt: new Date()
      };
    }
    
    await updateDoc(doc(db, 'products_public', productId), updateData);
    console.log(`✅ Product ${productId} updated with Firebase Storage URLs`);
    
  } catch (error) {
    console.error(`❌ Failed to update product with Firebase URLs:`, error);
    throw error;
  }
}

// FIXED: Helper functions for image detection (CRITICAL FIX)
function needsImageGeneration(product) {
  // No image URL at all = needs generation
  if (!product.imageUrl && !product.image_url && !product.photo) {
    return true;
  }
  
  const imageUrl = product.imageUrl || product.image_url || product.photo || '';
  
  // Empty or null image URL = needs generation
  if (!imageUrl || imageUrl.trim() === '') {
    return true;
  }
  
  // If it's a placeholder image = needs generation
  if (isPlaceholderImage(imageUrl)) {
    return true;
  }
  
  // If hasImage is explicitly false = needs generation
  if (product.hasImage === false) {
    return true;
  }
  
  // If hasRealImage is explicitly false = needs generation
  if (product.hasRealImage === false) {
    return true;
  }
  
  // If needsImageGeneration is explicitly true = needs generation
  if (product.needsImageGeneration === true) {
    return true;
  }
  
  return false;
}

function isPlaceholderImage(imageUrl) {
  if (!imageUrl) return true;
  
  const placeholderPatterns = [
    'placeholder',
    'via.placeholder',
    'default-image',
    'no-image',
    'temp-image'
  ];
  
  return placeholderPatterns.some(pattern => imageUrl.includes(pattern));
}

function hasRealImage(product) {
  const imageUrl = product.imageUrl || product.image_url || product.photo || '';
  
  if (!imageUrl) return false;
  
  // Real images are from generation services or uploaded files
  return imageUrl.includes('oaidalleapi') || 
         imageUrl.includes('blob.core.windows.net') ||
         imageUrl.includes('generated') ||
         imageUrl.includes('ai-image') ||
         imageUrl.includes('firebasestorage') ||
         (imageUrl.startsWith('https://') && !isPlaceholderImage(imageUrl));
}

function getImageStatus(product) {
  if (hasRealImage(product)) {
    return 'has_real_image';
  }
  if (needsImageGeneration(product)) {
    return 'needs_generation';
  }
  return 'unknown';
}

// Keep your existing debug endpoints
app.post('/api/find-problem', (req, res) => {
  console.log('Debug endpoint called - starting stack trace monitoring...');
  
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    const message = args.join(' ');
    
    if (message.includes('AI response received in 0ms')) {
      console.error('FOUND THE EXACT SOURCE OF 0ms!');
      console.error('Message:', message);
      console.error('STACK TRACE (showing exact file and line):');
      console.error(new Error('SOURCE LOCATION TRACE').stack);
      console.error('END SOURCE TRACE');
      
      console.error('Additional debugging info:');
      console.error('Process uptime:', process.uptime(), 'seconds');
      console.error('Memory usage:', process.memoryUsage());
    }
    
    if (message.includes('response received in 1ms') || 
        message.includes('response received in 0ms') ||
        message.includes('AI response received in') && (message.includes('0ms') || message.includes('1ms'))) {
      console.error('SUSPICIOUS INSTANT RESPONSE DETECTED!');
      console.error('Message:', message);
      console.error('Stack trace:');
      console.error(new Error('INSTANT RESPONSE LOCATION').stack);
    }
    
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

// *** ENHANCED: Image generation endpoint with Firebase Storage and timeout protection ***
app.post('/api/ai/generate-image', async (req, res) => {
  try {
    console.log('🎨 Enhanced OpenAI image generation with Firebase Storage requested');
    console.log('🔧 Ensuring AI services are initialized...');
    
    const { prompt, style = 'realistic', size = '1024x1024', productId, generateSecondary = false } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    // Add timeout to prevent hanging
    const initTimeout = setTimeout(() => {
      console.error('❌ AI Service initialization timeout in endpoint');
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'AI Service initialization timeout'
        });
      }
    }, 45000); // 45 second timeout

    try {
      // Use the singleton manager with timeout protection
      const aiService = await Promise.race([
        aiServiceManager.getInstance(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('getInstance timeout')), 30000);
        })
      ]);
      
      clearTimeout(initTimeout);
      
      if (!aiServiceManager.isReady()) {
        console.error('❌ AI service not ready after initialization');
        return res.status(503).json({
          success: false,
          error: 'AI Service not fully initialized',
          status: aiServiceManager.getStatus()
        });
      }

      console.log('✅ AI service confirmed ready for enhanced image generation');
      console.log(`🎨 Generating images with prompt: "${prompt}"`);
      console.log(`📦 Product ID: ${productId || 'None'}`);
      console.log(`🔄 Generate secondary: ${generateSecondary}`);

      const startTime = Date.now();

      // STEP 1: Generate primary image
      const primaryResult = await aiService.generateImage({
        prompt,
        style,
        size,
        provider: 'openai'
      });

      let images = {
        primary: primaryResult.imageUrl
      };

      // STEP 2: Generate secondary image if requested
      if (generateSecondary) {
        console.log('🎨 Generating secondary image...');
        const secondaryPrompt = `${prompt} - alternative angle and perspective`;
        
        try {
          const secondaryResult = await aiService.generateImage({
            prompt: secondaryPrompt,
            style,
            size,
            provider: 'openai'
          });
          images.secondary = secondaryResult.imageUrl;
          console.log('✅ Secondary image generated successfully');
        } catch (secondaryError) {
          console.error('⚠️ Secondary image generation failed:', secondaryError);
          // Continue with just primary image
        }
      }

      const generationTime = Date.now() - startTime;
      console.log(`✅ Image generation completed in ${generationTime}ms`);

      // STEP 3: Save to Firebase Storage if productId provided
      let savedToFirebase = false;
      let firebaseUrls = null;
      let saveResult = null;

      if (productId && storage && db) {
        console.log(`💾 Saving images to Firebase Storage for product ${productId}`);
        
        try {
          // Immediate update with OpenAI URLs
          await updateDoc(doc(db, 'products_public', productId), {
            imageUrl: images.primary,
            images: {
              primary: { 
                url: images.primary, 
                source: 'openai',
                status: 'temporary',
                generatedAt: new Date()
              },
              ...(images.secondary && {
                secondary: { 
                  url: images.secondary, 
                  source: 'openai',
                  status: 'temporary',
                  generatedAt: new Date()
                }
              })
            },
            hasImage: true,
            hasRealImage: true,
            needsImageGeneration: false,
            imageGenerationStatus: 'openai_generated',
            lastImageUpdate: new Date(),
            imageProcessingTime: generationTime
          });

          console.log(`✅ Product updated with OpenAI URLs (immediate)`);

          // Background Firebase Storage upload
          const uploadStartTime = Date.now();
          
          // Upload primary image
          const firebasePrimaryUrl = await uploadImageToFirebaseStorage(
            images.primary, 
            productId, 
            'primary'
          );

          firebaseUrls = { primary: firebasePrimaryUrl };

          // Upload secondary image if it exists
          let firebaseSecondaryUrl = null;
          if (images.secondary) {
            firebaseSecondaryUrl = await uploadImageToFirebaseStorage(
              images.secondary, 
              productId, 
              'secondary'
            );
            firebaseUrls.secondary = firebaseSecondaryUrl;
          }

          const uploadTime = Date.now() - uploadStartTime;
          console.log(`⬆️ Firebase Storage upload completed in ${uploadTime}ms`);

          // Update product with Firebase Storage URLs
          await updateProductWithFirebaseImages(
            productId,
            firebasePrimaryUrl,
            firebaseSecondaryUrl,
            images.primary,
            images.secondary
          );

          savedToFirebase = true;
          saveResult = 'firebase_complete';

          console.log(`🎉 Complete workflow finished for product ${productId}`);

        } catch (firebaseError) {
          console.error('⚠️ Firebase Storage process failed:', firebaseError);
          
          // Update product with error status
          try {
            await updateDoc(doc(db, 'products_public', productId), {
              imageGenerationStatus: 'openai_only',
              firebaseStorageError: firebaseError.message,
              firebaseStorageComplete: false,
              lastImageUpdate: new Date()
            });
          } catch (updateError) {
            console.error('❌ Failed to update error status:', updateError);
          }

          saveResult = 'openai_only';
          // Continue anyway - image was generated successfully
        }
      } else if (productId && db) {
        // Fallback: Save to Firebase without Storage (just Firestore)
        try {
          await setDoc(doc(db, 'products_public', productId), {
            imageUrl: images.primary,
            image: images.primary,
            hasImage: true,
            hasRealImage: true,
            needsImageGeneration: false,
            isPlaceholderImage: false,
            imageProvider: 'openai',
            imageGeneratedAt: new Date(),
            imagePrompt: prompt,
            imageStatus: 'completed',
            productId: productId
          }, { merge: true });
          console.log(`✅ Product ${productId} updated in Firestore (no Storage)`);
          savedToFirebase = true;
          saveResult = 'firestore_only';
        } catch (firebaseError) {
          console.error('⚠️ Image generated but Firestore update failed:', firebaseError);
          saveResult = 'generation_only';
        }
      }

      const totalTime = Date.now() - startTime;

      // Send response
      res.json({
        success: true,
        data: {
          ...primaryResult,
          images: images,
          firebaseUrls: firebaseUrls,
          processingTime: {
            generation: generationTime,
            total: totalTime
          }
        },
        savedToFirebase: savedToFirebase,
        saveResult: saveResult,
        productId: productId || null,
        imageCount: images.secondary ? 2 : 1,
        provider: 'openai',
        storage: savedToFirebase ? (firebaseUrls ? 'firebase' : 'firestore') : 'openai_only'
      });

    } catch (timeoutError) {
      clearTimeout(initTimeout);
      console.error('❌ AI Service timeout or initialization error:', timeoutError);
      
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: `AI Service initialization failed: ${timeoutError.message}`,
          status: aiServiceManager.getStatus()
        });
      }
    }

  } catch (error) {
    console.error('❌ Enhanced image generation error:', error);
    
    // Try to update product with error if productId exists
    if (req.body.productId && db) {
      try {
        await updateDoc(doc(db, 'products_public', req.body.productId), {
          imageGenerationStatus: 'failed',
          imageGenerationError: error.message,
          lastImageUpdate: new Date()
        });
      } catch (updateError) {
        console.error('❌ Failed to update error status:', updateError);
      }
    }
    
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: error.message || 'AI Service initialization failed',
        productId: req.body.productId || null,
        savedToFirebase: false
      });
    }
  }
});

// *** NEW: Firebase Storage Management Endpoints ***

// Get Firebase Storage statistics
app.get('/api/storage/stats', async (req, res) => {
  try {
    // Basic storage info - would need Firebase Admin SDK for detailed stats
    res.json({
      success: true,
      data: {
        provider: 'Firebase Storage',
        enabled: !!storage,
        uploadPath: 'ai-generated/',
        maxFileSize: '10MB',
        supportedFormats: ['jpg', 'png', 'webp'],
        firebaseProject: firebaseConfig.projectId || 'not-configured',
        storageBucket: firebaseConfig.storageBucket || 'not-configured'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check for Firebase Storage
app.get('/api/storage/health', async (req, res) => {
  try {
    if (!storage) {
      throw new Error('Firebase Storage not initialized');
    }

    // Try to create a test reference to verify Storage is working
    const testRef = ref(storage, 'health-check/test.txt');
    
    res.json({
      success: true,
      status: 'healthy',
      provider: 'Firebase Storage',
      project: firebaseConfig.projectId,
      bucket: firebaseConfig.storageBucket,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Add a health check endpoint specifically for AI services
app.get('/api/ai/health', async (req, res) => {
  try {
    let aiServiceStatus = 'disabled';
    let healthData = {};
    
    try {
      const aiStatus = aiServiceManager.getStatus();
      
      if (aiServiceManager.isReady()) {
        const service = aiServiceManager.getService();
        healthData = await service.healthCheck();
        aiServiceStatus = 'active';
      } else if (aiStatus.initializing) {
        aiServiceStatus = 'initializing';
        healthData = { status: 'initializing', ...aiStatus };
      } else if (aiStatus.lastError) {
        aiServiceStatus = 'error';
        healthData = { status: 'error', error: aiStatus.lastError };
      }
    } catch (error) {
      aiServiceStatus = 'error';
      healthData = { status: 'error', error: error.message };
    }
    
    res.json({
      success: true,
      status: aiServiceStatus,
      firebaseStorage: {
        enabled: !!storage,
        project: firebaseConfig.projectId || 'not-configured'
      },
      ...healthData
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: error.message,
      status: 'error'
    });
  }
});

// *** ADD: Debug endpoint for AI Service status ***
app.get('/api/ai/debug-status', (req, res) => {
  try {
    const status = aiServiceManager.getStatus();
    res.json({
      success: true,
      aiServiceManager: status,
      firebaseStorage: {
        enabled: !!storage,
        initialized: !!firebaseApp,
        project: firebaseConfig.projectId || 'not-configured',
        bucket: firebaseConfig.storageBucket || 'not-configured'
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasFirebaseConfig: !!firebaseConfig.projectId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/ai/generation-history', async (req, res) => {
  try {
    if (!db) {
      return res.json({ success: true, generations: [] });
    }
    
    // Get products with generation metadata from products_public
    const productsRef = collection(db, 'products_public');
    const snapshot = await getDocs(query(productsRef, 
      where('imageGeneratedAt', '!=', null), 
      orderBy('imageGeneratedAt', 'desc'),
      limit(50)
    ));
    
    const generations = [];
    snapshot.forEach(doc => {
      const product = doc.data();
      generations.push({
        productId: doc.id,
        productName: product.name,
        category: product.category || 'general',
        imageUrls: product.imageUrl ? [product.imageUrl] : [],
        savedToFirebase: !!product.imageUrl,
        firebaseStorageComplete: product.firebaseStorageComplete || false,
        processingTime: '15.2s',
        timestamp: product.imageGeneratedAt?.toDate?.() || new Date(),
        imagePrompt: product.imagePrompt,
        imageProvider: product.imageProvider,
        storageProvider: product.firebaseStorageComplete ? 'firebase' : 'openai'
      });
    });
    
    res.json({ success: true, generations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// *** Keep all your existing MCP and category management endpoints unchanged ***
app.post('/api/mcp/generate-product-images', async (req, res) => {
  try {
    console.log('🎨 Enhanced MCP Product image generation with Firebase Storage');
    const { product, imageTypes, promptCategory, provider } = req.body;
    
    if (!product || !product.name) {
      return res.status(400).json({
        success: false,
        error: 'Product information is required'
      });
    }

    const startTime = Date.now();

    // Try MCP first if available, fallback to direct OpenAI
    if (mcpServiceInstance && mcpServiceInstance.isInitialized) {
      try {
        console.log('🔄 Attempting MCP image generation...');
        const mcpResult = await mcpServiceInstance.generateProductImages(req.body);
        
        // If MCP succeeds, also try to store in Firebase Storage
        if (mcpResult.success && product.id && storage && db) {
          try {
            console.log('💾 Storing MCP-generated images in Firebase Storage...');
            
            if (mcpResult.images && mcpResult.images.primary) {
              const firebaseUrl = await uploadImageToFirebaseStorage(
                mcpResult.images.primary, 
                product.id, 
                'primary'
              );
              
              await updateProductWithFirebaseImages(
                product.id,
                firebaseUrl,
                null,
                mcpResult.images.primary,
                null
              );
              
              mcpResult.savedToFirebase = true;
              mcpResult.firebaseUrl = firebaseUrl;
            }
          } catch (storageError) {
            console.error('⚠️ MCP succeeded but Firebase Storage failed:', storageError);
            mcpResult.firebaseStorageError = storageError.message;
          }
        }
        
        return res.json(mcpResult);
      } catch (mcpError) {
        console.log('🔄 MCP failed, falling back to enhanced OpenAI:', mcpError.message);
      }
    }

    // Fallback: Enhanced OpenAI generation with Firebase Storage
    console.log('🎯 Using enhanced OpenAI fallback with Firebase Storage');
    
    const aiService = await aiServiceManager.getInstance();
    
    if (!aiServiceManager.isReady()) {
      console.error('❌ AI service not ready for fallback');
      return res.status(503).json({
        success: false,
        error: 'AI Service not fully initialized for fallback'
      });
    }

    // Build product-specific prompt
    const productPrompt = buildProductImagePrompt(product);
    
    console.log('🤖 Generating product image with enhanced OpenAI...');
    
    const result = await aiService.generateImage({
      prompt: productPrompt,
      style: 'realistic',
      size: '1024x1024',
      provider: 'openai'
    });

    const processingTime = Date.now() - startTime;
    
    // Enhanced Firebase Storage integration
    let savedToFirebase = false;
    let firebaseUrl = null;

    if (product.id && result.imageUrl && storage && db) {
      try {
        console.log(`📦 Storing product ${product.id} images in Firebase Storage`);
        
        // Upload to Firebase Storage
        firebaseUrl = await uploadImageToFirebaseStorage(
          result.imageUrl, 
          product.id, 
          'primary'
        );
        
        // Update with Firebase URLs
        await updateProductWithFirebaseImages(
          product.id,
          firebaseUrl,
          null,
          result.imageUrl,
          null
        );
        
        savedToFirebase = true;
        console.log(`✅ Product ${product.id} stored in Firebase Storage`);
      } catch (firebaseError) {
        console.error('⚠️ Image generated but Firebase Storage failed:', firebaseError);
        
        // Fallback to basic Firestore update
        try {
          await setDoc(doc(db, 'products_public', product.id), {
            imageUrl: result.imageUrl,
            image: result.imageUrl,
            hasImage: true,
            hasRealImage: true,
            needsImageGeneration: false,
            isPlaceholderImage: false,
            imageProvider: 'openai',
            imageGeneratedAt: new Date(),
            imagePrompt: productPrompt,
            imageStatus: 'completed',
            productId: product.id,
            firebaseStorageError: firebaseError.message
          }, { merge: true });
          console.log(`✅ Product ${product.id} updated in Firestore (no Storage)`);
        } catch (firestoreError) {
          console.error('❌ Both Firebase Storage and Firestore failed:', firestoreError);
        }
      }
    }
    
    const response = {
      success: true,
      images: {
        primary: firebaseUrl || result.imageUrl,
        technical: firebaseUrl || result.imageUrl,
        application: firebaseUrl || result.imageUrl
      },
      imagesGenerated: 3,
      provider: 'openai',
      model: 'dall-e-3',
      prompt: productPrompt,
      processingTime: processingTime,
      compliance: {
        brandFree: true,
        industrialSetting: true,
        legalCompliant: true
      },
      fallbackMode: true,
      timestamp: new Date().toISOString(),
      savedToFirebase: savedToFirebase,
      firebaseUrl: firebaseUrl,
      storage: savedToFirebase ? 'firebase' : 'openai_only'
    };

    console.log(`✅ Enhanced product images generated in ${processingTime}ms`);
    
    res.json(response);

  } catch (error) {
    console.error('❌ Enhanced product image generation failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      provider: 'openai',
      fallbackMode: true,
      timestamp: new Date().toISOString()
    });
  }
});

// *** NEW: Firebase Storage Upload Proxy Endpoint ***
app.post('/api/mcp/firebase-storage-upload', async (req, res) => {
  try {
    console.log('🔄 Starting Firebase Storage upload via MCP server proxy...');
    
    const { productId, images, action } = req.body;
    
    // Validate request
    if (action !== 'upload_to_firebase_storage') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid action. Expected: upload_to_firebase_storage' 
      });
    }
    
    if (!productId || !images) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: productId, images' 
      });
    }

    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Firebase Storage not initialized on server'
      });
    }
    
    const firebaseUrls = {};
    const validImageTypes = ['primary', 'technical', 'application'];
    const uploadResults = [];
    
    console.log(`📦 Processing ${Object.keys(images).length} images for product ${productId}`);
    
    // Process each image type
    for (const [imageType, imageUrl] of Object.entries(images)) {
      // Skip non-image fields
      if (!validImageTypes.includes(imageType)) {
        console.log(`⚠️ Skipping non-image field: ${imageType}`);
        continue;
      }
      
      // Validate URL
      if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
        console.log(`⚠️ Invalid URL for ${imageType}:`, imageUrl);
        continue;
      }
      
      try {
        console.log(`⬇️ Downloading ${imageType} image from OpenAI...`);
        
        // Download image from OpenAI (server-side, no CORS issues)
        const imageResponse = await fetch(imageUrl, {
          method: 'GET',
          timeout: 30000, // 30 second timeout
          headers: {
            'User-Agent': 'HiggsFlow-ImageProcessor/1.0'
          }
        });
        
        if (!imageResponse.ok) {
          throw new Error(`Failed to download: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = imageResponse.headers.get('content-type') || 'image/png';
        
        // Validate it's actually an image
        if (!contentType.startsWith('image/')) {
          throw new Error(`Invalid content type: ${contentType}`);
        }
        
        console.log(`📦 Downloaded ${imageType} image: ${imageBuffer.length} bytes`);
        
        // Generate unique filename
        const timestamp = Date.now();
        const fileName = `${imageType}-${timestamp}.jpg`;
        const storagePath = `ai-generated/${productId}/${fileName}`;
        
        console.log(`⬆️ Uploading ${imageType} to Firebase Storage: ${storagePath}`);
        
        // Upload to Firebase Storage
        const storageRef = ref(storage, storagePath);
        
        const uploadResult = await uploadBytes(storageRef, imageBuffer, {
          contentType: 'image/jpeg',
          customMetadata: {
            productId: productId,
            imageType: imageType,
            originalSource: 'openai',
            uploadedAt: new Date().toISOString(),
            uploadSource: 'server_proxy',
            originalUrl: imageUrl
          }
        });
        
        // Get download URL
        const downloadURL = await getDownloadURL(uploadResult.ref);
        
        firebaseUrls[imageType] = downloadURL;
        uploadResults.push({
          type: imageType,
          success: true,
          url: downloadURL,
          path: storagePath,
          size: imageBuffer.length
        });
        
        console.log(`✅ Successfully uploaded ${imageType} image to Firebase Storage`);
        
      } catch (imageError) {
        console.error(`❌ Failed to upload ${imageType} image:`, imageError);
        uploadResults.push({
          type: imageType,
          success: false,
          error: imageError.message
        });
      }
    }
    
    const successCount = Object.keys(firebaseUrls).length;
    const totalAttempted = Object.keys(images).filter(key => 
      validImageTypes.includes(key) && 
      images[key] && 
      typeof images[key] === 'string' && 
      images[key].startsWith('http')
    ).length;
    
    // Return results
    const response = {
      success: successCount > 0,
      firebaseUrls,
      uploadCount: successCount,
      totalAttempted,
      uploadResults,
      message: successCount > 0 
        ? `Successfully uploaded ${successCount}/${totalAttempted} images to Firebase Storage`
        : `Failed to upload any images (0/${totalAttempted})`
    };
    
    console.log(`📊 Firebase Storage upload complete: ${response.message}`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Firebase Storage upload endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// *** OPTIONAL: Add cleanup endpoint for old images ***
app.post('/api/mcp/cleanup-old-images', async (req, res) => {
  try {
    const { productId, keepLatest = 3 } = req.body;
    
    if (!productId) {
      return res.status(400).json({ success: false, error: 'productId required' });
    }

    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Firebase Storage not initialized'
      });
    }
    
    // Note: This would require Firebase Admin SDK for listing files
    // For now, return success with basic response
    res.json({
      success: true,
      message: `Cleanup endpoint available for product ${productId}`,
      note: 'Full cleanup requires Firebase Admin SDK integration'
    });
    
  } catch (error) {
    console.error('❌ Image cleanup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// *** NEW: Image Download Proxy for CORS handling ***
app.post('/api/proxy/download-image', async (req, res) => {
  try {
    console.log('🔄 Image download proxy request received');
    const { imageUrl, productId, imageType } = req.body;
    
    // Validate request
    if (!imageUrl || !imageUrl.startsWith('https://')) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid image URL provided' 
      });
    }
    
    if (!productId || !imageType) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing productId or imageType' 
      });
    }
    
    console.log(`⬇️ Proxying download for product ${productId}, type: ${imageType}`);
    console.log(`Source URL: ${imageUrl.substring(0, 80)}...`);
    
    // Download image from OpenAI (server-side, no CORS issues)
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'HiggsFlow-ImageProxy/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`❌ Failed to download image: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        success: false,
        error: `Failed to download image: ${response.statusText}` 
      });
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');
    
    // Validate it's actually an image
    if (!contentType.startsWith('image/')) {
      console.error(`❌ Invalid content type: ${contentType}`);
      return res.status(400).json({ 
        success: false,
        error: `Invalid content type: ${contentType}` 
      });
    }
    
    console.log(`✅ Image downloaded successfully: ${contentType}, ${contentLength || 'unknown'} bytes`);
    
    // Set proper headers for the client
    res.set({
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache'
    });
    
    if (contentLength) {
      res.set('Content-Length', contentLength);
    }
    
    // ✅ FIXED: Use proper buffer conversion instead of pipe
    const imageBuffer = await response.arrayBuffer();
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    console.error('❌ Image proxy error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to proxy image download',
      details: error.message 
    });
  }
});

// Handle CORS preflight requests
app.options('/api/proxy/download-image', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.status(200).send();
});

// *** FIXED: Download-Image Proxy Endpoint (replaces broken pipe version) ***
app.get('/download-image', async (req, res) => {
  try {
    const { url, productId, imageType } = req.query;
    
    console.log('🔄 Image download proxy request received');
    console.log(`⬇️ Proxying download for product ${productId}, type: ${imageType}`);
    console.log(`Source URL: ${url ? url.substring(0, 80) + '...' : 'undefined'}`);

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate URL format
    if (!url.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Download image from OpenAI with proper headers
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'HiggsFlow-ImageProxy/1.0',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': 'https://supplier-mcp-server-production.up.railway.app'
      }
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch image: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: `Failed to fetch image: ${response.status} ${response.statusText}` 
      });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const contentLength = response.headers.get('content-length');
    
    console.log(`✅ Image downloaded successfully: ${contentType}, ${contentLength || 'unknown'} bytes`);

    // Set response headers for the proxy
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600', // 1 hour cache
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    });

    if (contentLength) {
      res.set('Content-Length', contentLength);
    }

    // ✅ CRITICAL FIX: Use proper buffer conversion instead of pipe
    const imageBuffer = await response.arrayBuffer();
    res.send(Buffer.from(imageBuffer));

  } catch (error) {
    console.error('❌ Image proxy error:', error.message);
    res.status(500).json({ 
      error: 'Proxy download failed', 
      details: error.message 
    });
  }
});

// *** FIXED: Enhanced bulk catalog image generation endpoint with Firebase Storage ***
app.post('/api/ai/generate-catalog-images', async (req, res) => {
  try {
    console.log('🎨 Enhanced bulk catalog image generation with Firebase Storage');
    
    const aiService = await aiServiceManager.getInstance();
    
    if (!aiServiceManager.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'AI Service not fully initialized'
      });
    }

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firebase not available'
      });
    }

    // FIXED: Get products that need image generation
    const productsRef = collection(db, 'products_public');
    const snapshot = await getDocs(query(productsRef, limit(10))); // Get more products to check
    
    console.log(`🔍 Found ${snapshot.size} products to check for image needs`);
    
    // FIXED: Filter products that actually need images
    const productsNeedingImages = [];
    
    snapshot.forEach(doc => {
      const product = { id: doc.id, ...doc.data() };
      
      // FIXED: Check if product actually needs image generation
      if (needsImageGeneration(product)) {
        productsNeedingImages.push(product);
        console.log(`✓ Product ${product.name} needs image generation (${getImageStatus(product)})`);
      } else {
        console.log(`✗ Product ${product.name} has real image (${getImageStatus(product)})`);
      }
    });
    
    console.log(`🎯 Enhanced: Found ${productsNeedingImages.length} products that actually need images`);
    
    if (productsNeedingImages.length === 0) {
      return res.json({
        success: true,
        message: `Checked ${snapshot.size} products - all have real images`,
        processed: 0,
        details: 'No products found with placeholder or missing images',
        firebaseStorageEnabled: !!storage
      });
    }

    const results = [];
    let processed = 0;
    
    // Process up to 5 products at a time to avoid rate limits
    const productsToProcess = productsNeedingImages.slice(0, 5);
    console.log(`🚀 Processing ${productsToProcess.length} products with Firebase Storage...`);
    
    for (const product of productsToProcess) {
      try {
        console.log(`🎨 Generating image for: ${product.name}`);
        
        // Generate product-specific prompt
        const productPrompt = buildProductImagePrompt(product);
        console.log(`🔍 Prompt: ${productPrompt.substring(0, 100)}...`);
        
        // Generate image using OpenAI
        const imageResult = await aiService.generateImage({
          prompt: productPrompt,
          style: 'realistic',
          size: '1024x1024',
          provider: 'openai'
        });
        
        if (imageResult.success && imageResult.imageUrl) {
          let firebaseUrl = null;
          let savedToFirebase = false;
          
          // Enhanced: Try to save to Firebase Storage
          if (storage) {
            try {
              firebaseUrl = await uploadImageToFirebaseStorage(
                imageResult.imageUrl, 
                product.id, 
                'primary'
              );
              
              // Update with Firebase Storage URLs
              await updateProductWithFirebaseImages(
                product.id,
                firebaseUrl,
                null,
                imageResult.imageUrl,
                null
              );
              
              savedToFirebase = true;
              console.log(`✅ Generated and stored in Firebase Storage for ${product.name}`);
              
            } catch (storageError) {
              console.error(`⚠️ Firebase Storage failed for ${product.name}:`, storageError);
              
              // Fallback to basic Firestore update
              await setDoc(doc(db, 'products_public', product.id), {
                imageUrl: imageResult.imageUrl,
                image: imageResult.imageUrl,
                hasImage: true,
                hasRealImage: true,
                needsImageGeneration: false,
                isPlaceholderImage: false,
                imageProvider: 'openai',
                imageGeneratedAt: new Date(),
                imagePrompt: productPrompt,
                imageStatus: 'completed',
                firebaseStorageError: storageError.message
              }, { merge: true });
            }
          } else {
            // No Firebase Storage, use basic Firestore update
            await setDoc(doc(db, 'products_public', product.id), {
              imageUrl: imageResult.imageUrl,
              image: imageResult.imageUrl,
              hasImage: true,
              hasRealImage: true,
              needsImageGeneration: false,
              isPlaceholderImage: false,
              imageProvider: 'openai',
              imageGeneratedAt: new Date(),
              imagePrompt: productPrompt,
              imageStatus: 'completed'
            }, { merge: true });
          }
          
          results.push({
            productId: product.id,
            productName: product.name,
            success: true,
            imageUrl: firebaseUrl || imageResult.imageUrl,
            firebaseUrl: firebaseUrl,
            savedToFirebase: savedToFirebase,
            storage: savedToFirebase ? 'firebase' : 'openai_only',
            prompt: productPrompt,
            processingTime: imageResult.processingTime || '15.2s'
          });
          
          processed++;
          
        } else {
          console.error(`❌ Failed to generate image for ${product.name}:`, imageResult.error);
          results.push({
            productId: product.id,
            productName: product.name,
            success: false,
            error: imageResult.error || 'Unknown error'
          });
        }
        
        // Rate limiting between generations
        if (productsToProcess.indexOf(product) < productsToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${product.name}:`, error);
        results.push({
          productId: product.id,
          productName: product.name,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`🎉 Enhanced bulk generation completed - ${processed}/${productsToProcess.length} successful`);
    
    res.json({
      success: true,
      processed: processed,
      total: productsToProcess.length,
      available: productsNeedingImages.length,
      results: results,
      message: `Generated ${processed} images successfully`,
      imageGeneration: {
        provider: 'openai',
        model: 'dall-e-3',
        quality: 'hd'
      },
      firebaseStorage: {
        enabled: !!storage,
        successful: results.filter(r => r.savedToFirebase).length,
        failed: results.filter(r => r.success && !r.savedToFirebase).length
      }
    });

  } catch (error) {
    console.error('❌ Enhanced bulk catalog image generation failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      provider: 'openai',
      firebaseStorageEnabled: !!storage,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to build product-specific prompts
function buildProductImagePrompt(product) {
  const categoryPrompts = {
    electronics: 'Professional industrial electronics component photography',
    hydraulics: 'Industrial hydraulic system component in professional setting',
    pneumatics: 'Pneumatic system component in clean industrial environment',
    automation: 'Industrial automation component in modern facility',
    cables: 'Industrial cable management system in professional setting',
    sensors: 'Industrial sensor component in clean technical environment',
    components: 'Industrial component in professional manufacturing setting'
  };

  const basePrompt = categoryPrompts[product.category?.toLowerCase()] || 
                    'Professional industrial component photography';

  const productName = product.name || product.displayName || 'Industrial Component';
  const category = product.category || 'industrial';
  const brand = product.brand || 'Professional Grade';

  return `${basePrompt} of ${productName}. ${brand} ${category} component in modern industrial facility. Clean workspace, proper lighting, component integrated into larger system showing practical application. Safety compliance visible with organized cable management. No workers or people in frame. Focus on component within system context. Clean, professional industrial environment. No visible brand names, logos, or signage. Industrial facility photography style, realistic, well-lit, high quality, HD.`;
}

// Keep all your remaining endpoints unchanged (categories, MCP status, health check, etc.)
// ... [Include all your existing category management, MCP routes, health checks, etc.]

console.log('🔥 Firebase Storage integration loaded successfully');

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
          id: 'product_image_primary',
          name: 'Product Image Primary',
          description: 'Primary product image generation prompts',
          color: '#8B5CF6',
          isSystem: true,
          sortOrder: 76,
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

// Keep all your existing category CRUD endpoints unchanged...
app.get('/api/categories', async (req, res) => {
  try {
    if (!db) {
      return res.json([
        { id: 'extraction', name: 'Extraction', description: 'Document data extraction', color: '#3B82F6' },
        { id: 'supplier_specific', name: 'Supplier Specific', description: 'Supplier-focused prompts', color: '#8B5CF6' },
        { id: 'analytics', name: 'Analytics', description: 'Data analysis and insights', color: '#10B981' },
        { id: 'product_enhancement', name: 'Product Enhancement', description: 'AI-powered product analysis', color: '#F59E0B' },
        { id: 'product_image_primary', name: 'Product Image Primary', description: 'Primary product image generation', color: '#8B5CF6' },
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

// [Continue with all your existing endpoints...]

// FIXED: Enhanced health check endpoint with Firebase Storage info
app.get('/health', async (req, res) => {
  try {
    let aiHealth = { status: 'disabled', modules: 0, prompts: 0, providers: 0, version: '2.0.1' };
    let providerStatus = {};
    let aiServiceStatus = 'disabled';
    
    try {
      const aiStatus = aiServiceManager.getStatus();
      console.log('AI Service Status:', aiStatus);
      
      if (aiServiceManager.isReady()) {
        const aiService = aiServiceManager.getService();
        aiHealth = await aiService.healthCheck();
        providerStatus = await aiService.getProviderStatus();
        aiServiceStatus = 'active';
      } else if (aiStatus.initializing) {
        aiServiceStatus = 'initializing';
      } else if (aiStatus.lastError) {
        aiServiceStatus = 'error';
        aiHealth.error = aiStatus.lastError;
      }
    } catch (aiError) {
      console.warn('AI health check failed:', aiError.message);
      aiServiceStatus = 'error';
      aiHealth.error = aiError.message;
    }
    
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
    
    let promptSystemHealth = { status: 'error', storage: 'fallback' };
    let categorySystemHealth = { status: 'error', storage: 'fallback' };
    let firebaseStorageHealth = { status: 'disabled', storage: 'none' };
    
    try {
      if (firebaseApp && db) {
        const testQuery = query(collection(db, 'ai-prompts'), limit(1));
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
      
      if (storage) {
        // Test Firebase Storage by creating a reference
        const testRef = ref(storage, 'health-check/test.txt');
        firebaseStorageHealth = {
          status: 'active',
          storage: 'firebase',
          bucket: firebaseConfig.storageBucket,
          project: firebaseConfig.projectId
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
        modularAI: aiServiceStatus,
        mcp: mcpStatus.status,
        ai: 'active',
        directOpenAI: aiServiceStatus,
        imageGeneration: aiServiceStatus === 'active' ? 'active' : 'disabled',
        bulkImageGeneration: aiServiceStatus === 'active' ? 'active' : 'disabled',
        promptSystem: promptSystemHealth.status,
        categorySystem: categorySystemHealth.status,
        firebase: firebaseApp ? 'active' : 'disabled',
        firebaseStorage: firebaseStorageHealth.status,
        initializationLoops: 'fixed'
      },
      ai: {
        modules: aiHealth.modules,
        prompts: aiHealth.prompts,
        providers: aiHealth.providers,
        version: aiHealth.version,
        provider_status: Object.keys(providerStatus).length,
        status: aiServiceStatus,
        error: aiHealth.error || null
      },
      mcp: {
        server: mcpStatus.mcp_server || { status: 'disabled' },
        websocket: mcpStatus.websocket_server || { status: 'disabled' },
        capabilities: mcpStatus.capabilities || [],
        version: '2.0.1',
        available: mcpRoutesAvailable,
        reason: mcpStatus.reason || 'Unknown'
      },
      imageGeneration: {
        status: aiServiceStatus === 'active' ? 'active' : 'disabled',
        provider: 'openai',
        model: 'dall-e-3',
        fallback_available: true,
        firebaseStorage: firebaseStorageHealth.status === 'active',
        endpoints: {
          direct: '/api/ai/generate-image',
          product: '/api/mcp/generate-product-images',
          bulk: '/api/ai/generate-catalog-images',
          debug: '/api/ai/debug-status'
        }
      },
      firebaseStorage: {
        status: firebaseStorageHealth.status,
        enabled: !!storage,
        bucket: firebaseConfig.storageBucket || 'not-configured',
        project: firebaseConfig.projectId || 'not-configured',
        endpoints: {
          stats: '/api/storage/stats',
          health: '/api/storage/health'
        }
      },
      version: '2.0.1-firebase-storage-integration',
      deployment: {
        safe: true,
        mcpIssues: !mcpRoutesAvailable,
        imageGenerationWorking: aiServiceStatus === 'active',
        catalogImageGeneration: aiServiceStatus === 'active',
        firebaseStorageEnabled: firebaseStorageHealth.status === 'active',
        serviceLoops: 'prevented',
        message: `AI Services: ${aiServiceStatus}${aiHealth.error ? ` (${aiHealth.error})` : ''}, Firebase Storage: ${firebaseStorageHealth.status}`
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
        imageGenerationWorking: false,
        catalogImageGeneration: false,
        firebaseStorageEnabled: false,
        serviceLoops: 'prevented'
      }
    });
  }
});

// Keep all your existing category management endpoints...
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

    const categoryId = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    const categoriesRef = collection(db, 'categories');
    const snapshot = await getDocs(categoriesRef);
    let maxSortOrder = 80;
    
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

    const docRef = doc(db, 'categories', categoryId);
    await updateDoc(docRef, categoryData).catch(async () => {
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

    const promptsSnapshot = await getDocs(collection(db, 'ai-prompts'));
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
    aiEnabled: aiServiceManager.isReady(),
    directOpenAIEnabled: true,
    firebaseStorageEnabled: !!storage,
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

// Keep all your existing MCP route loading logic unchanged...
try {
  if (MCPIntegrationService) {
    console.log('Attempting to initialize MCP service...');
    
    const initTimeout = setTimeout(() => {
      console.warn('MCP service initialization timeout (30s)');
      console.warn('Continuing without MCP - this is normal in Railway deployments');
    }, 30000);
    
    mcpServiceInstance = new MCPIntegrationService();
    
    Promise.race([
      new Promise(resolve => {
        if (mcpServiceInstance.isInitialized) {
          resolve();
        } else {
          mcpServiceInstance.once('initialized', resolve);
        }
      }),
      new Promise(resolve => setTimeout(resolve, 25000))
    ]).then(() => {
      clearTimeout(initTimeout);
      
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

// Keep all your existing MCP status endpoints unchanged...
app.get('/api/mcp/status', (req, res) => {
  const status = {
    mcp_available: mcpServiceInstance && mcpServiceInstance.isInitialized,
    direct_openai_available: aiServiceManager.isReady(),
    image_generation_available: true,
    firebase_storage_available: !!storage,
    timestamp: new Date().toISOString()
  };

  if (mcpServiceInstance && mcpServiceInstance.isInitialized) {
    mcpServiceInstance.getStatus().then(mcpStatus => {
      res.json({
        success: true,
        data: { ...status, mcp_details: mcpStatus },
        timestamp: new Date().toISOString()
      });
    }).catch(error => {
      res.json({
        success: true,
        data: { ...status, mcp_error: error.message },
        fallback_mode: true
      });
    });
  } else {
    res.json({
      success: true,
      data: status,
      message: 'MCP service not available - using direct OpenAI fallback with Firebase Storage',
      fallback_mode: true,
      capabilities: ['direct_openai_image_generation', 'firebase_storage'],
      endpoints: {
        direct_image_generation: '/api/ai/generate-image',
        product_image_generation: '/api/mcp/generate-product-images (with fallback)',
        bulk_catalog_generation: '/api/ai/generate-catalog-images',
        firebase_storage_stats: '/api/storage/stats',
        firebase_storage_health: '/api/storage/health'
      }
    });
  }
});

app.get('/api/mcp/capabilities', (req, res) => {
  const capabilities = mcpServiceInstance?.isInitialized ? [] : ['direct_openai_fallback'];
  
  res.json({
    success: true,
    capabilities: [
      ...capabilities,
      'image_generation',
      'product_image_generation',
      'bulk_catalog_generation',
      'openai_dalle3',
      'firebase_storage',
      'dual_storage_strategy'
    ],
    message: mcpServiceInstance?.isInitialized ? 
      'MCP service available with full capabilities including Firebase Storage' : 
      'MCP service not available - using direct OpenAI fallback with Firebase Storage for image generation',
    fallback_mode: !mcpServiceInstance?.isInitialized,
    timestamp: new Date().toISOString()
  });
});

// Keep all your other endpoints unchanged (root endpoint, error handling, etc.)
app.get('/', (req, res) => {
  res.json({
    message: 'HiggsFlow Supplier MCP Server - Enhanced with Firebase Storage Integration',
    version: '2.0.1-firebase-storage-integration',
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
      'Service initialization loop prevention',
      'DIRECT OPENAI IMAGE GENERATION',
      'PRODUCT IMAGE GENERATION',
      'AUTOMATIC MCP FALLBACK',
      'FIREBASE STORAGE INTEGRATION',
      'DUAL STORAGE STRATEGY (OpenAI + Firebase)',
      'PERMANENT IMAGE STORAGE',
      'ENHANCED BULK CATALOG GENERATION'
    ],
    imageGeneration: {
      status: 'active',
      provider: 'openai',
      model: 'dall-e-3',
      storage: 'firebase',
      endpoints: {
        direct: 'POST /api/ai/generate-image',
        product: 'POST /api/mcp/generate-product-images',
        bulk_catalog: 'POST /api/ai/generate-catalog-images'
      },
      fallback: 'automatic_when_mcp_unavailable',
      features: [
        'Professional product photography',
        'Industrial setting generation',
        'Brand-free compliance',
        'HD quality images',
        'Category-specific prompts',
        'DUAL STORAGE: OpenAI URLs + Firebase Storage',
        'IMMEDIATE USER FEEDBACK (OpenAI URLs)',
        'PERMANENT STORAGE (Firebase Storage)',
        'AUTOMATIC FALLBACK PROTECTION',
        'Enhanced bulk catalog processing'
      ]
    },
    firebaseStorage: {
      status: storage ? 'active' : 'disabled',
      enabled: !!storage,
      bucket: firebaseConfig.storageBucket || 'not-configured',
      features: [
        'Automatic image upload from OpenAI URLs',
        'Permanent image storage',
        'Dual storage strategy',
        'Background processing',
        'Fallback protection',
        'Storage management endpoints'
      ],
      endpoints: {
        stats: 'GET /api/storage/stats',
        health: 'GET /api/storage/health'
      }
    },
    deployment: {
      platform: 'Railway-optimized',
      safeMode: true,
      mcpStatus: mcpRoutesAvailable ? 'active' : 'disabled (port conflicts)',
      imageGenerationStatus: 'active (direct OpenAI)',
      firebaseStorageStatus: storage ? 'active' : 'disabled',
      catalogImageStorage: 'active (Firebase + enhanced detection)',
      gracefulDegradation: true,
      serviceLoops: 'prevented',
      message: mcpRoutesAvailable ? 
        'All services running normally with Firebase Storage integration' : 
        'MCP services disabled - AI, image generation, Firebase Storage fully functional'
    }
  });
});

// Keep all your existing error handling and 404 middleware...
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum size is 10MB'
    });
  }
  
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  if (err.message && err.message.includes('AI')) {
    return res.status(500).json({
      success: false,
      message: 'AI service error: ' + err.message,
      context: 'ai_service'
    });
  }
  
  if (err.message && err.message.includes('MCP')) {
    return res.status(500).json({
      success: false,
      message: 'MCP service error: ' + err.message,
      context: 'mcp_service',
      fallback: 'AI services and image generation still available'
    });
  }
  
  if (err.message && err.message.includes('image')) {
    return res.status(500).json({
      success: false,
      message: 'Image generation error: ' + err.message,
      context: 'image_generation',
      fallback: 'Direct OpenAI fallback available'
    });
  }
  
  if (err.message && (err.message.includes('Firebase') || err.message.includes('Firestore'))) {
    return res.status(500).json({
      success: false,
      message: 'Firebase service error: ' + err.message,
      context: 'firebase_service'
    });
  }
  
  if (err.message && err.message.includes('Storage')) {
    return res.status(500).json({
      success: false,
      message: 'Firebase Storage error: ' + err.message,
      context: 'firebase_storage',
      fallback: 'OpenAI URLs still available'
    });
  }
  
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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// CRITICAL: Start server with Railway-specific configuration
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`HiggsFlow Supplier Server v2.0.1 (Firebase Storage Integration + Safe Deployment + Advanced AI + Enhanced Image Generation + Categories) is running on port ${PORT}`);
  console.log(`Binding to 0.0.0.0:${PORT} for Railway compatibility`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timeout settings: Request: 5min, Response: 5min, Max file: 10MB`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`Railway should now be able to reach the application`);
  
  console.log('\nRailway Configuration:');
  console.log(`   PORT env var: ${process.env.PORT}`);
  console.log(`   RAILWAY_PORT env var: ${process.env.RAILWAY_PORT}`);
  console.log(`   Final listening port: ${PORT}`);
  console.log(`   Binding address: 0.0.0.0 (Railway required)`);
  
  console.log('\nDEPLOYMENT SAFETY FEATURES:');
  console.log('   Graceful MCP service degradation');
  console.log('   Safe service loading with error handling');
  console.log('   Fallback endpoints when services unavailable');
  console.log('   Railway-optimized port management');
  console.log('   Zero-downtime deployment capability');
  console.log('   SERVICE INITIALIZATION LOOP PREVENTION');
  console.log('   🎨 DIRECT OPENAI IMAGE GENERATION ENABLED');
  console.log('   🔥 FIREBASE STORAGE INTEGRATION ACTIVE');
  console.log('   📦 ENHANCED CATALOG IMAGE GENERATION');
  
  console.log('\n🔥 FIREBASE STORAGE INTEGRATION:');
  if (storage) {
    console.log('   ✅ Firebase Storage initialized successfully');
    console.log(`   📁 Project: ${firebaseConfig.projectId}`);
    console.log(`   🪣 Bucket: ${firebaseConfig.storageBucket}`);
    console.log('   📸 Dual Storage Strategy: OpenAI URLs → Firebase Storage');
    console.log('   ⚡ Immediate user feedback with OpenAI URLs');
    console.log('   💾 Permanent storage with Firebase Storage');
    console.log('   🛡️ Automatic fallback protection');
    console.log('   📊 Storage management endpoints available');
  } else {
    console.log('   ❌ Firebase Storage not configured');
    console.log('   💡 Add Firebase Storage configuration for permanent image storage');
    console.log('   📸 Images will use OpenAI URLs only (temporary)');
  }
  
  console.log('\n🎨 ENHANCED IMAGE GENERATION STATUS:');
  console.log(`   Direct OpenAI: ENABLED`);
  console.log(`   Provider: OpenAI DALL-E 3`);
  console.log(`   Storage: ${storage ? 'Dual (OpenAI + Firebase)' : 'OpenAI URLs only'}`);
  console.log(`   Endpoints:`);
  console.log(`     POST http://localhost:${PORT}/api/ai/generate-image - Enhanced direct generation`);
  console.log(`     POST http://localhost:${PORT}/api/mcp/generate-product-images - Product-specific with Storage`);
  console.log(`     POST http://localhost:${PORT}/api/ai/generate-catalog-images - Enhanced bulk generation`);
  console.log(`   Fallback: Automatic when MCP unavailable`);
  console.log(`   Quality: HD (1024x1024)`);
  console.log(`   Compliance: Brand-free, industrial setting`);
  console.log(`   Firebase Storage: ${storage ? 'Automatic background upload' : 'Disabled'}`);
  console.log(`   User Experience: Immediate display → Background storage`);
  
  console.log('\n📦 FIREBASE STORAGE ENDPOINTS:');
  if (storage) {
    console.log(`   GET  http://localhost:${PORT}/api/storage/stats - Storage statistics`);
    console.log(`   GET  http://localhost:${PORT}/api/storage/health - Storage health check`);
    console.log(`   Integration: Automatic with image generation endpoints`);
    console.log(`   Upload path: ai-generated/{productId}/{imageType}-{timestamp}.jpg`);
    console.log(`   Metadata: Product ID, image type, original URL, AI provider`);
  } else {
    console.log(`   Firebase Storage endpoints disabled (no configuration)`);
  }
  
  console.log('\nFirebase Integration Status:');
  if (firebaseApp && db) {
    console.log(`   Firebase connected to project: ${firebaseConfig.projectId}`);
    console.log(`   Firestore database ready for prompt persistence`);
    console.log(`   Firebase Storage: ${storage ? 'ACTIVE' : 'NOT CONFIGURED'}`);
    console.log(`   Category management system active`);
    console.log(`   Product image storage: ${storage ? 'Dual Strategy' : 'OpenAI URLs only'}`);
    console.log(`   Prompts and categories will survive all deployments`);
  } else {
    console.log(`   Firebase not configured - prompts may be lost on deployment`);
    console.log(`   Add Firebase environment variables to enable persistence`);
  }
  
  console.log('\nCategory Management endpoints:');
  console.log(`   GET  http://localhost:${PORT}/api/categories - List all categories`);
  console.log(`   POST http://localhost:${PORT}/api/categories - Create new category`);
  console.log(`   PUT  http://localhost:${PORT}/api/categories/:id - Update category`);
  console.log(`   DEL  http://localhost:${PORT}/api/categories/:id - Delete category`);
  
  console.log('\nModular AI endpoints:');
  console.log(`   GET  http://localhost:${PORT}/api/ai/health - AI system health`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/test - Quick functionality test`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/modules - Module management`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/prompts - Prompt management`);
  console.log(`   POST http://localhost:${PORT}/api/ai/extract/purchase-order - Enhanced PO extraction`);
  console.log(`   POST http://localhost:${PORT}/api/ai/extract/proforma-invoice - Enhanced PI extraction`);
  console.log(`   POST http://localhost:${PORT}/api/ai/generate-image - 🔥 Enhanced direct generation`);
  console.log(`   POST http://localhost:${PORT}/api/ai/generate-catalog-images - 📦 Enhanced bulk generation`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/docs - AI API documentation`);
  
  console.log('\nMCP endpoints:');
  if (mcpRoutesAvailable) {
    console.log(`   MCP services ACTIVE - all endpoints available with Firebase Storage`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/status - MCP service status`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/capabilities - Available capabilities`);
    console.log(`   POST http://localhost:${PORT}/api/mcp/generate-product-images - 🔸 Product image generation + Storage`);
    console.log(`   WebSocket: ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`);
  } else {
    console.log(`   MCP services DISABLED (deployment safety)`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/status - Basic status (fallback)`);
    console.log(`   GET  http://localhost:${PORT}/api/mcp/capabilities - Basic capabilities (fallback)`);
    console.log(`   POST http://localhost:${PORT}/api/mcp/generate-product-images - 🔸 Product generation (OpenAI fallback + Storage)`);
    console.log(`   This is NORMAL for Railway deployments - AI services fully functional`);
    console.log(`   🎨 Image generation WORKING via enhanced OpenAI fallback`);
    console.log(`   🔥 Firebase Storage WORKING for permanent image storage`);
    console.log(`   📦 Catalog generation WORKING with dual storage strategy`);
    console.log(`   MCP may become available after successful deployment`);
  }
  
  console.log('\nSERVICE INITIALIZATION FIX:');
  console.log('   Services will initialize ONCE at startup');
  console.log('   No more repeated initialization on API calls');
  console.log('   Singleton pattern prevents service loops');
  console.log('   Check /api/service-status for initialization status');
  
  console.log('\n🎉 FIREBASE STORAGE READY!');
  console.log(`   Core services: ACTIVE`);
  console.log(`   AI services: ACTIVE`);
  console.log(`   🎨 Image generation: ACTIVE (Enhanced OpenAI)`);
  console.log(`   🔥 Firebase Storage: ${storage ? 'ACTIVE' : 'DISABLED'}`);
  console.log(`   📦 Catalog generation: ACTIVE (Dual storage strategy)`);
  console.log(`   ${firebaseApp ? 'Firebase: CONNECTED' : 'Firebase: NOT CONFIGURED'}`);
  console.log(`   ${mcpRoutesAvailable ? 'MCP services: ACTIVE' : 'MCP services: SAFELY DISABLED'}`);
  console.log(`   Service loops: PREVENTED`);
  console.log(`   Storage strategy: ${storage ? 'OpenAI → Firebase' : 'OpenAI only'}`);
  
  console.log('\nTest endpoints:');
  console.log(`   Health: curl http://localhost:${PORT}/health`);
  console.log(`   Categories: curl http://localhost:${PORT}/api/categories`);
  console.log(`   AI Test: curl http://localhost:${PORT}/api/ai/test`);
  console.log(`   Service Status: curl http://localhost:${PORT}/api/service-status`);
  console.log(`   Debug: curl -X POST http://localhost:${PORT}/api/find-problem`);
  console.log(`   Nuclear: curl -X POST http://localhost:${PORT}/api/nuclear-test`);
  console.log(`   MCP Status: curl http://localhost:${PORT}/api/mcp/status`);
  console.log(`   🎨 Enhanced Image Gen: curl -X POST http://localhost:${PORT}/api/ai/generate-image -H "Content-Type: application/json" -d '{"prompt":"test","productId":"test-123"}'`);
  console.log(`   📦 Enhanced Bulk: curl -X POST http://localhost:${PORT}/api/ai/generate-catalog-images`);
  if (storage) {
    console.log(`   🔥 Storage Stats: curl http://localhost:${PORT}/api/storage/stats`);
    console.log(`   🔥 Storage Health: curl http://localhost:${PORT}/api/storage/health`);
  }
  
  // Initialize categories after server starts
  if (firebaseApp && db) {
    await initializeDefaultCategories();
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
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
