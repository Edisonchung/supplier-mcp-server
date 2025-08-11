//services/ai/AIProviderManager.js - Enhanced with Better Debugging
class AIProviderManager {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = 'deepseek';
    this.debugMode = process.env.AI_DEBUG === 'true' || process.env.NODE_ENV === 'development';
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageResponseTime: 0,
      callsByProvider: {}
    };
    this.initializeProviders();
  }

  initializeProviders() {
    console.log('🔧 Initializing AI providers for HiggsFlow product enhancement...');
    
    // 🔍 DEBUG: Log environment configuration
    if (this.debugMode) {
      console.log('🔍 DEBUG: Environment Configuration', {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? 'CONFIGURED' : 'MISSING',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'CONFIGURED' : 'MISSING',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'CONFIGURED' : 'MISSING',
        GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY ? 'CONFIGURED' : 'MISSING',
        debugMode: this.debugMode,
        nodeEnv: process.env.NODE_ENV
      });
    }

    // DeepSeek (your primary provider)
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const { OpenAI } = require('openai');
        this.providers.set('deepseek', new OpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: 'https://api.deepseek.com'
        }));
        console.log('✅ DeepSeek initialized (primary for product enhancement)');
        this.stats.callsByProvider.deepseek = { calls: 0, successes: 0, failures: 0 };
      } catch (error) {
        console.error('❌ Failed to initialize DeepSeek:', error.message);
      }
    } else {
      console.warn('⚠️ DEEPSEEK_API_KEY not found - DeepSeek provider unavailable');
    }

    // OpenAI (backup/premium features)
    if (process.env.OPENAI_API_KEY) {
      try {
        const { OpenAI } = require('openai');
        this.providers.set('openai', new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        }));
        console.log('✅ OpenAI initialized (backup for high-precision tasks)');
        this.stats.callsByProvider.openai = { calls: 0, successes: 0, failures: 0 };
      } catch (error) {
        console.error('❌ Failed to initialize OpenAI:', error.message);
      }
    }

    // Anthropic Claude (advanced analysis)
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.providers.set('anthropic', new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        }));
        console.log('✅ Anthropic initialized (advanced product analysis)');
        this.stats.callsByProvider.anthropic = { calls: 0, successes: 0, failures: 0 };
      } catch (error) {
        console.error('❌ Failed to initialize Anthropic:', error.message);
      }
    }

    // Google AI (specialized tasks)
    if (process.env.GOOGLE_AI_API_KEY) {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        this.providers.set('google', new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY));
        console.log('✅ Google AI initialized (specialized analysis)');
        this.stats.callsByProvider.google = { calls: 0, successes: 0, failures: 0 };
      } catch (error) {
        console.error('❌ Failed to initialize Google AI:', error.message);
      }
    }

    const providerCount = this.providers.size;
    console.log(`🎯 ${providerCount} AI providers ready for HiggsFlow product enhancement`);
    
    if (providerCount === 0) {
      console.warn('⚠️ No AI providers configured. Please add API keys to environment variables.');
      console.warn('💡 Add DEEPSEEK_API_KEY to enable AI-powered product enhancement.');
    }

    // 🔍 DEBUG: List all available providers
    if (this.debugMode) {
      console.log('🔍 DEBUG: Available Providers', Array.from(this.providers.keys()));
    }
  }

  async callAI(provider, prompt, options = {}) {
    const requestId = Date.now().toString();
    console.log(`🚀 [${requestId}] Starting REAL AI call to ${provider} for product enhancement`);
    
    // 🔍 DEBUG: Log call details
    if (this.debugMode) {
      console.log(`🔍 DEBUG: [${requestId}] Call Details`, {
        provider,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 200) + '...',
        options,
        availableProviders: Array.from(this.providers.keys()),
        timestamp: new Date().toISOString()
      });
    }
    
    const ai = this.providers.get(provider);
    if (!ai) {
      console.warn(`⚠️ [${requestId}] Provider '${provider}' not available, falling back to ${this.defaultProvider}`);
      if (this.providers.has(this.defaultProvider)) {
        return await this.callAI(this.defaultProvider, prompt, options);
      } else {
        throw new Error(`No AI providers available. Please configure API keys.`);
      }
    }

    const timeout = options.timeout || 120000; // 2 minutes default
    const temperature = options.temperature || 0.1;
    const maxTokens = options.maxTokens || 2000;

    // Update stats
    this.stats.totalCalls++;
    if (this.stats.callsByProvider[provider]) {
      this.stats.callsByProvider[provider].calls++;
    }

    try {
      console.log(`🤖 [${requestId}] Making REAL API call to ${provider}...`);
      console.log(`📊 [${requestId}] Parameters: temp=${temperature}, maxTokens=${maxTokens}, timeout=${timeout/1000}s`);
      
      const startTime = Date.now();
      
      // 🔍 DEBUG: Log before API call
      if (this.debugMode) {
        console.log(`🔍 DEBUG: [${requestId}] About to call executeAICall for ${provider}`);
      }
      
      const result = await Promise.race([
        this.executeAICall(provider, ai, prompt, { temperature, maxTokens, requestId }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`AI call timeout after ${timeout/1000}s`)), timeout)
        )
      ]);
      
      const responseTime = Date.now() - startTime;
      
      // Update success stats
      this.stats.successfulCalls++;
      if (this.stats.callsByProvider[provider]) {
        this.stats.callsByProvider[provider].successes++;
      }
      this.updateAverageResponseTime(responseTime);
      
      console.log(`✅ [${requestId}] ${provider} REAL API call completed successfully in ${responseTime}ms`);
      console.log(`📈 [${requestId}] Success rate: ${Math.round((this.stats.successfulCalls / this.stats.totalCalls) * 100)}%`);
      
      // 🔍 DEBUG: Log response details
      if (this.debugMode) {
        console.log(`🔍 DEBUG: [${requestId}] Response Details`, {
          provider,
          responseTime,
          responseType: typeof result,
          responseLength: JSON.stringify(result).length,
          hasContent: !!result,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const errorTime = Date.now() - Date.now();
      console.error(`❌ [${requestId}] REAL AI provider '${provider}' error after ${errorTime}ms:`, error.message);
      
      // 🔍 DEBUG: Log error details
      if (this.debugMode) {
        console.error(`🔍 DEBUG: [${requestId}] Error Details`, {
          provider,
          errorMessage: error.message,
          errorStack: error.stack?.substring(0, 500),
          promptLength: prompt.length,
          options,
          timestamp: new Date().toISOString()
        });
      }
      
      // Update failure stats
      this.stats.failedCalls++;
      if (this.stats.callsByProvider[provider]) {
        this.stats.callsByProvider[provider].failures++;
      }
      
      // Try fallback provider if available
      if (provider !== this.defaultProvider && this.providers.has(this.defaultProvider)) {
        console.log(`🔄 [${requestId}] Falling back to ${this.defaultProvider}...`);
        return await this.callAI(this.defaultProvider, prompt, options);
      }
      
      throw error;
    }
  }

  async executeAICall(provider, ai, prompt, options) {
    const { temperature, maxTokens, requestId } = options;
    
    // 🔍 DEBUG: Log execution start
    if (this.debugMode) {
      console.log(`🔍 DEBUG: [${requestId}] executeAICall started for ${provider}`);
    }

    switch (provider) {
      case 'deepseek':
      case 'openai':
        console.log(`🔧 [${requestId}] Using ${provider === 'openai' ? 'GPT-4-Turbo' : 'DeepSeek-Chat'} model`);
        
        try {
          const completion = await ai.chat.completions.create({
            model: provider === 'openai' ? 'gpt-4-turbo' : 'deepseek-chat',
            messages: [
              { 
                role: 'system', 
                content: 'You are HiggsFlow\'s industrial product enhancement AI specialist. You excel at analyzing part numbers and providing detailed product information. Always return valid JSON with comprehensive product analysis.' 
              },
              { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens,
            response_format: { type: "json_object" }
          });
          
          const content = completion.choices[0].message.content;
          console.log(`📝 [${requestId}] Received ${content.length} characters from ${provider}`);
          
          // 🔍 DEBUG: Log raw response
          if (this.debugMode) {
            console.log(`🔍 DEBUG: [${requestId}] Raw ${provider} response preview:`, content.substring(0, 300) + '...');
          }
          
          try {
            const parsed = JSON.parse(content);
            console.log(`✅ [${requestId}] Successfully parsed JSON response from ${provider}`);
            
            // 🔍 DEBUG: Log parsed structure
            if (this.debugMode) {
              console.log(`🔍 DEBUG: [${requestId}] Parsed object keys:`, Object.keys(parsed));
            }
            
            return parsed;
          } catch (parseError) {
            console.error(`❌ [${requestId}] JSON parse error from ${provider}:`, parseError.message);
            console.log(`🔍 [${requestId}] Raw response causing parse error:`, content.substring(0, 500) + '...');
            throw new Error(`Failed to parse JSON response from ${provider}: ${parseError.message}`);
          }
        } catch (apiError) {
          console.error(`❌ [${requestId}] ${provider} API error:`, apiError.message);
          throw apiError;
        }

      case 'anthropic':
        console.log(`🔧 [${requestId}] Using Claude-3-Sonnet model`);
        
        try {
          const message = await ai.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: maxTokens,
            messages: [{ 
              role: 'user', 
              content: `You are HiggsFlow's industrial product enhancement AI. Analyze the following product information and return valid JSON with detailed enhancement data.

${prompt}` 
            }],
            temperature
          });
          
          const anthropicContent = message.content[0].text;
          console.log(`📝 [${requestId}] Received ${anthropicContent.length} characters from Anthropic`);
          
          // 🔍 DEBUG: Log raw response
          if (this.debugMode) {
            console.log(`🔍 DEBUG: [${requestId}] Raw Anthropic response preview:`, anthropicContent.substring(0, 300) + '...');
          }
          
          try {
            // Claude sometimes returns JSON wrapped in markdown
            const cleanContent = anthropicContent
              .replace(/```json\s*\n?/g, '')
              .replace(/```\s*\n?/g, '')
              .trim();
            
            const parsed = JSON.parse(cleanContent);
            console.log(`✅ [${requestId}] Successfully parsed JSON response from Anthropic`);
            return parsed;
          } catch (parseError) {
            console.error(`❌ [${requestId}] JSON parse error from Anthropic:`, parseError.message);
            console.log(`🔍 [${requestId}] Raw Anthropic response:`, anthropicContent.substring(0, 500) + '...');
            throw new Error(`Failed to parse JSON response from Anthropic: ${parseError.message}`);
          }
        } catch (apiError) {
          console.error(`❌ [${requestId}] Anthropic API error:`, apiError.message);
          throw apiError;
        }

      case 'google':
        console.log(`🔧 [${requestId}] Using Gemini-Pro model`);
        
        try {
          const model = ai.getGenerativeModel({ model: 'gemini-pro' });
          const result = await model.generateContent(`HiggsFlow industrial product enhancement task:

${prompt}

Return valid JSON only.`);
          const response = await result.response;
          const googleContent = response.text();
          
          console.log(`📝 [${requestId}] Received ${googleContent.length} characters from Google`);
          
          // 🔍 DEBUG: Log raw response
          if (this.debugMode) {
            console.log(`🔍 DEBUG: [${requestId}] Raw Google response preview:`, googleContent.substring(0, 300) + '...');
          }
          
          try {
            // Google sometimes returns JSON wrapped in markdown
            const cleanContent = googleContent
              .replace(/```json\s*\n?/g, '')
              .replace(/```\s*\n?/g, '')
              .trim();
            
            const parsed = JSON.parse(cleanContent);
            console.log(`✅ [${requestId}] Successfully parsed JSON response from Google`);
            return parsed;
          } catch (parseError) {
            console.error(`❌ [${requestId}] JSON parse error from Google:`, parseError.message);
            console.log(`🔍 [${requestId}] Raw Google response:`, googleContent.substring(0, 500) + '...');
            throw new Error(`Failed to parse JSON response from Google: ${parseError.message}`);
          }
        } catch (apiError) {
          console.error(`❌ [${requestId}] Google API error:`, apiError.message);
          throw apiError;
        }

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  updateAverageResponseTime(newTime) {
    if (this.stats.successfulCalls === 1) {
      this.stats.averageResponseTime = newTime;
    } else {
      this.stats.averageResponseTime = 
        ((this.stats.averageResponseTime * (this.stats.successfulCalls - 1)) + newTime) / this.stats.successfulCalls;
    }
  }

  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  isProviderAvailable(provider) {
    return this.providers.has(provider);
  }

  getProviderStatus() {
    const status = {};
    const availableProviders = this.getAvailableProviders();
    
    ['deepseek', 'openai', 'anthropic', 'google'].forEach(provider => {
      const isAvailable = availableProviders.includes(provider);
      const envKey = `${provider.toUpperCase()}_API_KEY`;
      const providerStats = this.stats.callsByProvider[provider] || { calls: 0, successes: 0, failures: 0 };
      
      status[provider] = {
        available: isAvailable,
        configured: !!process.env[envKey],
        primary: provider === this.defaultProvider,
        realAPIMode: true, // Always true for this enhanced version
        stats: {
          totalCalls: providerStats.calls,
          successfulCalls: providerStats.successes,
          failedCalls: providerStats.failures,
          successRate: providerStats.calls > 0 ? 
            Math.round((providerStats.successes / providerStats.calls) * 100) : 0
        }
      };
    });
    
    return {
      providers: status,
      totalAvailable: availableProviders.length,
      defaultProvider: this.defaultProvider,
      realAPIMode: true,
      debugMode: this.debugMode,
      globalStats: {
        totalCalls: this.stats.totalCalls,
        successfulCalls: this.stats.successfulCalls,
        failedCalls: this.stats.failedCalls,
        successRate: this.stats.totalCalls > 0 ? 
          Math.round((this.stats.successfulCalls / this.stats.totalCalls) * 100) : 0,
        averageResponseTime: Math.round(this.stats.averageResponseTime)
      }
    };
  }

  // Enhanced health check for all providers
  async healthCheck() {
    console.log('🏥 Running REAL AI provider health check...');
    const results = {};
    
    for (const [name, provider] of this.providers) {
      try {
        console.log(`🔍 Testing ${name} provider with REAL API call...`);
        const startTime = Date.now();
        
        // Simple test call for product enhancement
        const testResult = await this.executeAICall(name, provider, 
          'Test health check for product enhancement. Return JSON: {"status": "healthy", "provider": "' + name + '", "test": "product_enhancement"}', 
          { maxTokens: 100, temperature: 0.1, requestId: 'health-check' }
        );
        
        const responseTime = Date.now() - startTime;
        results[name] = { 
          status: 'healthy', 
          available: true, 
          responseTime: `${responseTime}ms`,
          testResult: testResult,
          realAPICall: true,
          lastChecked: new Date().toISOString()
        };
        console.log(`✅ ${name} REAL health check passed (${responseTime}ms)`);
        
      } catch (error) {
        results[name] = { 
          status: 'unhealthy', 
          available: false, 
          error: error.message,
          realAPICall: true,
          lastChecked: new Date().toISOString()
        };
        console.error(`❌ ${name} REAL health check failed:`, error.message);
      }
    }
    
    const healthyCount = Object.values(results).filter(r => r.status === 'healthy').length;
    console.log(`🎯 REAL health check complete: ${healthyCount}/${this.providers.size} providers healthy`);
    
    return {
      providers: results,
      summary: {
        total: this.providers.size,
        healthy: healthyCount,
        unhealthy: this.providers.size - healthyCount,
        overallHealth: healthyCount > 0 ? 'operational' : 'degraded',
        realAPIMode: true
      },
      timestamp: new Date().toISOString()
    };
  }

  // Method to get detailed statistics
  getDetailedStats() {
    return {
      ...this.stats,
      providers: this.stats.callsByProvider,
      averageResponseTime: Math.round(this.stats.averageResponseTime),
      successRate: this.stats.totalCalls > 0 ? 
        Math.round((this.stats.successfulCalls / this.stats.totalCalls) * 100) : 0,
      realAPIMode: true,
      debugMode: this.debugMode,
      timestamp: new Date().toISOString()
    };
  }

  // Method to reset statistics
  resetStats() {
    console.log('🔄 Resetting AI provider statistics...');
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageResponseTime: 0,
      callsByProvider: {}
    };
    
    // Reinitialize provider stats
    for (const provider of this.providers.keys()) {
      this.stats.callsByProvider[provider] = { calls: 0, successes: 0, failures: 0 };
    }
    
    console.log('✅ Statistics reset complete');
  }

  // Method to check if any providers are available
  hasProviders() {
    return this.providers.size > 0;
  }

  // Method to get best performing provider
  getBestProvider() {
    if (this.providers.size === 0) {
      return null;
    }

    if (this.providers.size === 1) {
      return this.providers.keys().next().value;
    }

    // Find provider with best success rate and reasonable response time
    let bestProvider = this.defaultProvider;
    let bestScore = 0;

    for (const [provider, stats] of Object.entries(this.stats.callsByProvider)) {
      if (stats.calls > 0) {
        const successRate = stats.successes / stats.calls;
        const score = successRate * 100; // Simple scoring for now
        
        if (score > bestScore && this.providers.has(provider)) {
          bestScore = score;
          bestProvider = provider;
        }
      }
    }

    return bestProvider;
  }

  // 🔧 NEW: Method to force a real API test call
  async testRealAPICall(provider = 'deepseek', testPrompt = null) {
    if (!testPrompt) {
      testPrompt = `Test real API call for HiggsFlow product enhancement. Part number: TEST-001. Return JSON: {
  "detected_brand": "Test Brand",
  "enhanced_name": "Test Product Enhanced",
  "description": "This is a test product for API verification",
  "confidence": 0.95,
  "test_successful": true,
  "timestamp": "${new Date().toISOString()}"
}`;
    }

    console.log(`🧪 Testing REAL API call for ${provider}...`);
    
    try {
      const result = await this.callAI(provider, testPrompt, {
        temperature: 0.1,
        maxTokens: 500,
        timeout: 30000
      });
      
      console.log(`✅ REAL API test successful for ${provider}:`, result);
      return {
        success: true,
        provider,
        result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ REAL API test failed for ${provider}:`, error.message);
      return {
        success: false,
        provider,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = AIProviderManager;
