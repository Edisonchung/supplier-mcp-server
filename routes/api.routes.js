// routes/api.routes.js
const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const multer = require('multer');

// Controllers
const extractionController = require('../controllers/extraction.controller');
const duplicateController = require('../controllers/duplicate.controller');
const recommendationController = require('../controllers/recommendation.controller');
const WebSearchService = require('../services/webSearchService');

// ✅ NEW: Import category management
const { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  serverTimestamp,
  writeBatch
} = require('firebase/firestore');
const { db } = require('../firebase'); // Your existing Firebase config

/// Enhanced health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Enhanced MCP Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: ['pdf', 'image', 'excel', 'email', 'multi-ai', 'validation', 'recommendations', 'ptp-detection', 'web-search', 'category-management', 'product-enhancement'],
    capabilities: {
      maxFileSize: '10MB',
      timeouts: {
        request: '5 minutes',
        response: '5 minutes',
        pdfParsing: '1 minute',
        aiExtraction: '2 minutes',
        webSearch: '15 seconds'
      },
      aiProviders: {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        google: !!process.env.GOOGLE_AI_API_KEY,
        deepseek: !!process.env.DEEPSEEK_API_KEY
      },
      webSearch: {
        serpapi: !!process.env.SERPAPI_KEY,
        puppeteer: true,
        directScraping: true,
        fallbackSearch: true
      },
      supplierTemplates: ['PTP', 'GENERIC'],
      categoryManagement: true,
      productEnhancement: true
    }
  });
});

// Extraction endpoints
router.post('/extract-po', upload.single('pdf'), extractionController.extractFromPDF);
router.post('/extract-image', upload.single('image'), extractionController.extractFromImage);
router.post('/extract-excel', upload.single('excel'), extractionController.extractFromExcel);
router.post('/extract-email', upload.single('email'), extractionController.extractFromEmail);

// Get current prompt system status for a user
router.get('/prompt-system-status', extractionController.getPromptSystemStatus);

// Set user's prompt system preference  
router.post('/set-prompt-system-preference', extractionController.setPromptSystemPreference);

// Get prompt system analytics and performance data
router.get('/prompt-system-analytics', extractionController.getPromptSystemAnalytics);

// Test extraction with specific system (single file)
router.post('/test-extraction', upload.single('pdf'), extractionController.testExtraction);

// Batch comparison test (multiple files)
router.post('/batch-comparison-test', upload.array('files', 10), extractionController.batchComparisonTest);

// Duplicate and recommendations
router.post('/check-duplicate', duplicateController.checkDuplicate);
router.post('/get-recommendations', recommendationController.getRecommendations);

// Learning and categorization
router.post('/save-correction', recommendationController.saveCorrection);
router.post('/detect-category', recommendationController.detectCategory);

// Bank payment extraction
router.post('/bank-payments/extract', upload.single('file'), extractionController.extractBankPaymentSlip);

// ================================================================
// ✅ NEW: CATEGORY MANAGEMENT ENDPOINTS
// ================================================================

// Helper function to generate category ID from name
const generateCategoryId = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
};

// Get all categories
router.get('/categories', async (req, res) => {
  try {
    console.log('📁 Loading categories from Firestore...');
    
    const categoriesRef = collection(db, 'categories');
    const q = query(
      categoriesRef, 
      where('isActive', '==', true),
      orderBy('sortOrder', 'asc'),
      orderBy('name', 'asc')
    );
    
    const snapshot = await getDocs(q);
    const categories = [];
    
    for (const docSnap of snapshot.docs) {
      const categoryData = { id: docSnap.id, ...docSnap.data() };
      
      // Count prompts in this category
      try {
        const promptsRef = collection(db, 'prompts');
        const promptQuery = query(promptsRef, where('category', '==', docSnap.id));
        const promptSnapshot = await getDocs(promptQuery);
        categoryData.promptCount = promptSnapshot.size;
      } catch (error) {
        console.warn(`Failed to count prompts for category ${docSnap.id}:`, error);
        categoryData.promptCount = 0;
      }
      
      // Convert Firestore timestamps to ISO strings
      if (categoryData.createdAt && categoryData.createdAt.toDate) {
        categoryData.createdAt = categoryData.createdAt.toDate().toISOString();
      }
      if (categoryData.updatedAt && categoryData.updatedAt.toDate) {
        categoryData.updatedAt = categoryData.updatedAt.toDate().toISOString();
      }
      if (categoryData.lastUsed && categoryData.lastUsed.toDate) {
        categoryData.lastUsed = categoryData.lastUsed.toDate().toISOString();
      }
      
      categories.push(categoryData);
    }
    
    console.log(`✅ Loaded ${categories.length} categories from Firestore`);
    res.json(categories);
    
  } catch (error) {
    console.error('❌ Failed to load categories from Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to load categories',
      details: error.message 
    });
  }
});

