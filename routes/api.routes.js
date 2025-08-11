// routes/api.routes.js - FIXED: Real AI Service Integration with ALL Original Code Preserved
const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const multer = require('multer');

// Controllers
const extractionController = require('../controllers/extraction.controller');
const duplicateController = require('../controllers/duplicate.controller');
const recommendationController = require('../controllers/recommendation.controller');
const WebSearchService = require('../services/webSearchService');

// ✅ PRESERVED: Import the correct AI services
let MCPPromptService, UnifiedAIService, AIService;

// Try to load MCP Prompt Service
try {
  MCPPromptService = require('../services/MCPPromptService');
  console.log('✅ MCPPromptService loaded successfully');
} catch (error) {
  console.warn('⚠️ MCPPromptService not found:', error.message);
}

// ✅ CRITICAL: Load UnifiedAIService (this is what we need for REAL AI processing)
try {
  UnifiedAIService = require('../services/ai/UnifiedAIService');
  console.log('✅ UnifiedAIService loaded successfully - REAL AI CALLS ENABLED');
} catch (error) {
  console.warn('⚠️ UnifiedAIService not found:', error.message);
}

// Try to load legacy AIService as fallback
try {
  AIService = require('../services/ai/AIService');
  console.log('✅ Legacy AIService loaded as fallback');
} catch (error) {
  console.warn('⚠️ Legacy AIService not found');
}

// ✅ CRITICAL: Initialize the AI Service globally for REAL AI processing
let globalAIService = null;

// Initialize AI Service on startup
(async () => {
  try {
    console.log('🚀 Initializing HiggsFlow AI Service for REAL AI enhancement...');
    
    if (UnifiedAIService) {
      globalAIService = new UnifiedAIService();
      await globalAIService.initPromise; // Wait for initialization
      console.log('✅ HiggsFlow AI Service ready for REAL AI enhancement!');
    } else {
      console.warn('⚠️ UnifiedAIService not available, using pattern-based fallback only');
    }
  } catch (error) {
    console.error('❌ Failed to initialize AI Service:', error);
    console.log('⚠️ System will use pattern-based fallback only');
  }
})();

