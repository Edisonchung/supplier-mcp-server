//services/ai/AIProviderManager.js
class AIProviderManager {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = 'deepseek';
    this.initializeProviders();
  }

  initializeProviders() {
    console.log('🔧 Initializing AI providers for HiggsFlow...');

    // DeepSeek (your primary provider)
    if (process.env.DEEPSEEK_API_KEY) {
      const { OpenAI } = require('openai');
      this.providers.set('deepseek', new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com'
      }));
      console.log('✅ DeepSeek initialized (primary)');
    }

    // OpenAI (backup/premium features)
    if (process.env.OPENAI_API_KEY) {
      const { OpenAI } = require('openai');
      this.providers.set('openai', new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      }));
      console.log('✅ OpenAI initialized (backup)');
    }

    // Anthropic Claude (advanced analysis)
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      this.providers.set('anthropic', new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      }));
      console.log('✅ Anthropic initialized (advanced)');
    }

    // Google AI (specialized tasks)
    if (process.env.GOOGLE_AI_API_KEY) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      this.providers.set('google', new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY));
      console.log('✅ Google AI initialized (specialized)');
    }

    const providerCount = this.providers.size;
    console.log(`🎯 ${providerCount} AI providers ready for HiggsFlow`);
    
    if (providerCount === 0) {
      console.warn('⚠️ No AI providers configured. Please add API keys to environment variables.');
    }
  }

  async callAI(provider, prompt, options = {}) {
    const ai = this.providers.get(provider);
    if (!ai) {
      console.warn(`⚠️ Provider '${provider}' not available, falling back to ${this.defaultProvider}`);
      if (this.providers.has(this.defaultProvider)) {
        return await this.callAI(this.defaultProvider, prompt, options);
      } else {
        throw new Error(`No AI providers available. Please configure API keys.`);
      }
    }

    const timeout = options.timeout || 120000; // 2 minutes default
    const temperature = options.temperature || 0.1;
    const maxTokens = options.maxTokens || 2000;

    try {
      console.log(`🤖 Calling ${provider} AI for HiggsFlow extraction...`);
      
      const startTime = Date.now();
      const result = await Promise.race([
        this.executeAICall(provider, ai, prompt, { temperature, maxTokens }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`AI call timeout after ${timeout/1000}s`)), timeout)
        )
      ]);
      
      const responseTime = Date.now() - startTime;
      console.log(`✅ ${provider} responded in ${responseTime}ms`);
      
      return result;
    } catch (error) {
      console.error(`❌ AI provider '${provider}' error:`, error.message);
      
      // Try fallback provider if available
      if (provider !== this.defaultProvider && this.providers.has(this.defaultProvider)) {
        console.log(`🔄 Falling back to ${this.defaultProvider}...`);
        return await this.callAI(this.defaultProvider, prompt, options);
      }
      
      throw error;
    }
  }

  async executeAICall(provider, ai, prompt, options) {
    const { temperature, maxTokens } = options;

    switch (provider) {
      case 'deepseek':
      case 'openai':
        const completion = await ai.chat.completions.create({
          model: provider === 'openai' ? 'gpt-4-turbo' : 'deepseek-chat',
          messages: [
            { 
              role: 'system', 
              content: 'You are HiggsFlow\'s AI extraction expert. Always return valid JSON optimized for procurement data.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);

      case 'anthropic':
        const message = await ai.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: maxTokens,
          messages: [{ 
            role: 'user', 
            content: `You are HiggsFlow's procurement AI assistant. ${prompt}` 
          }],
          temperature
        });
        return JSON.parse(message.content[0].text);

      case 'google':
        const model = ai.getGenerativeModel({ model: 'gemini-pro' });
        const result = await model.generateContent(`HiggsFlow procurement extraction: ${prompt}`);
        const response = await result.response;
        return JSON.parse(response.text());

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
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
      status[provider] = {
        available: availableProviders.includes(provider),
        configured: !!process.env[`${provider.toUpperCase()}_API_KEY`],
        primary: provider === this.defaultProvider
      };
    });
    
    return {
      providers: status,
      totalAvailable: availableProviders.length,
      defaultProvider: this.defaultProvider
    };
  }

  // Health check for all providers
  async healthCheck() {
    const results = {};
    
    for (const [name, provider] of this.providers) {
      try {
        // Simple test call
        await this.executeAICall(name, provider, 'Return {"status": "healthy"}', { maxTokens: 50 });
        results[name] = { status: 'healthy', available: true };
      } catch (error) {
        results[name] = { status: 'unhealthy', available: false, error: error.message };
      }
    }
    
    return results;
  }
}

module.exports = AIProviderManager;