// Create new category
router.post('/categories', async (req, res) => {
  try {
    const { name, description, color, icon, userEmail } = req.body;
    
    console.log('📁 Creating category in Firestore:', name);
    
    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    
    // Generate ID and check for duplicates
    const categoryId = generateCategoryId(name.trim());
    const categoryDocRef = doc(db, 'categories', categoryId);
    const existingDoc = await getDoc(categoryDocRef);
    
    if (existingDoc.exists()) {
      return res.status(400).json({ 
        error: 'Category with this name already exists',
        suggestion: `Try "${name} 2" or "${name} Custom"`
      });
    }
    
    // Get next sort order
    const categoriesRef = collection(db, 'categories');
    const sortQuery = query(categoriesRef, orderBy('sortOrder', 'desc'));
    const sortSnapshot = await getDocs(sortQuery);
    const lastCategory = sortSnapshot.docs[0];
    const sortOrder = lastCategory ? (lastCategory.data().sortOrder || 0) + 10 : 10;
    
    const categoryData = {
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#8B5CF6', // Default purple
      icon: icon || 'folder',
      sortOrder,
      isSystem: false,
      isActive: true,
      createdBy: userEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      promptCount: 0,
      lastUsed: serverTimestamp()
    };
    
    await updateDoc(categoryDocRef, categoryData);
    
    console.log(`✅ Created category in Firestore: ${name} (${categoryId})`);
    
    // Return the created category with the ID
    const createdCategory = {
      id: categoryId,
      ...categoryData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
    
    res.status(201).json({
      success: true,
      category: createdCategory,
      message: `Category "${name}" created successfully`
    });
    
  } catch (error) {
    console.error('❌ Failed to create category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to create category',
      details: error.message 
    });
  }
});

// Update category
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon, userEmail } = req.body;
    
    console.log('📁 Updating category in Firestore:', id);
    
    const categoryDocRef = doc(db, 'categories', id);
    const categoryDoc = await getDoc(categoryDocRef);
    
    if (!categoryDoc.exists()) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const categoryData = categoryDoc.data();
    
    // Prevent editing system categories' core properties
    if (categoryData.isSystem && name && name !== categoryData.name) {
      return res.status(403).json({ 
        error: 'Cannot rename system categories',
        allowedChanges: ['description', 'color', 'icon']
      });
    }
    
    const updates = {
      updatedAt: serverTimestamp()
    };
    
    // Simple update without ID change
    if (name && name.trim() !== categoryData.name && !categoryData.isSystem) {
      updates.name = name.trim();
    }
    if (description !== undefined) updates.description = description.trim();
    if (color) updates.color = color;
    if (icon) updates.icon = icon;
    
    await updateDoc(categoryDocRef, updates);
    
    console.log(`✅ Updated category in Firestore: ${categoryData.name}`);
    
    const updatedCategory = {
      id,
      ...categoryData,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      category: updatedCategory,
      message: `Category "${categoryData.name}" updated successfully`
    });
    
  } catch (error) {
    console.error('❌ Failed to update category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to update category',
      details: error.message 
    });
  }
});