// ✅ PRESERVED: Helper function to get prompts directly from AI system
async function getPromptsDirectly() {
  try {
    // Method 1: Use the global AI service
    if (globalAIService) {
      console.log('🎯 Using UnifiedAIService to get prompts...');
      const prompts = await globalAIService.getPrompts();
      return Array.isArray(prompts) ? prompts : [];
    }
    
    // Method 2: Hard-coded fallback with your known prompts
    console.log('🎯 Using hard-coded prompt data...');
    return [
      {
        id: 'product-enhancement-brand-detection',
        name: 'Product Enhancement - Brand Detection & Analysis',
        category: 'product_enhancement',
        isActive: true,
        targetUsers: ['all'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Multi-manufacturer analysis and brand detection',
        usage_count: 45,
        prompt: `You are an expert industrial product analyst specializing in manufacturer identification and product specifications.

EXPERTISE AREAS:
- Industrial automation components (Siemens, ABB, Schneider Electric)
- Bearings and mechanical components (SKF, FAG, Timken)
- Electrical components (Omron, Phoenix Contact, Weidmuller)

TASK: Analyze this industrial product and provide structured enhancement data.

PRODUCT INFORMATION:
- Part Number: {{partNumber}}
- Current Name: {{productName}}
- Current Brand: {{brand}}
- Current Description: {{description}}
- Current Category: {{category}}

OUTPUT ONLY VALID JSON:
{
  "detected_brand": "manufacturer name or null",
  "brand_confidence": 0.95,
  "detected_category": "specific category",
  "category_confidence": 0.90,
  "enhanced_name": "professional product name",
  "enhanced_description": "detailed technical description",
  "specifications": {
    "voltage": "value",
    "current": "value",
    "temperature_range": "value",
    "material": "value",
    "certifications": "value"
  },
  "enhancement_quality_score": 85,
  "confidence_analysis": "detailed explanation of detection confidence"
}`
      },
      {
        id: 'product-enhancement-siemens-specialist',
        name: 'Product Enhancement - Siemens Industrial Specialist',
        category: 'product_enhancement',
        isActive: true,
        targetUsers: ['all'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Specialized analysis for Siemens industrial components',
        usage_count: 23,
        prompt: `You are a Siemens industrial automation specialist with deep expertise in Siemens product lines.

SIEMENS EXPERTISE:
- SIMATIC automation systems (6ES series)
- Industrial communication (6XV series - your specialty)
- Safety technology (3SE series)

SPECIAL FOCUS FOR 6XV SERIES (Industrial Ethernet):
- Cable type and specifications
- Connector types and configurations
- Length and performance characteristics

TASK: Analyze this Siemens product and provide detailed enhancement data.

PRODUCT DATA:
- Part Number: {{partNumber}}
- Current Information: {{productName}} | {{description}}

OUTPUT ONLY VALID JSON:
{
  "is_siemens_product": true,
  "product_family": "Industrial Ethernet",
  "series_code": "6XV",
  "detected_brand": "Siemens",
  "brand_confidence": 0.95,
  "detected_category": "networking",
  "category_confidence": 0.90,
  "enhanced_name": "exact Siemens product name",
  "enhanced_description": "detailed Siemens specification",
  "specifications": {
    "connector_type": "RJ45/M12",
    "cable_length": "Standard",
    "ethernet_standard": "100BASE-TX",
    "protection_rating": "IP67"
  },
  "enhancement_quality_score": 95,
  "confidence_analysis": "High confidence based on Siemens 6XV pattern recognition"
}`
      }
    ];
    
  } catch (error) {
    console.error('❌ Failed to get prompts:', error);
    return [];
  }
}

// ✅ PRESERVED: Helper function to determine prompt specialization
function getPromptSpecialization(name, description) {
  const lowerName = name.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  
  if (lowerName.includes('siemens')) {
    return 'Siemens Industrial Components (6XV, 6ES, 3SE series)';
  } else if (lowerName.includes('skf')) {
    return 'SKF Bearings and Mechanical Components';
  } else if (lowerName.includes('abb')) {
    return 'ABB Drives and Automation Equipment';
  } else if (lowerName.includes('schneider')) {
    return 'Schneider Electric Components';
  } else if (lowerName.includes('brand detection')) {
    return 'Multi-manufacturer analysis and brand detection';
  } else if (lowerDesc.includes('general') || lowerDesc.includes('universal')) {
    return 'General industrial components analysis';
  } else {
    return 'Industrial component enhancement';
  }
}

// ✅ PRESERVED: Helper function to calculate prompt confidence
function calculatePromptConfidence(prompt) {
  // Base confidence based on prompt type
  let confidence = 0.85; // Base confidence
  
  const name = prompt.name.toLowerCase();
  
  // Specialized prompts typically have higher confidence
  if (name.includes('specialist') || name.includes('siemens') || name.includes('skf')) {
    confidence = 0.95;
  } else if (name.includes('brand detection') || name.includes('analysis')) {
    confidence = 0.88;
  }
  
  // Adjust based on usage count (more usage = higher confidence)
  const usageCount = prompt.usage_count || 0;
  if (usageCount > 50) confidence = Math.min(confidence + 0.05, 0.98);
  else if (usageCount > 20) confidence = Math.min(confidence + 0.02, 0.95);
  
  return confidence;
}

// ✅ PRESERVED: Helper function to get recommended use cases
function getRecommendedFor(name) {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('siemens')) {
    return ['6XV', '6ES', '3SE', 'siemens'];
  } else if (lowerName.includes('skf')) {
    return ['NJ', 'NU', 'bearings', 'mechanical'];
  } else if (lowerName.includes('abb')) {
    return ['ACS', 'drives', 'automation'];
  } else if (lowerName.includes('brand detection')) {
    return ['unknown', 'multi-brand', 'general'];
  } else {
    return ['general', 'components'];
  }
}

// ✅ CRITICAL FIX: NEW function to call AI with proper error handling (REAL AI CALLS)
async function callAIForEnhancement(prompt, promptData, selectedPrompt) {
  if (!globalAIService) {
    throw new Error('AI Service not available');
  }

  // Replace template variables in prompt
  let processedPrompt = prompt;
  Object.keys(promptData).forEach(key => {
    const placeholder = `{{${key}}}`;
    processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), promptData[key]);
  });

  // Call the AI service with REAL API calls
  console.log(`🤖 Calling ${selectedPrompt.aiProvider} for product enhancement...`);
  
  // ✅ CRITICAL FIX: Make actual AI API call instead of mock response
  const aiResult = await globalAIService.enhanceProduct(promptData, processedPrompt, {
    aiProvider: selectedPrompt.aiProvider || 'deepseek',
    temperature: selectedPrompt.temperature || 0.1,
    maxTokens: selectedPrompt.maxTokens || 2500
  });

  return aiResult.result || aiResult; // Return the actual AI response
}

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
      productEnhancement: true,
      mcpPromptSystem: !!MCPPromptService,
      unifiedAI: !!globalAIService, // ✅ PRESERVED: Indicate UnifiedAI availability
      realAIProductEnhancement: !!globalAIService // ✅ NEW: Real AI status
    }
  });
});

// ✅ PRESERVED: All extraction endpoints
router.post('/extract-po', upload.single('pdf'), extractionController.extractFromPDF);
router.post('/extract-image', upload.single('image'), extractionController.extractFromImage);
router.post('/extract-excel', upload.single('excel'), extractionController.extractFromExcel);
router.post('/extract-email', upload.single('email'), extractionController.extractFromEmail);

// ✅ PRESERVED: Get current prompt system status for a user
router.get('/prompt-system-status', extractionController.getPromptSystemStatus);

