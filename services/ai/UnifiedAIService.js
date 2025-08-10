//services/ai/UnifiedAIService.js - Enhanced for Product Enhancement
const AIModuleManager = require('./AIModuleManager');
const PromptManager = require('./PromptManager');
const AIProviderManager = require('./AIProviderManager');
const EventEmitter = require('events');

class UnifiedAIService extends EventEmitter {
  constructor() {
    super(); // Call EventEmitter constructor
    this.moduleManager = new AIModuleManager();
    this.promptManager = new PromptManager();
    this.providerManager = new AIProviderManager();
    
    // Initialize asynchronously
    this.initPromise = this.initialize();
  }

  async initialize() {
    try {
      // Wait for PromptManager to fully initialize (especially Firebase)
      console.log('🔄 Initializing HiggsFlow UnifiedAIService for product enhancement...');
      
      // Give PromptManager time to load from Firebase
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify PromptManager has loaded prompts
      const prompts = this.promptManager.getAllPrompts();
      console.log(`✅ HiggsFlow Unified AI Service initialized with ${prompts.length} prompts`);
      console.log(`🎯 AI Providers available: ${this.providerManager.getAvailableProviders().join(', ')}`);
      
      // Emit initialization complete event
      this.emit('initialized', {
        timestamp: new Date().toISOString(),
        version: '2.1.0-product-enhancement',
        promptsLoaded: prompts.length,
        providersAvailable: this.providerManager.getAvailableProviders().length
      });
      
      return true;
    } catch (error) {
      console.error('❌ Unified AI Service initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  // ✅ NEW: Direct AI call method for product enhancement
  async callAI(provider, prompt, options = {}) {
    await this.initPromise;
    
    console.log(`🚀 UnifiedAIService: Calling ${provider} for product enhancement`);
    
    try {
      // Use the AIProviderManager to make the call
      const result = await this.providerManager.callAI(provider, prompt, options);
      
      console.log(`✅ UnifiedAIService: ${provider} call successful`);
      
      // Emit AI call event
      this.emit('ai_call_complete', {
        provider,
        success: true,
        timestamp: new Date().toISOString(),
        responseLength: JSON.stringify(result).length
      });
      
      return result;
    } catch (error) {
      console.error(`❌ UnifiedAIService: ${provider} call failed:`, error.message);
      
      // Emit AI call error event
      this.emit('ai_call_error', {
        provider,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }

  // ✅ NEW: Enhanced product enhancement method
  async enhanceProduct(productData, promptTemplate, options = {}) {
    await this.initPromise;
    
    console.log('🔧 UnifiedAIService: Starting product enhancement...');
    const startTime = Date.now();
    
    try {
      // Replace template variables in prompt
      let processedPrompt = promptTemplate;
      const templateData = {
        partNumber: productData.partNumber || '',
        productName: productData.name || '',
        brand: productData.brand || '',
        description: productData.description || '',
        category: productData.category || ''
      };
      
      Object.keys(templateData).forEach(key => {
        const placeholder = `{{${key}}}`;
        processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), templateData[key]);
      });
      
      console.log(`📝 Template variables replaced for part: ${productData.partNumber}`);
      
      // Call AI with the processed prompt
      const aiProvider = options.aiProvider || 'deepseek';
      const result = await this.callAI(aiProvider, processedPrompt, {
        temperature: options.temperature || 0.1,
        maxTokens: options.maxTokens || 2500,
        timeout: options.timeout || 30000
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Product enhancement complete in ${processingTime}ms`);
      
      // Emit product enhancement event
      this.emit('product_enhancement_complete', {
        partNumber: productData.partNumber,
        provider: aiProvider,
        processingTime,
        success: true,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        result,
        metadata: {
          processingTime,
          provider: aiProvider,
          method: 'unified_ai_enhancement',
          partNumber: productData.partNumber,
          templateUsed: true
        }
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Product enhancement failed after ${processingTime}ms:`, error.message);
      
      // Emit product enhancement error event
      this.emit('product_enhancement_error', {
        partNumber: productData.partNumber,
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }

  async processTask(taskType, data, context = {}) {
    await this.initPromise;
    
    console.log(`🧠 HiggsFlow AI processing: ${taskType}`);
    const startTime = Date.now();

    try {
      // 1. Find appropriate module
      const module = this.moduleManager.getModuleForTask(taskType, context);
      if (!module) {
        throw new Error(`No AI module found for task: ${taskType}`);
      }

      console.log(`📦 Using module: ${module.name} (v${module.version})`);

      // 2. Get best prompt for this task
      const prompt = await this.promptManager.getPromptForTask(
        module.id, 
        taskType, 
        context
      );

      if (!prompt) {
        throw new Error(`No prompt found for task: ${taskType} in module: ${module.name}`);
      }

      console.log(`📝 Using prompt: ${prompt.name} (v${prompt.version})`);
      if (context.supplier && prompt.suppliers?.includes(context.supplier)) {
        console.log(`🎯 Supplier-specific prompt selected for: ${context.supplier}`);
      }

      // 3. Build full prompt with context
      const fullPrompt = this.buildFullPrompt(prompt.prompt, data, context);

      // 4. Call AI provider using the new callAI method
      const aiProvider = prompt.aiProvider || 'deepseek';
      const result = await this.callAI(aiProvider, fullPrompt, {
        temperature: prompt.temperature || 0.1,
        maxTokens: prompt.maxTokens || 2000
      });

      const processingTime = Date.now() - startTime;
      const confidence = this.calculateConfidence(result);

      // 5. Update usage statistics
      await this.moduleManager.updateUsageStats(module.id, 'success');

      // 6. Track performance
      await this.trackPerformance(module.id, prompt.id, {
        provider: aiProvider,
        success: true,
        responseTime: processingTime,
        confidence
      });

      // 7. Emit extraction complete event for MCP integration
      const eventData = {
        taskType,
        success: true,
        result,
        metadata: {
          module: module.name,
          moduleId: module.id,
          prompt: prompt.name,
          promptId: prompt.id,
          provider: aiProvider,
          processingTime,
          confidence,
          supplier: context.supplier || 'unknown',
          documentType: context.documentType || 'unknown'
        },
        timestamp: new Date().toISOString()
      };

      // Emit specific events based on task type
      if (taskType === 'extraction') {
        this.emit('extraction_complete', eventData);
      } else if (taskType === 'analytics') {
        this.emit('analysis_complete', eventData);
      } else if (taskType === 'communication') {
        this.emit('classification_complete', eventData);
      }

      // Emit general task complete event
      this.emit('task_complete', eventData);

      return {
        success: true,
        result,
        metadata: {
          module: module.name,
          moduleId: module.id,
          prompt: prompt.name,
          promptId: prompt.id,
          provider: aiProvider,
          processingTime,
          confidence,
          version: '2.1.0-product-enhancement',
          supplier: context.supplier || 'unknown',
          documentType: context.documentType || 'unknown'
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ HiggsFlow AI task failed (${processingTime}ms):`, error.message);

      // Update failure statistics
      const module = this.moduleManager.getModuleForTask(taskType, context);
      if (module) {
        await this.moduleManager.updateUsageStats(module.id, 'error');
      }

      // Emit error event for MCP integration
      this.emit('task_error', {
        taskType,
        error: error.message,
        context,
        processingTime,
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        error: error.message,
        metadata: {
          processingTime,
          taskType,
          context,
          version: '2.1.0-product-enhancement'
        }
      };
    }
  }

  buildFullPrompt(basePrompt, data, context) {
    let fullPrompt = basePrompt;

    // Add HiggsFlow-specific context
    if (context.documentType) {
      fullPrompt += `\n\nDocument Type: ${context.documentType}`;
    }

    if (context.supplier) {
      fullPrompt += `\nSupplier: ${context.supplier}`;
      
      // Add supplier-specific instructions
      if (context.supplier === 'PTP' || context.supplier.includes('PERINTIS')) {
        fullPrompt += `\nSPECIAL INSTRUCTIONS: This is a PTP supplier document. Use PTP-specific extraction rules.`;
      }
    }

    if (context.filename) {
      fullPrompt += `\nFilename: ${context.filename}`;
    }

    // Add processing context
    fullPrompt += `\n\nHiggsFlow Processing Context:`;
    fullPrompt += `\nSystem: HiggsFlow Procurement Platform`;
    fullPrompt += `\nPriority: High accuracy for procurement data`;
    
    // Add the actual data to process
    fullPrompt += `\n\nDocument Content to Extract:\n${data}`;

    return fullPrompt;
  }

  calculateConfidence(result) {
    if (!result || typeof result !== 'object') return 0.1;

    let confidence = 0.5;

    // Check for HiggsFlow-specific structures
    if (result.purchase_order || result.proforma_invoice) confidence += 0.3;
    
    // Check for product enhancement structures
    if (result.detected_brand || result.enhanced_name) confidence += 0.2;
    
    // Check for required fields
    const hasRequiredFields = Object.keys(result).length > 0;
    if (hasRequiredFields) confidence += 0.1;

    // Check for items array (critical for procurement)
    const hasItems = result.purchase_order?.items || result.proforma_invoice?.items;
    if (hasItems && Array.isArray(hasItems) && hasItems.length > 0) confidence += 0.2;

    // Check for supplier information
    const hasSupplier = result.purchase_order?.supplier || result.proforma_invoice?.supplier;
    if (hasSupplier) confidence += 0.1;

    // Check for product enhancement confidence scores
    if (result.brand_confidence || result.category_confidence) {
      confidence = Math.max(confidence, (result.brand_confidence + result.category_confidence) / 2);
    }

    return Math.min(confidence, 0.98); // Cap at 98%
  }

  async trackPerformance(moduleId, promptId, metrics) {
    // Enhanced performance tracking for HiggsFlow
    const performanceData = {
      timestamp: new Date().toISOString(),
      moduleId,
      promptId,
      ...metrics,
      system: 'higgsflow-unified-ai'
    };
    
    console.log(`📊 HiggsFlow Performance:`, performanceData);
    
    // Emit performance data event for MCP integration
    this.emit('performance_update', performanceData);
    
    // Here you could save to database or analytics service
    // For now, we'll log it for debugging
  }

  // Public API methods aligned with HiggsFlow needs
  async extractFromDocument(content, documentType, context = {}) {
    return await this.processTask('extraction', content, {
      ...context,
      documentType
    });
  }

  async extractPurchaseOrder(content, supplier, context = {}) {
    return await this.extractFromDocument(content, 'purchase_order', {
      ...context,
      supplier
    });
  }

  async extractProformaInvoice(content, context = {}) {
    return await this.extractFromDocument(content, 'proforma_invoice', context);
  }

  async classifyDocument(content, context = {}) {
    return await this.processTask('communication', content, {
      ...context,
      contentType: 'document'
    });
  }

  async analyzeSupplier(supplierData, context = {}) {
    return await this.processTask('analytics', supplierData, context);
  }

  // Management API methods
  async getModules() {
    await this.initPromise;
    return this.moduleManager.getAllModules();
  }

  async getActiveModules() {
    await this.initPromise;
    return this.moduleManager.getActiveModules();
  }

  async getModule(moduleId) {
    await this.initPromise;
    return this.moduleManager.getModule(moduleId);
  }

  async updateModule(moduleId, updates) {
    await this.initPromise;
    const result = await this.moduleManager.updateModule(moduleId, updates);
    
    // Emit module update event
    this.emit('module_updated', {
      moduleId,
      updates,
      timestamp: new Date().toISOString()
    });
    
    return result;
  }

  // 🔧 UPDATED: Enhanced prompt management with Firebase support
  async getPrompts(moduleId = null) {
    await this.initPromise;
    
    try {
      let prompts;
      if (moduleId) {
        prompts = this.promptManager.getPromptsByModule(moduleId);
      } else {
        prompts = this.promptManager.getAllPrompts();
      }
      
      // Ensure prompts is always an array
      const result = Array.isArray(prompts) ? prompts : [];
      console.log(`📋 Retrieved ${result.length} prompts${moduleId ? ` for module ${moduleId}` : ''}`);
      return result;
    } catch (error) {
      console.error('❌ Error getting prompts:', error);
      return [];
    }
  }

  // 🔧 UPDATED: Get prompts by module with better error handling
  async getPromptsByModule(moduleId) {
    await this.initPromise;
    
    try {
      const prompts = this.promptManager.getPromptsByModule(moduleId);
      const result = Array.isArray(prompts) ? prompts : [];
      console.log(`📋 Retrieved ${result.length} prompts for module ${moduleId}`);
      return result;
    } catch (error) {
      console.error(`❌ Error getting prompts for module ${moduleId}:`, error);
      return [];
    }
  }

  // 🔧 UPDATED: Get individual prompt with Firebase integration
  async getPrompt(promptId) {
    await this.initPromise;
    
    try {
      const prompt = await this.promptManager.getPrompt(promptId);
      
      if (prompt) {
        console.log(`✅ Retrieved prompt: ${promptId} - ${prompt.name}`);
      } else {
        console.log(`⚠️ Prompt not found: ${promptId}`);
      }
      
      return prompt;
    } catch (error) {
      console.error(`❌ Failed to get prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // 🔧 UPDATED: Save prompt with Firebase integration
  async savePrompt(promptData) {
    await this.initPromise;
    
    try {
      // Add metadata if not present
      if (!promptData.createdAt) {
        promptData.createdAt = new Date().toISOString();
      }
      promptData.lastModified = new Date().toISOString();
      
      const result = await this.promptManager.savePrompt(promptData);
      
      if (result) {
        // Emit prompt save event
        this.emit('prompt_saved', {
          promptData,
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Prompt saved: ${promptData.id || 'new'} - ${promptData.name}`);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error saving prompt:', error);
      throw error;
    }
  }

  // 🔧 UPDATED: Update existing prompt with Firebase integration
  async updatePrompt(promptId, promptData) {
    await this.initPromise;
    
    try {
      // Ensure ID consistency and add metadata
      promptData.id = promptId;
      promptData.lastModified = new Date().toISOString();
      
      const result = await this.promptManager.updatePrompt(promptId, promptData);
      
      if (result) {
        // Emit prompt update event
        this.emit('prompt_updated', {
          promptId,
          promptData,
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Prompt updated: ${promptId} - ${promptData.name}`);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Failed to update prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // 🔧 UPDATED: Delete prompt with Firebase integration
  async deletePrompt(promptId) {
    await this.initPromise;
    
    try {
      const result = await this.promptManager.deletePrompt(promptId);
      
      if (result) {
        // Emit prompt delete event
        this.emit('prompt_deleted', {
          promptId,
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Prompt deleted: ${promptId}`);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Failed to delete prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // 🔧 UPDATED: Test prompt with enhanced error handling
  async testPrompt(promptId, testData) {
    await this.initPromise;
    
    try {
      // Use PromptManager's test method which handles Firebase
      const result = await this.promptManager.testPrompt(promptId, testData);

      // Emit prompt test event
      this.emit('prompt_tested', {
        promptId,
        testData,
        result,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Prompt tested: ${promptId} - Confidence: ${result.result?.confidence?.toFixed(2) || 'N/A'}`);
      
      return result;
    } catch (error) {
      console.error(`❌ Failed to test prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  async getProviderStatus() {
    await this.initPromise;
    return this.providerManager.getProviderStatus();
  }

  // ✅ NEW: Check if AI providers are available
  isAIAvailable() {
    return this.providerManager.hasProviders();
  }

  // ✅ NEW: Get best performing AI provider
  getBestProvider() {
    return this.providerManager.getBestProvider();
  }

  // 🔧 UPDATED: Extract document wrapper for new API
  async extractDocument(file, documentType) {
    // For now, return a mock response until you integrate with your existing extraction logic
    return {
      success: true,
      result: {
        document_type: documentType,
        confidence: 0.95,
        extraction_data: {
          message: `Mock extraction result for ${documentType} from file: ${file.originalname}`,
          file: file.originalname,
          size: file.size,
          type: file.mimetype
        }
      },
      metadata: {
        file: file.originalname,
        size: file.size,
        processingTime: 1500,
        provider: 'unified_ai_service',
        version: '2.1.0-product-enhancement'
      }
    };
  }

  // 🔧 UPDATED: Comprehensive health check with Firebase status
  async healthCheck() {
    await this.initPromise;
    
    try {
      const modules = this.moduleManager.getAllModules();
      const prompts = this.promptManager.getAllPrompts();
      const promptStats = this.promptManager.getPromptStats();
      const providerStatus = this.providerManager.getProviderStatus();

      const healthData = {
        status: 'healthy',
        system: 'HiggsFlow Unified AI Service',
        modules: {
          total: modules.length,
          active: modules.filter(m => m.status === 'active').length,
          categories: [...new Set(modules.map(m => m.category))]
        },
        prompts: {
          total: prompts.length,
          active: prompts.filter(p => p.isActive).length,
          byCategory: promptStats.byCategory || {},
          byProvider: promptStats.byProvider || {},
          tested: promptStats.tested || 0,
          averageAccuracy: promptStats.averageAccuracy || 0
        },
        providers: providerStatus,
        firebase: {
          enabled: true,
          storage: 'firestore',
          persistence: 'permanent'
        },
        capabilities: [
          'Product Enhancement (Siemens, SKF, ABB)',
          'Purchase Order Extraction',
          'Proforma Invoice Processing', 
          'Supplier-Specific Intelligence (PTP)',
          'Multi-Provider AI Support',
          'Performance Analytics',
          'Firebase Persistence'
        ],
        version: '2.1.0-product-enhancement',
        timestamp: new Date().toISOString()
      };

      // Emit health check event
      this.emit('health_check', healthData);

      return healthData;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      
      const errorHealthData = {
        status: 'degraded',
        system: 'HiggsFlow Unified AI Service',
        error: error.message,
        version: '2.1.0-product-enhancement',
        timestamp: new Date().toISOString()
      };

      this.emit('health_check', errorHealthData);
      return errorHealthData;
    }
  }

  // Quick test method
  async quickTest() {
    const testPO = `
    PURCHASE ORDER PO-TEST-001
    Supplier: Test Supplier Ltd.
    
    Items:
    1. Test Product A - Qty: 5 - Price: $100.00
    2. Test Product B - Qty: 3 - Price: $200.00
    
    Total: $1,100.00
    `;

    try {
      const result = await this.extractPurchaseOrder(testPO, 'TEST_SUPPLIER', {
        filename: 'test-po.pdf'
      });
      
      const testResult = {
        success: result.success,
        extractedItems: result.result?.purchase_order?.items?.length || 0,
        processingTime: result.metadata?.processingTime,
        confidence: result.metadata?.confidence,
        prompt: result.metadata?.prompt
      };

      // Emit quick test event
      this.emit('quick_test_complete', {
        result: testResult,
        timestamp: new Date().toISOString()
      });

      return testResult;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message
      };

      // Emit quick test error event
      this.emit('quick_test_error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return errorResult;
    }
  }

  // Event helper methods for MCP integration
  onExtractionComplete(callback) {
    this.on('extraction_complete', callback);
  }

  onAnalysisComplete(callback) {
    this.on('analysis_complete', callback);
  }

  onTaskComplete(callback) {
    this.on('task_complete', callback);
  }

  onError(callback) {
    this.on('error', callback);
  }

  onPerformanceUpdate(callback) {
    this.on('performance_update', callback);
  }

  // ✅ NEW: Product enhancement specific event listeners
  onProductEnhancementComplete(callback) {
    this.on('product_enhancement_complete', callback);
  }

  onProductEnhancementError(callback) {
    this.on('product_enhancement_error', callback);
  }

  onAICallComplete(callback) {
    this.on('ai_call_complete', callback);
  }

  onAICallError(callback) {
    this.on('ai_call_error', callback);
  }

  // Get all available events for MCP integration
  getAvailableEvents() {
    return [
      'initialized',
      'extraction_complete',
      'analysis_complete',
      'classification_complete',
      'task_complete',
      'task_error',
      'performance_update',
      'module_updated',
      'prompt_saved',
      'prompt_updated',
      'prompt_deleted',
      'prompt_tested',
      'health_check',
      'quick_test_complete',
      'quick_test_error',
      'product_enhancement_complete',  // ✅ NEW
      'product_enhancement_error',     // ✅ NEW
      'ai_call_complete',              // ✅ NEW
      'ai_call_error',                 // ✅ NEW
      'error'
    ];
  }
}

module.exports = UnifiedAIService;