// Delete category (soft delete)
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, movePromptsTo } = req.body;
    
    console.log('📁 Deleting category in Firestore:', id);
    
    const categoryDocRef = doc(db, 'categories', id);
    const categoryDoc = await getDoc(categoryDocRef);
    
    if (!categoryDoc.exists()) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const categoryData = categoryDoc.data();
    
    // Prevent deletion of system categories
    if (categoryData.isSystem) {
      return res.status(403).json({ 
        error: 'Cannot delete system categories',
        systemCategories: ['purchase_order', 'proforma_invoice', 'bank_payment', 'extraction']
      });
    }
    
    // Check for existing prompts
    const promptsRef = collection(db, 'prompts');
    const promptQuery = query(promptsRef, where('category', '==', id));
    const promptSnapshot = await getDocs(promptQuery);
    const promptCount = promptSnapshot.size;
    
    if (promptCount > 0 && !movePromptsTo) {
      return res.status(400).json({ 
        error: `Cannot delete category with ${promptCount} prompts`,
        promptCount,
        suggestion: 'Move prompts to another category first'
      });
    }
    
    // Soft delete (mark as inactive)
    await updateDoc(categoryDocRef, {
      isActive: false,
      deletedAt: serverTimestamp(),
      deletedBy: userEmail,
      updatedAt: serverTimestamp()
    });
    
    console.log(`✅ Deleted category in Firestore: ${categoryData.name}`);
    
    res.json({
      success: true,
      message: `Category "${categoryData.name}" deleted successfully`
    });
    
  } catch (error) {
    console.error('❌ Failed to delete category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to delete category',
      details: error.message 
    });
  }
});

// ================================================================
// ✅ NEW: PRODUCT ENHANCEMENT ENDPOINT
// ================================================================