// ✅ PRESERVED: Set user's prompt system preference  
router.post('/set-prompt-system-preference', extractionController.setPromptSystemPreference);

// ✅ PRESERVED: Get prompt system analytics and performance data
router.get('/prompt-system-analytics', extractionController.getPromptSystemAnalytics);

// ✅ PRESERVED: Test extraction with specific system (single file)
router.post('/test-extraction', upload.single('pdf'), extractionController.testExtraction);

// ✅ PRESERVED: Batch comparison test (multiple files)
router.post('/batch-comparison-test', upload.array('files', 10), extractionController.batchComparisonTest);

// ✅ PRESERVED: Duplicate and recommendations
router.post('/check-duplicate', duplicateController.checkDuplicate);
router.post('/get-recommendations', recommendationController.getRecommendations);

// ✅ PRESERVED: Learning and categorization
router.post('/save-correction', recommendationController.saveCorrection);
router.post('/detect-category', recommendationController.detectCategory);

// ✅ PRESERVED: Bank payment extraction
router.post('/bank-payments/extract', upload.single('file'), extractionController.extractBankPaymentSlip);

// ================================================================
// ✅ CRITICAL FIX: PRODUCT ENHANCEMENT ENDPOINT WITH REAL AI CALLS (REPLACING STATIC RESPONSE)
// ================================================================

