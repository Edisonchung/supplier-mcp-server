// services/MCPPromptService.js - Bridge between extraction and MCP Tools
const axios = require('axios');

class MCPPromptService {
  constructor() {
    this.apiBase = process.env.MCP_SERVER_URL || 'https://supplier-mcp-server-production.up.railway.app';
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get the best prompt for a specific task
   * @param {string} moduleId - e.g., 'document_extraction'
   * @param {string} category - e.g., 'purchase_order', 'proforma_invoice'
   * @param {Object} context - { supplier, user, documentType }
   * @returns {Object|null} Selected prompt or null if none found
   */
  async getPromptForTask(moduleId, category, context = {}) {
    try {
      console.log(`🔍 MCPPromptService: Looking for prompt - ${moduleId}/${category} for ${context.supplier || 'ANY'}`);
      
      // Get all prompts for this category
      const prompts = await this.getPrompts({ category, active: true });
      
      if (!prompts || prompts.length === 0) {
        console.log(`❌ No MCP prompts found for category: ${category}`);
        return null;
      }

      // Score and select best prompt
      const bestPrompt = this.selectBestPrompt(prompts, context);
      
      if (bestPrompt) {
        console.log(`✅ Selected MCP prompt: ${bestPrompt.name} (score: ${bestPrompt._score})`);
        
        // Track usage (fire and forget)
        this.trackPromptUsage(bestPrompt.id, context).catch(console.warn);
        
        return bestPrompt;
      } else {
        console.log(`❌ No suitable MCP prompt found for context:`, context);
        return null;
      }
    } catch (error) {
      console.error('❌ MCPPromptService error:', error.message);
      return null; // Graceful degradation
    }
  }

  /**
   * Get prompts from MCP API with caching
   */
  async getPrompts(filters = {}) {
    const cacheKey = `prompts_${JSON.stringify(filters)}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`💾 Using cached prompts for ${cacheKey}`);
        return cached.data;
      }
    }

    try {
      // Build query parameters
      const params = new URLSearchParams();
      if (filters.category) params.append('category', filters.category);
      if (filters.active !== undefined) params.append('active', filters.active);
      if (filters.supplier) params.append('supplier', filters.supplier);

      const url = `${this.apiBase}/api/ai/prompts?${params}`;
      console.log(`🌐 Fetching prompts from: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HiggsFlow-MCPPromptService/1.0'
        }
      });

      if (response.status === 200) {
        const prompts = response.data.data || response.data.prompts || response.data || [];
        
        // Cache the result
        this.cache.set(cacheKey, {
          data: prompts,
          timestamp: Date.now()
        });
        
        console.log(`✅ Fetched ${prompts.length} prompts from MCP API`);
        return prompts;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch prompts from MCP API:`, error.message);
      
      // Return fallback/mock prompts for development
      return this.getFallbackPrompts(filters);
    }
  }

  /**
   * Select the best prompt based on context
   */
  selectBestPrompt(prompts, context) {
    const scored = prompts.map(prompt => {
      let score = 0;
      
      // 1. Supplier matching (highest priority)
      if (context.supplier && prompt.suppliers) {
        if (prompt.suppliers.includes(context.supplier)) {
          score += 100; // Exact supplier match
        } else if (prompt.suppliers.includes('ALL')) {
          score += 50; // Universal prompt
        } else {
          score += 0; // No match
        }
      } else if (prompt.suppliers && prompt.suppliers.includes('ALL')) {
        score += 50; // Universal fallback
      }

      // 2. User targeting
      if (context.user && prompt.targetUsers) {
        if (prompt.targetUsers.includes(context.user.email)) {
          score += 80; // User-specific prompt
        }
      }

      // 3. Role targeting
      if (context.user && prompt.targetRoles) {
        if (prompt.targetRoles.includes(context.user.role)) {
          score += 60; // Role-specific prompt
        }
      }

      // 4. Performance metrics
      if (prompt.performance) {
        score += (prompt.performance.accuracy || 0) * 0.5; // Convert percentage to points
      }

      // 5. Version recency (newer versions get slight boost)
      if (prompt.version) {
        const versionBoost = this.getVersionScore(prompt.version);
        score += versionBoost;
      }

      // 6. Active status
      if (prompt.isActive) {
        score += 10;
      }

      return { ...prompt, _score: score };
    });

    // Sort by score (descending) and return the best
    scored.sort((a, b) => b._score - a._score);
    
    // Only return prompts with reasonable scores
    const bestPrompt = scored[0];
    return bestPrompt && bestPrompt._score > 10 ? bestPrompt : null;
  }

  /**
   * Get version score for sorting
   */
  getVersionScore(version) {
    try {
      const parts = version.split('.').map(Number);
      return (parts[0] || 0) * 100 + (parts[1] || 0) * 10 + (parts[2] || 0);
    } catch {
      return 0;
    }
  }

  /**
   * Track prompt usage analytics
   */
  async trackPromptUsage(promptId, context) {
    try {
      await axios.post(`${this.apiBase}/api/ai/prompts/${promptId}/usage`, {
        context: context,
        timestamp: new Date().toISOString(),
        system: 'dual_extraction'
      }, { timeout: 5000 });
    } catch (error) {
      // Silently fail - analytics shouldn't break extraction
      console.warn('Analytics tracking failed:', error.message);
    }
  }

  /**
   * Get count of available MCP prompts
   */
  async getPromptCount() {
    try {
      const prompts = await this.getPrompts();
      return prompts.length;
    } catch {
      return 0;
    }
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ MCPPromptService cache cleared');
  }

  /**
   * Fallback prompts for when MCP API is unavailable
   */
  getFallbackPrompts(filters = {}) {
    console.log('🔄 Using fallback prompts - MCP API unavailable');
    
    const fallbackPrompts = [
      {
        id: 'fallback_po_base',
        name: 'Purchase Order - Base Extraction (Fallback)',
        category: 'purchase_order',
        version: '1.0.0',
        isActive: true,
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        description: 'Fallback prompt when MCP API is unavailable',
        prompt: `Extract purchase order information with PRECISE table column identification.

CRITICAL TABLE PARSING RULES:
1. ALWAYS identify exact column order from table header
2. Common PO table patterns:
   - Line | Part Number | Description | Delivery Date | Quantity | UOM | Unit Price | Amount

3. QUANTITY vs UNIT PRICE identification:
   - Quantity: Usually smaller numbers (1-10,000 range)
   - Unit Price: Usually larger monetary values with decimals
   - Look for currency patterns: "100.00", "2,200.00"

4. VALIDATION RULES:
   - quantity × unitPrice should ≈ totalPrice
   - If calculation mismatch > 10%, SWAP values and re-check

RETURN STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string",
    "supplier": { "name": "string", "address": "string" },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number
      }
    ],
    "totalAmount": number
  }
}`,
        performance: { accuracy: 85, speed: 2.5, tokens: 1200 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      }
    ];

    // Apply filters
    let filtered = fallbackPrompts;
    
    if (filters.category) {
      filtered = filtered.filter(p => p.category === filters.category);
    }
    
    if (filters.active !== undefined) {
      filtered = filtered.filter(p => p.isActive === filters.active);
    }

    return filtered;
  }

  /**
   * Health check for MCP service
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiBase}/api/ai/health`, {
        timeout: 5000
      });
      
      return {
        status: 'healthy',
        apiUrl: this.apiBase,
        responseTime: response.headers['x-response-time'] || 'unknown',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        apiUrl: this.apiBase,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = MCPPromptService;