router.post('/enhance-product', async (req, res) => {
  try {
    const { productData, userEmail, metadata } = req.body;
    
    console.log('🚀 MCP Product Enhancement Request:', {
      partNumber: productData.partNumber,
      userEmail: userEmail,
      timestamp: new Date().toISOString()
    });
    
    // ✅ Find product enhancement prompts from Firestore
    const promptsRef = collection(db, 'prompts');
    const promptQuery = query(
      promptsRef,
      where('category', '==', 'product_enhancement'),
      where('isActive', '!=', false),
      orderBy('isActive'),
      orderBy('name')
    );
    
    const promptSnapshot = await getDocs(promptQuery);
    let selectedPrompt = null;
    
    // Find best prompt for this user
    for (const promptDoc of promptSnapshot.docs) {
      const prompt = promptDoc.data();
      
      // Check if user is targeted
      if (prompt.targetUsers) {
        if (prompt.targetUsers.includes('all') || 
            prompt.targetUsers.includes(userEmail)) {
          selectedPrompt = { id: promptDoc.id, ...prompt };
          break;
        }
      }
    }
    
    if (!selectedPrompt) {
      console.warn('❌ No product enhancement prompt available');
      return res.status(400).json({
        success: false,
        error: 'No product enhancement prompt available',
        suggestion: 'Create a product enhancement prompt first',
        metadata: {
          processing_time: '0ms',
          prompt_used: 'none',
          extraction_method: 'no_prompt_found',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    console.log(`🎯 Selected prompt: ${selectedPrompt.name}`);
    
    // ✅ Build enhancement prompt with variable replacement
    const enhancementPrompt = selectedPrompt.prompt
      .replace(/\{\{partNumber\}\}/g, productData.partNumber || 'Not specified')
      .replace(/\{\{productName\}\}/g, productData.name || 'Not specified')
      .replace(/\{\{brand\}\}/g, productData.brand || 'Unknown')
      .replace(/\{\{description\}\}/g, productData.description || 'Not specified')
      .replace(/\{\{category\}\}/g, productData.category || 'Not specified');
    
    // ✅ Use your existing AI service (adapt this to your actual AI service)
    const startTime = Date.now();
    
    // Simple AI response simulation - replace with your actual AI service call
    const aiResponse = await callAIService(enhancementPrompt, {
      provider: selectedPrompt.aiProvider || 'deepseek',
      temperature: selectedPrompt.temperature || 0.1,
      max_tokens: selectedPrompt.maxTokens || 2000
    });
    
    const processingTime = Date.now() - startTime;
    
    // ✅ Parse AI response
    let extractedData;
    try {
      const cleanResponse = aiResponse
        .replace(/```json\s*\n?/g, '')
        .replace(/```\s*\n?/g, '')
        .trim();
      
      extractedData = JSON.parse(cleanResponse);
      
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      
      // Fallback result for parsing errors
      extractedData = {
        detected_brand: productData.partNumber?.match(/^(6[A-Z]{2}|3[A-Z]{2})/i) ? 'Siemens' : null,
        brand_confidence: 0.6,
        detected_category: 'components',
        category_confidence: 0.5,
        enhanced_name: `Industrial Component ${productData.partNumber}`,
        enhanced_description: `Industrial component with part number ${productData.partNumber}`,
        specifications: {},
        confidence_analysis: 'Fallback analysis due to parsing error'
      };
    }
    
    // ✅ Calculate confidence score
    const confidenceScore = Math.min(
      ((extractedData.brand_confidence || 0.5) + 
       (extractedData.category_confidence || 0.5)) / 2, 
      0.95
    );
    
    // ✅ Update prompt usage statistics in Firestore
    try {
      const promptDocRef = doc(db, 'prompts', selectedPrompt.id);
      await updateDoc(promptDocRef, {
        usageCount: (selectedPrompt.usageCount || 0) + 1,
        lastUsed: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (updateError) {
      console.warn('Failed to update prompt usage:', updateError);
    }
    
    // ✅ Response in your standard MCP format
    const response = {
      success: true,
      extractedData: extractedData,
      metadata: {
        processing_time: `${processingTime}ms`,
        prompt_used: selectedPrompt.name,
        prompt_id: selectedPrompt.id,
        ai_provider: selectedPrompt.aiProvider,
        mcp_version: '3.1',
        extraction_method: 'mcp_product_enhancement',
        user_email: userEmail,
        timestamp: new Date().toISOString()
      },
      confidence_score: confidenceScore
    };
    
    console.log('✅ MCP Product Enhancement Complete:', {
      partNumber: productData.partNumber,
      brand: extractedData.detected_brand,
      confidence: confidenceScore,
      processingTime: `${processingTime}ms`
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ MCP Product Enhancement Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      metadata: {
        processing_time: '0ms',
        prompt_used: 'none',
        extraction_method: 'error',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ✅ Placeholder AI service function - replace with your actual implementation
async function callAIService(prompt, options) {
  // This is a placeholder - replace with your actual AI service call
  // For testing, return a mock response for Siemens parts
  if (prompt.includes('6XV1830-3EH10')) {
    return JSON.stringify({
      detected_brand: "Siemens",
      brand_confidence: 0.95,
      detected_category: "networking",
      category_confidence: 0.90,
      enhanced_name: "Siemens Industrial Ethernet Cable 6XV1830-3EH10",
      enhanced_description: "Industrial Ethernet cable, 4-wire configuration with M12 connector. Designed for industrial automation networks with high reliability and performance.",
      specifications: {
        connector_type: "RJ45/M12",
        cable_length: "Standard",
        ethernet_standard: "100BASE-TX",
        temperature_range: "-40°C to +80°C",
        material: "Industrial Grade"
      },
      alternative_part_numbers: [],
      datasheet_url: "https://support.industry.siemens.com/products/datasheet/6xv18303eh10.pdf",
      manufacturer_url: "https://new.abb.com/products/6XV1830-3EH10",
      product_family: "Industrial Ethernet",
      recommended_applications: ["Industrial Automation", "Factory Networks"],
      confidence_analysis: "High confidence based on Siemens part number pattern recognition",
      enhancement_quality_score: 90,
      recommended_actions: ["Verify connector compatibility", "Check cable length requirements"]
    });
  }
  
  // Default response for unknown parts
  return JSON.stringify({
    detected_brand: null,
    brand_confidence: 0.3,
    detected_category: "components",
    category_confidence: 0.5,
    enhanced_name: `Industrial Component ${prompt.match(/Part Number: ([^\n]+)/)?.[1] || 'Unknown'}`,
    enhanced_description: "Industrial component - brand and specifications could not be determined",
    specifications: {},
    confidence_analysis: "Low confidence - unknown part number pattern"
  });
}

// ================================================================
// ENHANCED WEB SEARCH ENDPOINTS (EXISTING)
// ================================================================

// Main web search endpoint for product enhancement
router.post('/web-search', async (req, res) => {
  try {
    const { queries, type, partNumber, brand, description } = req.body;
    
    console.log('🔍 Web search request received:', { 
      partNumber, 
      brand, 
      type,
      queries: queries?.length || 0,
      timestamp: new Date().toISOString(),
      userAgent: req.get('User-Agent')
    });
    
    const webSearchService = new WebSearchService();
    
    // Use the provided part number or extract from queries
    const searchPartNumber = partNumber || (queries && queries[0] && queries[0].replace(/['"]/g, ''));
    
    if (!searchPartNumber) {
      console.warn('❌ Web search: No part number provided');
      return res.status(400).json({
        found: false,
        error: 'Part number is required for web search',
        source: 'web_search_endpoint',
        timestamp: new Date().toISOString(),
        help: 'Include "partNumber" in request body or provide it in "queries" array'
      });
    }
    
    // Validate part number format
    if (searchPartNumber.length < 3) {
      return res.status(400).json({
        found: false,
        error: 'Part number must be at least 3 characters long',
        source: 'web_search_validation',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`🔍 Searching for part: "${searchPartNumber}" (Brand: ${brand || 'Unknown'})`);
    
    const startTime = Date.now();
    const searchResult = await webSearchService.searchProductInfo(
      searchPartNumber,
      brand,
      description
    );
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Web search completed in ${processingTime}ms: ${searchResult.found ? 'Success' : 'No results'}`);
    
    // Add endpoint metadata
    searchResult.endpoint = 'web-search';
    searchResult.timestamp = new Date().toISOString();
    searchResult.processingTime = `${processingTime}ms`;
    searchResult.version = '2.0.0';
    searchResult.searchMethods = [
      'SerpAPI Google Search',
      'Direct Manufacturer Scraping', 
      'Puppeteer Browser Automation',
      'DuckDuckGo Fallback'
    ];
    
    // Add performance metrics
    if (searchResult.found) {
      searchResult.performance = {
        searchTime: processingTime,
        confidenceLevel: searchResult.confidence >= 0.8 ? 'high' : searchResult.confidence >= 0.6 ? 'medium' : 'low',
        dataQuality: searchResult.specifications && Object.keys(searchResult.specifications).length > 2 ? 'detailed' : 'basic'
      };
    }
    
    res.json(searchResult);
    
  } catch (error) {
    console.error('❌ Web search endpoint error:', error);
    res.status(500).json({
      found: false,
      error: error.message,
      source: 'web_search_endpoint_error',
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint specifically for web search functionality
router.get('/web-search/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'web-search',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    capabilities: [
      'SerpAPI Google Search (requires API key)',
      'Direct manufacturer website scraping',
      'Puppeteer browser automation',
      'DuckDuckGo fallback search',
      'Product specification extraction',
      'Datasheet URL discovery',
      'Multi-source result aggregation'
    ],
    supported_manufacturers: [
      'Siemens',
      'SKF', 
      'ABB',
      'Schneider Electric',
      'Omron',
      'Festo',
      'Parker',
      'Bosch'
    ],
    environment: {
      node_version: process.version,
      puppeteer_available: true,
      cheerio_available: true,
      serpapi_configured: !!process.env.SERPAPI_KEY,
      axios_available: true
    },
    performance: {
      typical_response_time: '2-8 seconds',
      timeout: '15 seconds',
      retry_attempts: '4 methods',
      cache_duration: 'none (real-time)'
    }
  });
});

// Test endpoint for web search functionality with predefined test cases
router.post('/web-search/test', async (req, res) => {
  try {
    console.log('🧪 Running web search test suite...');
    
    const testPartNumbers = [
      { partNumber: '6ES7407-0KA02-0AA0', brand: 'Siemens', expected: 'automation', description: 'Siemens PLC module' },
      { partNumber: '32222', brand: 'SKF', expected: 'bearings', description: 'SKF bearing component' },
      { partNumber: 'ACS880-01-144A-3', brand: 'ABB', expected: 'drives', description: 'ABB variable frequency drive' },
      { partNumber: 'NJ2314ECP', brand: 'SKF', expected: 'bearings', description: 'SKF cylindrical roller bearing' },
      { partNumber: 'UNKNOWN-TEST-123', brand: '', expected: 'none', description: 'Non-existent part for testing' }
    ];
    
    const webSearchService = new WebSearchService();
    const results = [];
    const startTime = Date.now();
    
    for (const [index, test] of testPartNumbers.entries()) {
      try {
        console.log(`🧪 Testing ${index + 1}/${testPartNumbers.length}: ${test.partNumber}`);
        
        const testStart = Date.now();
        const result = await webSearchService.searchProductInfo(test.partNumber, test.brand, test.description);
        const testDuration = Date.now() - testStart;
        
        results.push({
          test_id: index + 1,
          partNumber: test.partNumber,
          brand: test.brand,
          expected: test.expected,
          found: result.found,
          confidence: result.confidence,
          source: result.source,
          duration: `${testDuration}ms`,
          success: result.found || test.expected === 'none'
        });
        
        console.log(`✅ Test ${index + 1} completed: ${result.found ? 'Found' : 'Not found'} in ${testDuration}ms`);
        
      } catch (error) {
        console.error(`❌ Test ${index + 1} failed:`, error.message);
        results.push({
          test_id: index + 1,
          partNumber: test.partNumber,
          brand: test.brand,
          expected: test.expected,
          found: false,
          error: error.message,
          success: test.expected === 'none'
        });
      }
    }
    
    const totalDuration = Date.now() - startTime;
    const successfulTests = results.filter(r => r.success).length;
    
    console.log(`🎉 Test suite completed: ${successfulTests}/${testPartNumbers.length} successful in ${totalDuration}ms`);
    
    res.json({
      test_suite: 'web-search-functionality',
      test_results: results,
      timestamp: new Date().toISOString(),
      summary: {
        total_tests: testPartNumbers.length,
        successful: successfulTests,
        failed: testPartNumbers.length - successfulTests,
        success_rate: `${Math.round((successfulTests / testPartNumbers.length) * 100)}%`,
        total_duration: `${totalDuration}ms`,
        average_duration: `${Math.round(totalDuration / testPartNumbers.length)}ms`
      },
      environment: {
        serpapi_configured: !!process.env.SERPAPI_KEY,
        puppeteer_available: true,
        node_version: process.version
      }
    });
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    res.status(500).json({
      error: 'Test endpoint failed',
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Bulk web search endpoint for multiple part numbers
router.post('/web-search/bulk', async (req, res) => {
  try {
    const { partNumbers, defaultBrand } = req.body;
    
    if (!partNumbers || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({
        error: 'partNumbers array is required',
        timestamp: new Date().toISOString()
      });
    }
    
    if (partNumbers.length > 10) {
      return res.status(400).json({
        error: 'Maximum 10 part numbers allowed per bulk request',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`🔍 Bulk web search for ${partNumbers.length} part numbers`);
    
    const webSearchService = new WebSearchService();
    const results = [];
    const startTime = Date.now();
    
    for (const [index, item] of partNumbers.entries()) {
      try {
        const partNumber = typeof item === 'string' ? item : item.partNumber;
        const brand = typeof item === 'object' ? item.brand : defaultBrand;
        
        console.log(`🔍 Bulk search ${index + 1}/${partNumbers.length}: ${partNumber}`);
        
        const result = await webSearchService.searchProductInfo(partNumber, brand);
        results.push({
          partNumber,
          brand,
          ...result
        });
        
        // Small delay to avoid overwhelming servers
        if (index < partNumbers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`❌ Bulk search failed for item ${index + 1}:`, error.message);
        results.push({
          partNumber: typeof item === 'string' ? item : item.partNumber,
          brand: typeof item === 'object' ? item.brand : defaultBrand,
          found: false,
          error: error.message
        });
      }
    }
    
    const totalDuration = Date.now() - startTime;
    const successfulSearches = results.filter(r => r.found).length;
    
    console.log(`✅ Bulk search completed: ${successfulSearches}/${partNumbers.length} found in ${totalDuration}ms`);
    
    res.json({
      bulk_search_results: results,
      timestamp: new Date().toISOString(),
      summary: {
        total_searches: partNumbers.length,
        successful: successfulSearches,
        failed: partNumbers.length - successfulSearches,
        success_rate: `${Math.round((successfulSearches / partNumbers.length) * 100)}%`,
        total_duration: `${totalDuration}ms`,
        average_duration: `${Math.round(totalDuration / partNumbers.length)}ms`
      }
    });
    
  } catch (error) {
    console.error('❌ Bulk search endpoint error:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================================================
// ✅ NEW: INITIALIZE DEFAULT CATEGORIES FUNCTION
// ================================================================

const initializeDefaultCategories = async () => {
  try {
    console.log('📁 Initializing default categories in Firestore...');
    
    const defaultCategories = [
      {
        id: 'purchase_order',
        name: 'Purchase Order',
        description: 'Purchase order processing and extraction prompts',
        color: '#3B82F6',
        icon: 'shopping-cart',
        isSystem: true,
        sortOrder: 10
      },
      {
        id: 'proforma_invoice',
        name: 'Proforma Invoice',
        description: 'Proforma invoice processing and analysis prompts',
        color: '#059669',
        icon: 'file-text',
        isSystem: true,
        sortOrder: 20
      },
      {
        id: 'bank_payment',
        name: 'Bank Payment',
        description: 'Bank payment slip processing prompts',
        color: '#DC2626',
        icon: 'credit-card',
        isSystem: true,
        sortOrder: 30
      },
      {
        id: 'extraction',
        name: 'Extraction',
        description: 'General data extraction prompts',
        color: '#7C2D12',
        icon: 'download',
        isSystem: true,
        sortOrder: 40
      },
      {
        id: 'supplier_specific',
        name: 'Supplier Specific',
        description: 'Supplier-specific processing prompts',
        color: '#7C3AED',
        icon: 'users',
        isSystem: true,
        sortOrder: 50
      },
      {
        id: 'analytics',
        name: 'Analytics',
        description: 'Business analytics and reporting prompts',
        color: '#059669',
        icon: 'bar-chart-3',
        isSystem: true,
        sortOrder: 60
      },
      {
        id: 'classification',
        name: 'Classification',
        description: 'Document classification and categorization prompts',
        color: '#EA580C',
        icon: 'tag',
        isSystem: true,
        sortOrder: 70
      },
      {
        id: 'general',
        name: 'General',
        description: 'General purpose prompts',
        color: '#6B7280',
        icon: 'folder',
        isSystem: true,
        sortOrder: 80
      }
    ];
    
    const batch = writeBatch(db);
    
    for (const categoryData of defaultCategories) {
      const categoryDocRef = doc(db, 'categories', categoryData.id);
      const existingDoc = await getDoc(categoryDocRef);
      
      if (!existingDoc.exists()) {
        const firestoreData = {
          ...categoryData,
          isActive: true,
          createdBy: 'system@higgsflow.com',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          promptCount: 0,
          lastUsed: serverTimestamp()
        };
        
        batch.set(categoryDocRef, firestoreData);
        console.log(`✅ Will create default category: ${categoryData.name}`);
      }
    }
    
    await batch.commit();
    console.log('✅ Default categories initialized in Firestore');
    
  } catch (error) {
    console.error('❌ Failed to initialize default categories in Firestore:', error);
  }
};

module.exports = { router, initializeDefaultCategories };