router.post('/enhance-product', async (req, res) => {
  try {
    const { productData, userEmail, metadata, forcedPromptId } = req.body; // ✅ PRESERVED: Support forced prompt
    
    console.log('🚀 MCP Product Enhancement Request:', {
      partNumber: productData.partNumber,
      userEmail: userEmail,
      forcedPromptId: forcedPromptId, // ✅ PRESERVED: Log forced prompt
      timestamp: new Date().toISOString()
    });
    
    let selectedPrompt = null;
    
    try {
      console.log('🎯 Getting prompts directly...');
      const allPrompts = await getPromptsDirectly();
      
      if (allPrompts && allPrompts.length > 0) {
        const productPrompts = allPrompts.filter(p => 
          p.category === 'product_enhancement' && 
          p.isActive !== false
        );
        
        if (productPrompts && productPrompts.length > 0) {
          console.log(`📝 Found ${productPrompts.length} product enhancement prompts`);
          
          // ✅ PRESERVED: Support forced prompt selection
          if (forcedPromptId) {
            selectedPrompt = productPrompts.find(p => p.id === forcedPromptId);
            if (selectedPrompt) {
              console.log(`🎯 Using forced prompt: ${selectedPrompt.name}`);
            } else {
              console.warn(`⚠️ Forced prompt ${forcedPromptId} not found, falling back to smart selection`);
            }
          }
          
          // ✅ PRESERVED: Smart prompt selection for Siemens parts (if no forced prompt)
          if (!selectedPrompt && productData.partNumber && productData.partNumber.match(/^(6XV|6ES|3SE)/i)) {
            selectedPrompt = productPrompts.find(p => 
              p.name.toLowerCase().includes('siemens')
            );
            console.log('🎯 Looking for Siemens specialist prompt for Siemens part');
          }
          
          // If no specialized prompt found, use user-specific or general prompt
          if (!selectedPrompt) {
            selectedPrompt = productPrompts.find(p => 
              p.targetUsers && 
              (p.targetUsers.includes('all') || p.targetUsers.includes(userEmail))
            );
          }
          
          // Fallback to first available prompt
          if (!selectedPrompt && productPrompts.length > 0) {
            selectedPrompt = productPrompts[0];
          }
          
          if (selectedPrompt) {
            console.log(`🎯 Selected prompt: ${selectedPrompt.name}`);
            
            // ✅ CRITICAL FIX: Check if globalAIService is available and make REAL AI calls
            if (globalAIService) {
              console.log('✅ AI Service available, proceeding with REAL AI enhancement...');
              
              try {
                // Prepare the prompt template data
                const promptData = {
                  partNumber: productData.partNumber || '',
                  productName: productData.name || '',
                  brand: productData.brand || '',
                  description: productData.description || '',
                  category: productData.category || ''
                };
                
                const startTime = Date.now();
                
                // ✅ CRITICAL FIX: Call REAL AI using the proper service
                const aiResponse = await callAIForEnhancement(
                  selectedPrompt.prompt,
                  promptData,
                  selectedPrompt
                );
                
                const processingTime = Date.now() - startTime;
                console.log(`✅ REAL AI response received in ${processingTime}ms`); // ✅ FIXED: Real timing
                
                // ✅ PRESERVED: Parse AI response
                let extractedData;
                try {
                  const cleanResponse = typeof aiResponse === 'string' ? 
                    aiResponse.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim() : 
                    JSON.stringify(aiResponse);
                  
                  extractedData = typeof aiResponse === 'string' ? JSON.parse(cleanResponse) : aiResponse;
                  console.log('✅ AI response parsed successfully');
                  
                } catch (parseError) {
                  console.error('❌ Failed to parse AI response:', parseError);
                  console.log('Raw AI response:', JSON.stringify(aiResponse).substring(0, 500));
                  throw parseError;
                }
                
                // ✅ PRESERVED: Calculate confidence score
                const confidenceScore = Math.min(
                  ((extractedData.brand_confidence || 0.5) + 
                   (extractedData.category_confidence || 0.5) + 
                   (extractedData.enhancement_quality_score || 50) / 100) / 3, 
                  0.95
                );
                
                // ✅ CRITICAL FIX: Return REAL AI-enhanced response with actual timing
                const response = {
                  success: true,
                  extractedData: extractedData,
                  metadata: {
                    processing_time: `${processingTime}ms`, // ✅ FIXED: Real processing time
                    prompt_used: selectedPrompt.name,
                    prompt_id: selectedPrompt.id, // ✅ PRESERVED: Include prompt ID
                    ai_provider: selectedPrompt.aiProvider,
                    mcp_version: '3.1',
                    extraction_method: 'real_ai_enhancement', // ✅ FIXED: Real method
                    user_email: userEmail,
                    timestamp: new Date().toISOString(),
                    enhancement_type: 'ai_analysis',
                    original_part_number: productData.partNumber,
                    forced_prompt: !!forcedPromptId, // ✅ PRESERVED: Track if prompt was forced
                    realAPICall: true // ✅ NEW: Confirmation of real API call
                  },
                  confidence_score: confidenceScore, // ✅ FIXED: Real confidence from AI
                  
                  performance: {
                    searchTime: processingTime, // ✅ FIXED: Real processing time
                    confidenceLevel: confidenceScore >= 0.8 ? 'high' : confidenceScore >= 0.6 ? 'medium' : 'low',
                    dataQuality: extractedData.specifications && Object.keys(extractedData.specifications).length > 2 ? 'detailed' : 'basic',
                    enhancementScore: extractedData.enhancement_quality_score || 0
                  }
                };
                
                console.log('✅ REAL AI Product Enhancement Complete:', {
                  partNumber: productData.partNumber,
                  brand: extractedData.detected_brand,
                  confidence: confidenceScore,
                  processingTime: `${processingTime}ms`, // ✅ FIXED: Real timing
                  prompt: selectedPrompt.name,
                  forced: !!forcedPromptId // ✅ PRESERVED: Log if prompt was forced
                });
                
                return res.json(response);
                
              } catch (aiError) {
                console.error('❌ AI Enhancement Error:', aiError);
                console.log('🔄 Falling back to pattern enhancement...');
              }
            } else {
              console.warn('⚠️ AI Service not available, falling back to pattern enhancement');
            }
          }
        }
      }
      
      console.log('⚠️ No suitable prompts found, falling back to pattern enhancement');
      
    } catch (promptError) {
      console.error('❌ Direct prompt system failed:', promptError.message);
      console.log('🔄 Falling back to pattern enhancement');
    }
    
    // ✅ PRESERVED: Fallback to enhanced pattern-based enhancement
    console.log('🔄 Using enhanced pattern-based enhancement...');
    const enhancedData = await enhanceProductDataFallback(productData);
    
    const response = {
      success: true,
      extractedData: enhancedData,
      metadata: {
        processing_time: '1500ms',
        prompt_used: 'Pattern Analysis Fallback',
        extraction_method: 'pattern_enhancement_fallback',
        user_email: userEmail,
        timestamp: new Date().toISOString(),
        enhancement_type: 'pattern_analysis',
        fallback_reason: 'AI service unavailable or prompts not found',
        forced_prompt: false
      },
      confidence_score: enhancedData.confidence || 0.8
    };
    
    console.log('✅ Pattern Enhancement Complete:', {
      partNumber: productData.partNumber,
      brand: enhancedData.detected_brand,
      confidence: response.confidence_score
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Product Enhancement Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      metadata: {
        processing_time: '0ms',
        prompt_used: 'none',
        ai_provider: 'none',
        extraction_method: 'error',
        timestamp: new Date().toISOString(),
        error_type: error.name,
        forced_prompt: false
      }
    });
  }
});

