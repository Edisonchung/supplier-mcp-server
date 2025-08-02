//services/ai/UnifiedAIService.js
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
      // Give managers time to load their data
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('✅ HiggsFlow Unified AI Service initialized');
      
      // Emit initialization complete event
      this.emit('initialized', {
        timestamp: new Date().toISOString(),
        version: '2.0.0-modular'
      });
    } catch (error) {
      console.error('❌ Unified AI Service initialization failed:', error);
      this.emit('error', error);
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

      // 4. Call AI provider
      const aiProvider = prompt.aiProvider || 'deepseek';
      const result = await this.providerManager.callAI(aiProvider, fullPrompt, {
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
          version: '2.0.0-modular',
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
          version: '2.0.0-modular'
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
    
    // Check for required fields
    const hasRequiredFields = Object.keys(result).length > 0;
    if (hasRequiredFields) confidence += 0.1;

    // Check for items array (critical for procurement)
    const hasItems = result.purchase_order?.items || result.proforma_invoice?.items;
    if (hasItems && Array.isArray(hasItems) && hasItems.length > 0) confidence += 0.2;

    // Check for supplier information
    const hasSupplier = result.purchase_order?.supplier || result.proforma_invoice?.supplier;
    if (hasSupplier) confidence += 0.1;

    return Math.min(confidence, 0.98); // Cap at 98%
  }

  async trackPerformance(moduleId, promptId, metrics) {
    // Enhanced performance tracking for HiggsFlow
    const performanceData = {
      timestamp: new Date().toISOString(),
      moduleId,
      promptId,
      ...metrics,
      system: 'higgsflow-modular-ai'
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

  async getPrompts(moduleId = null) {
    await this.initPromise;
    if (moduleId) {
      return this.promptManager.getPromptsByModule(moduleId);
    }
    return this.promptManager.getAllPrompts();
  }

  async savePrompt(promptData) {
    await this.initPromise;
    const result = await this.promptManager.savePrompt(promptData);
    
    // Emit prompt save event
    this.emit('prompt_saved', {
      promptData,
      timestamp: new Date().toISOString()
    });
    
    return result;
  }

  async testPrompt(promptId, testData) {
    await this.initPromise;
    const result = await this.promptManager.testPrompt(promptId, testData);
    
    // Emit prompt test event
    this.emit('prompt_tested', {
      promptId,
      testData,
      result,
      timestamp: new Date().toISOString()
    });
    
    return result;
  }

  async getProviderStatus() {
    return this.providerManager.getProviderStatus();
  }

  // Comprehensive health check
  async healthCheck() {
    await this.initPromise;
    
    const modules = this.moduleManager.getAllModules();
    const prompts = this.promptManager.getAllPrompts();
    const providerStatus = this.providerManager.getProviderStatus();

    const healthData = {
      status: 'healthy',
      system: 'HiggsFlow Modular AI',
      modules: {
        total: modules.length,
        active: modules.filter(m => m.status === 'active').length,
        categories: [...new Set(modules.map(m => m.category))]
      },
      prompts: {
        total: prompts.length,
        active: prompts.filter(p => p.isActive).length,
        byCategory: prompts.reduce((acc, p) => {
          acc[p.category] = (acc[p.category] || 0) + 1;
          return acc;
        }, {})
      },
      providers: providerStatus,
      capabilities: [
        'Purchase Order Extraction',
        'Proforma Invoice Processing', 
        'Supplier-Specific Intelligence (PTP)',
        'Multi-Provider AI Support',
        'Performance Analytics'
      ],
      version: '2.0.0-modular',
      timestamp: new Date().toISOString()
    };

    // Emit health check event
    this.emit('health_check', healthData);

    return healthData;
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
      'prompt_tested',
      'health_check',
      'quick_test_complete',
      'quick_test_error',
      'error'
    ];
  }
}

module.exports = UnifiedAIService;