// ✅ PRESERVED: Product Enhancement Status Endpoint with Prompt Selector Support
router.get('/product-enhancement-status', async (req, res) => {
  try {
    const { userEmail } = req.query;
    
    console.log('🔍 Product Enhancement Status Check:', { 
      userEmail, 
      timestamp: new Date().toISOString() 
    });
    
    let promptInfo = null;
    let systemStatus = 'pattern_fallback';
    let availablePrompts = 0;
    let availablePromptsList = []; // ✅ PRESERVED: Array for prompt selector
    
    try {
      const allPrompts = await getPromptsDirectly();
      
      if (allPrompts && allPrompts.length > 0) {
        console.log(`📝 Found ${allPrompts.length} total prompts directly`);
        
        // Filter for product enhancement prompts
        const productPrompts = allPrompts.filter(p => 
          p.category === 'product_enhancement' && 
          p.isActive !== false
        );
        
        if (productPrompts && productPrompts.length > 0) {
          availablePrompts = productPrompts.length;
          console.log(`📝 Found ${productPrompts.length} product enhancement prompts`);
          
          // ✅ PRESERVED: Build available prompts list with metadata
          availablePromptsList = productPrompts.map(prompt => ({
            id: prompt.id,
            name: prompt.name,
            aiProvider: prompt.aiProvider || 'deepseek',
            specialized_for: getPromptSpecialization(prompt.name, prompt.description),
            confidence_avg: calculatePromptConfidence(prompt),
            usage_count: prompt.usage_count || 0,
            recommended_for: getRecommendedFor(prompt.name),
            description: prompt.description || '',
            targetUsers: prompt.targetUsers || [],
            isActive: prompt.isActive !== false
          }));
          
          // Find user-specific prompt
          let userPrompt = productPrompts.find(p => 
            p.targetUsers && 
            (p.targetUsers.includes('all') || p.targetUsers.includes(userEmail))
          );
          
          if (!userPrompt && productPrompts.length > 0) {
            userPrompt = productPrompts[0];
          }
          
          if (userPrompt) {
            promptInfo = {
              name: userPrompt.name,
              ai_provider: userPrompt.aiProvider || 'deepseek',
              id: userPrompt.id,
              specialized_for: getPromptSpecialization(userPrompt.name, userPrompt.description)
            };
            systemStatus = globalAIService ? 'real_ai_enhanced' : 'mcp_enhanced'; // ✅ FIXED: Real AI status
            console.log(`🎯 Selected prompt: ${userPrompt.name}`);
          }
        }
      }
    } catch (promptError) {
      console.warn('⚠️ Direct prompt access failed:', promptError.message);
    }
    
    // ✅ PRESERVED: Always return a successful response with prompt list
    const response = {
      status: 'available',
      user_email: userEmail,
      current_system: systemStatus,
      selected_prompt: promptInfo,
      available_prompts: availablePrompts,
      available_prompts_list: availablePromptsList, // ✅ PRESERVED: Full prompt list for selector
      capabilities: [
        'brand_detection',
        'category_classification', 
        'specification_extraction',
        'description_enhancement',
        'datasheet_linking',
        'alternative_part_identification'
      ],
      supported_manufacturers: [
        'Siemens',
        'SKF',
        'ABB', 
        'Schneider Electric',
        'Omron',
        'Phoenix Contact',
        'Festo',
        'Bosch Rexroth'
      ],
      performance: {
        typical_response_time: systemStatus.includes('enhanced') ? '2-5 seconds' : '1-2 seconds',
        expected_accuracy: systemStatus.includes('enhanced') ? '95%+' : '70-85%',
        confidence_scoring: 'enabled',
        enhancement_method: systemStatus.includes('real_ai') ? 'Real AI-powered' : systemStatus.includes('enhanced') ? 'AI-powered' : 'Pattern-based' // ✅ FIXED
      },
      system_info: {
        prompt_service_available: true,
        unified_ai_service_available: !!globalAIService,
        ai_service_available: !!AIService,
        fallback_ready: true,
        version: '2.0',
        last_check: new Date().toISOString(),
        real_ai_available: !!globalAIService // ✅ NEW: Real AI availability
      }
    };
    
    console.log('✅ Status check complete:', {
      system: systemStatus,
      promptAvailable: !!promptInfo,
      userEmail,
      availablePrompts,
      promptsListLength: availablePromptsList.length,
      realAIServiceReady: !!globalAIService // ✅ FIXED: Real AI status
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Product Enhancement Status Error:', error);
    
    // ✅ PRESERVED: Even on error, return useful fallback status
    res.status(200).json({
      status: 'basic',
      user_email: req.query.userEmail,
      current_system: 'pattern_only',
      message: 'Using pattern-based enhancement',
      selected_prompt: null,
      available_prompts: 0,
      available_prompts_list: [], // ✅ PRESERVED: Empty array for fallback
      capabilities: ['basic_brand_detection', 'category_classification', 'pattern_analysis'],
      performance: {
        typical_response_time: '1-2 seconds',
        expected_accuracy: '70-85%',
        enhancement_method: 'Pattern-based'
      },
      error_info: {
        error_type: error.name,
        error_message: error.message,
        fallback_active: true,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ✅ PRESERVED: Enhanced health check endpoint for product enhancement system
router.get('/product-enhancement-health', async (req, res) => {
  try {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      services: {
        mcp_prompt_service: !!MCPPromptService ? 'available' : 'unavailable',
        unified_ai_service: !!globalAIService ? 'available' : 'unavailable',
        legacy_ai_service: !!AIService ? 'available' : 'unavailable',
        pattern_fallback: 'available'
      },
      endpoints: {
        enhance_product: '/api/enhance-product',
        status_check: '/api/product-enhancement-status', 
        health_check: '/api/product-enhancement-health'
      },
      version: '2.0.0',
      capabilities: {
        mcp_integration: !!MCPPromptService,
        real_ai_enhancement: !!globalAIService, // ✅ FIXED: Real AI capability
        unified_ai_enhancement: !!globalAIService,
        legacy_ai_enhancement: !!AIService,
        pattern_analysis: true,
        fallback_protection: true,
        prompt_selector: true // ✅ PRESERVED: Indicate prompt selector support
      }
    };
    
    // Test AI system if available
    if (globalAIService) {
      try {
        const prompts = await globalAIService.getPrompts();
        health.ai_test = {
          prompts_found: Array.isArray(prompts) ? prompts.length : 0,
          test_successful: true,
          service_type: 'real_ai' // ✅ FIXED
        };
      } catch (testError) {
        health.ai_test = {
          prompts_found: 0,
          test_successful: false,
          error: testError.message,
          service_type: 'real_ai' // ✅ FIXED
        };
      }
    }
    
    res.json(health);
  } catch (error) {
    res.status(200).json({
      status: 'degraded',
      error: error.message,
      timestamp: new Date().toISOString(),
      fallback_available: true
    });
  }
});

// ✅ NEW: Nuclear test endpoint to verify AI service is working
router.post('/nuclear-test', async (req, res) => {
  try {
    console.log('🚀 NUCLEAR TEST: Testing REAL AI API connection...');
    
    if (!globalAIService) {
      throw new Error('AI Service not initialized');
    }
    
    const startTime = Date.now();
    
    // Test with a simple product enhancement
    const testResult = await globalAIService.enhanceProduct(
      { 
        partNumber: '6XV1830-3EH10',
        name: 'Test Product',
        brand: 'Siemens',
        description: 'Test description',
        category: 'networking'
      },
      'Analyze this Siemens industrial product: {{partNumber}}. Provide detailed specifications.',
      {
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 500
      }
    );
    
    const testTime = Date.now() - startTime;
    
    console.log(`✅ NUCLEAR TEST PASSED: Real AI response in ${testTime}ms`);
    
    res.json({
      success: true,
      message: 'NUCLEAR TEST PASSED - REAL AI API WORKING',
      testTime: testTime + 'ms',
      aiService: 'UnifiedAIService',
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY ? 
        `${process.env.DEEPSEEK_API_KEY.substring(0, 8)}...${process.env.DEEPSEEK_API_KEY.slice(-4)}` : 
        'NOT CONFIGURED',
      result: testResult ? 'AI Response Received' : 'No Response',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ NUCLEAR TEST FAILED:', error);
    res.status(500).json({
      success: false,
      message: 'NUCLEAR TEST FAILED - AI API NOT WORKING',
      error: error.message,
      aiService: globalAIService ? 'Available' : 'Not Available',
      apiKey: process.env.DEEPSEEK_API_KEY ? 'Configured' : 'Not Configured',
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ NEW: Debug endpoint to find the exact source of 0ms responses
router.post('/find-problem', (req, res) => {
  console.log('🔍 Debug endpoint called - starting stack trace monitoring...');
  
  // Override console.log to catch the 0ms message and show stack trace
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    const message = args.join(' ');
    
    // Check for the exact 0ms message
    if (message.includes('✅ AI response received in 0ms')) {
      console.error('🚨🚨🚨 FOUND THE EXACT SOURCE OF 0ms! 🚨🚨🚨');
      console.error('🚨 Message:', message);
      console.error('🚨 STACK TRACE (showing exact file and line):');
      console.error(new Error('SOURCE LOCATION TRACE').stack);
      console.error('🚨🚨🚨 END SOURCE TRACE 🚨🚨🚨');
    }
    
    // Call original console.log
    originalConsoleLog.apply(console, args);
  };
  
  console.log('✅ Stack trace monitoring ENABLED');
  
  res.json({ 
    success: true,
    message: 'Debug stack trace monitoring enabled!',
    instructions: [
      '1. This endpoint is now monitoring all console.log calls',
      '2. Call /api/enhance-product with your test data',
      '3. Check Railway logs immediately for stack traces',
      '4. Look for "🚨🚨🚨 FOUND THE EXACT SOURCE OF 0ms!" messages'
    ]
  });
});

// ✅ PRESERVED: Keep your existing enhanced pattern fallback function (unchanged)
async function enhanceProductDataFallback(productData) {
  const partNumber = productData.partNumber || '';
  
  console.log(`🔍 Pattern analysis for part number: ${partNumber}`);
  
  // ✅ PRESERVED: Siemens Industrial Ethernet Cables (6XV series) - Your specific case
  if (partNumber.match(/^6XV/i)) {
    return {
      detected_brand: "Siemens",
      brand_confidence: 0.95,
      detected_category: "networking",
      category_confidence: 0.92,
      enhanced_name: `Siemens Industrial Ethernet Cable ${partNumber}`,
      enhanced_description: `Siemens industrial communication cable designed for industrial automation networks. Part number: ${partNumber}. Features high reliability, industrial-grade construction, and compliance with industrial Ethernet standards.`,
      specifications: {
        connector_type: "RJ45/M12",
        cable_type: "Industrial Ethernet",
        manufacturer: "Siemens",
        series: "Industrial Communication",
        ethernet_standard: "100BASE-TX",
        temperature_range: "-40°C to +80°C",
        protection_class: "IP67 (connectors)"
      },
      confidence: 0.92,
      enhancement_quality_score: 90,
      product_family: "Industrial Ethernet",
      recommended_applications: ["Industrial Automation", "Factory Networks", "PROFINET"],
      datasheet_url: `https://support.industry.siemens.com/cs/products/${partNumber}`,
      manufacturer_url: "https://new.siemens.com/global/en/products/automation/industrial-communication.html",
      confidence_analysis: "High confidence based on Siemens 6XV series pattern recognition for industrial Ethernet cables"
    };
  }
  
  // ✅ PRESERVED: Siemens SIMATIC Automation (6ES series)
  else if (partNumber.match(/^6ES/i)) {
    return {
      detected_brand: "Siemens",
      brand_confidence: 0.95,
      detected_category: "automation",
      category_confidence: 0.95,
      enhanced_name: `Siemens SIMATIC Automation Component ${partNumber}`,
      enhanced_description: `Siemens SIMATIC automation component for industrial control systems. Part number: ${partNumber}. Professional-grade automation equipment for manufacturing and process control.`,
      specifications: {
        manufacturer: "Siemens",
        series: "SIMATIC",
        category: "Automation",
        protection_class: "IP20/IP65",
        operating_temperature: "-25°C to +60°C",
        certification: "CE, UL, CSA"
      },
      confidence: 0.90,
      enhancement_quality_score: 88,
      product_family: "SIMATIC",
      recommended_applications: ["PLC Systems", "Industrial Control", "Process Automation"],
      confidence_analysis: "High confidence based on Siemens 6ES SIMATIC series pattern"
    };
  }
  
  // ✅ PRESERVED: Siemens Safety Technology (3SE series)
  else if (partNumber.match(/^3SE/i)) {
    return {
      detected_brand: "Siemens",
      brand_confidence: 0.93,
      detected_category: "safety",
      category_confidence: 0.90,
      enhanced_name: `Siemens Safety Technology Component ${partNumber}`,
      enhanced_description: `Siemens industrial safety component for machine and personnel protection. Part number: ${partNumber}. Designed for safety-critical applications in industrial environments.`,
      specifications: {
        manufacturer: "Siemens",
        series: "Safety Technology",
        safety_category: "Category 3/4",
        protection_class: "IP67",
        certification: "TÜV, CE, UL"
      },
      confidence: 0.88,
      enhancement_quality_score: 85,
      product_family: "Safety Technology",
      confidence_analysis: "High confidence based on Siemens 3SE safety series pattern"
    };
  }
  
  // ✅ PRESERVED: SKF Bearings with detailed pattern recognition
  else if (partNumber.match(/^(SKF|NJ|NU|NUP|6\d{3}|32\d{3})/i)) {
    const brand = partNumber.startsWith('SKF') ? 'SKF' : 'SKF';
    let bearingType = 'Industrial Bearing';
    
    // Detect bearing type from pattern
    if (partNumber.match(/^(NJ|NU|NUP)/i)) bearingType = 'Cylindrical Roller Bearing';
    else if (partNumber.match(/^6\d{3}/i)) bearingType = 'Deep Groove Ball Bearing';
    else if (partNumber.match(/^32\d{3}/i)) bearingType = 'Tapered Roller Bearing';
    
    return {
      detected_brand: brand,
      brand_confidence: 0.90,
      detected_category: "bearings",
      category_confidence: 0.88,
      enhanced_name: `${brand} ${bearingType} ${partNumber}`,
      enhanced_description: `${brand} precision ${bearingType.toLowerCase()} for industrial applications. Part number: ${partNumber}. High-quality bearing designed for reliability and long service life.`,
      specifications: {
        manufacturer: brand,
        category: "Bearings",
        type: bearingType,
        material: "Chrome Steel",
        precision: "Normal (P0)",
        lubrication: "Standard",
        temperature_range: "-40°C to +120°C"
      },
      confidence: 0.85,
      enhancement_quality_score: 82,
      product_family: "Industrial Bearings",
      recommended_applications: ["Industrial Machinery", "Motors", "Gearboxes"],
      confidence_analysis: `High confidence based on ${bearingType} pattern recognition`
    };
  }
  
  // ✅ PRESERVED: ABB Drives (ACS series)
  else if (partNumber.match(/^ACS\d{3}/i)) {
    return {
      detected_brand: "ABB",
      brand_confidence: 0.92,
      detected_category: "drives",
      category_confidence: 0.90,
      enhanced_name: `ABB Variable Frequency Drive ${partNumber}`,
      enhanced_description: `ABB variable frequency drive for motor control and energy efficiency. Part number: ${partNumber}. Advanced drive technology for industrial applications.`,
      specifications: {
        manufacturer: "ABB",
        category: "Variable Frequency Drives",
        efficiency: "IE3 Class",
        protection: "IP20/IP55",
        control_method: "DTC (Direct Torque Control)"
      },
      confidence: 0.87,
      enhancement_quality_score: 85,
      product_family: "ACS Drives",
      confidence_analysis: "High confidence based on ABB ACS drive series pattern"
    };
  }
  
  // ✅ PRESERVED: Schneider Electric (TM, LC1 series)
  else if (partNumber.match(/^(TM|LC1|XB\d)/i)) {
    return {
      detected_brand: "Schneider Electric",
      brand_confidence: 0.88,
      detected_category: "automation",
      category_confidence: 0.85,
      enhanced_name: `Schneider Electric Industrial Component ${partNumber}`,
      enhanced_description: `Schneider Electric industrial automation component. Part number: ${partNumber}. Reliable solution for industrial control and automation systems.`,
      specifications: {
        manufacturer: "Schneider Electric",
        category: "Industrial Automation",
        protection: "IP65",
        certification: "CE, UL"
      },
      confidence: 0.80,
      enhancement_quality_score: 78,
      confidence_analysis: "Good confidence based on Schneider Electric pattern recognition"
    };
  }
  
  // ✅ PRESERVED: Omron (E3, CP1, MY series)
  else if (partNumber.match(/^(E3|CP1|MY\d)/i)) {
    return {
      detected_brand: "Omron",
      brand_confidence: 0.85,
      detected_category: "sensors",
      category_confidence: 0.82,
      enhanced_name: `Omron Industrial Sensor/Control ${partNumber}`,
      enhanced_description: `Omron industrial sensor or control component for automation systems. Part number: ${partNumber}. High-precision device for industrial sensing and control.`,
      specifications: {
        manufacturer: "Omron",
        category: "Sensors/Controls",
        protection: "IP67",
        response_time: "High Speed"
      },
      confidence: 0.78,
      enhancement_quality_score: 75,
      confidence_analysis: "Good confidence based on Omron sensor/control pattern"
    };
  }
  
  // ✅ PRESERVED: Generic/Unknown parts with better analysis
  else {
    let categoryGuess = "components";
    let confidence = 0.4;
    
    // Try to guess category from part number patterns
    if (partNumber.match(/sensor|prox|photo/i)) {
      categoryGuess = "sensors";
      confidence = 0.6;
    } else if (partNumber.match(/motor|drive|servo/i)) {
      categoryGuess = "drives";
      confidence = 0.6;
    } else if (partNumber.match(/valve|cylinder|pneumatic/i)) {
      categoryGuess = "pneumatic";
      confidence = 0.6;
    } else if (partNumber.match(/relay|contactor|switch/i)) {
      categoryGuess = "electrical";
      confidence = 0.6;
    }
    
    return {
      detected_brand: null,
      brand_confidence: 0.3,
      detected_category: categoryGuess,
      category_confidence: confidence,
      enhanced_name: `Industrial ${categoryGuess.charAt(0).toUpperCase() + categoryGuess.slice(1)} ${partNumber}`,
      enhanced_description: `Industrial ${categoryGuess} component with part number ${partNumber}. Manufacturer and detailed specifications to be determined through additional research.`,
      specifications: {
        category: `General ${categoryGuess.charAt(0).toUpperCase() + categoryGuess.slice(1)}`,
        status: "Requires verification"
      },
      confidence: confidence,
      enhancement_quality_score: Math.round(confidence * 100),
      recommended_actions: [
        "Verify manufacturer manually",
        "Add detailed specifications",
        "Cross-reference with supplier catalogs",
        "Consider web search for additional information"
      ],
      confidence_analysis: `Low confidence - pattern-based category guess for unknown manufacturer`
    };
  }
}

// ================================================================
// ✅ PRESERVED: ALL WEB SEARCH ENDPOINTS (KEEPING YOUR EXISTING LOGIC)
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

// ✅ PRESERVED: Health check endpoint specifically for web search functionality
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

// ✅ PRESERVED: Test endpoint for web search functionality with predefined test cases
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

// ✅ PRESERVED: Bulk web search endpoint for multiple part numbers
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

// ✅ PRESERVED: Error handling for file upload
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum is 10 files'
      });
    }
  }
  
  if (error.message && error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  next(error);
});

// ✅ PRESERVED: Export just the router since category initialization is handled in server.js
module.exports = router;
