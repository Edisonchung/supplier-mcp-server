// services/MCPPromptService.js - Bridge between extraction and MCP Tools
const axios = require('axios');

class MCPPromptService {
  constructor() {
    this.apiBase = process.env.MCP_SERVER_URL || 'https://supplier-mcp-server-production.up.railway.app';
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.fallbackPrompts = this.createFallbackPrompts();
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
   * Create fallback prompts for when MCP API is unavailable
   */
  createFallbackPrompts() {
    return [
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

5. PROJECT CODE EXTRACTION:
   - Look for project codes near each line item (format: FS-S3798, BWS-S1046, etc.)
   - Project codes may appear in blue text, separate columns, or as references
   - Extract project code for each item if visible - it's essential for project tracking

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
        "totalPrice": number,
        "projectCode": "string (e.g., FS-S3798, BWS-S1046)"
      }
    ],
    "totalAmount": number
  }
}`,
        performance: { accuracy: 85, speed: 2.5, tokens: 1200 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      },
      {
        id: 'fallback_pi_base',
        name: 'Proforma Invoice - Base Extraction (Fallback)',
        category: 'proforma_invoice',
        version: '1.0.0',
        isActive: true,
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        description: 'Fallback PI prompt when MCP API is unavailable',
        prompt: `Extract proforma invoice information from this Chinese supplier document.
    
CRITICAL PI-SPECIFIC RULES:
1. This is a PROFORMA INVOICE (PI) from a Chinese supplier to Malaysian buyer
2. Table format: Sr NO | ITEMS NAME | MODEL | BRAND | QUANTITY | UNIT PRICE | TOTAL PRICE
3. Extract ALL items from the table, not just the first one
4. Items are in format: BEARING 32222 SKF 100 $13.00 $1,300.00
5. Currency is USD with $ symbol
6. Look for SHIPPER (supplier) and RECEIVER (buyer) sections
7. Extract freight costs and total costs separately

Example PI Format:
Sr NO ITEMS NAME MODEL BRAND QUANTITY UNIT PRICE TOTAL PRICE
1     BEARING    32222 SKF   100      $ 13.00    $ 1,300.00
2     BEARING    HM518445/10 SKF 100  $ 6.00     $ 600.00

RETURN STRUCTURED JSON:
{
  "proforma_invoice": {
    "piNumber": "string",
    "date": "string",
    "supplier": { 
      "name": "string", 
      "contact": "string",
      "email": "string",
      "phone": "string",
      "address": "string"
    },
    "buyer": { 
      "name": "string", 
      "contact": "string",
      "email": "string",
      "phone": "string",
      "address": "string"
    },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string",
        "brand": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number
      }
    ],
    "totals": {
      "subtotal": number,
      "freight": number,
      "totalCost": number,
      "currency": "string"
    },
    "terms": {
      "payment": "string",
      "delivery": "string",
      "packaging": "string"
    }
  }
}`,
        performance: { accuracy: 83, speed: 2.7, tokens: 1400 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      },
      {
        id: 'fallback_ptp_specific',
        name: 'PTP Supplier - Specific Extraction (Fallback)',
        category: 'purchase_order',
        version: '1.0.0',
        isActive: true,
        suppliers: ['PTP', 'PT. PERINTIS TEKNOLOGI PERDANA'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        description: 'Fallback PTP-specific prompt when MCP API is unavailable',
        prompt: `Extract purchase order information from this PT. PERINTIS TEKNOLOGI PERDANA document.
    
CRITICAL PTP-SPECIFIC RULES:
1. This supplier uses a multi-line format where product names appear BELOW the part number line
2. The format is: Line Number | Part Number | Quantity | UOM | Price
3. The product description/name is on the NEXT LINE below, indented
4. NEVER use UOM values (PCS, UNI, SET, EA, etc.) as the product name
5. Look for descriptive text on the line following the part number

Example PTP Format:
Line  Part Number
1     400QCR1068                     1.00   PCS   20,500.00
      THRUSTER                       <-- This is the product name
2     B247K18x12x1000                10.00  UNI   325,000.00  
      RUBBER HOSE                    <-- This is the product name

RETURN STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string",
    "supplier": { "name": "string", "address": "string", "contact": "string" },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string (NOT UOM)",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number,
        "projectCode": "string (e.g., FS-S3798, BWS-S1046)"
      }
    ],
    "totalAmount": number,
    "deliveryDate": "string",
    "paymentTerms": "string"
  }
}`,
        performance: { accuracy: 92, speed: 2.2, tokens: 1100 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      }
    ];
  }

  /**
   * Fallback prompts for when MCP API is unavailable
   */
  getFallbackPrompts(filters = {}) {
    console.log('🔄 Using fallback prompts - MCP API unavailable');
    
    // Apply filters
    let filtered = this.fallbackPrompts;
    
    if (filters.category) {
      filtered = filtered.filter(p => p.category === filters.category);
    }
    
    if (filters.active !== undefined) {
      filtered = filtered.filter(p => p.isActive === filters.active);
    }
    
    if (filters.supplier && filters.supplier !== 'ALL') {
      filtered = filtered.filter(p => 
        p.suppliers.includes('ALL') || 
        p.suppliers.includes(filters.supplier)
      );
    }

    console.log(`🔄 Returning ${filtered.length} fallback prompts`);
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

  /**
   * Save a new prompt to MCP system
   */
  async savePrompt(promptData) {
    try {
      const response = await axios.post(`${this.apiBase}/api/ai/prompts`, promptData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200 || response.status === 201) {
        // Clear cache to force refresh
        this.clearCache();
        console.log(`✅ Prompt saved: ${promptData.name}`);
        return response.data;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Failed to save prompt:', error.message);
      throw error;
    }
  }

  /**
   * Update an existing prompt
   */
  async updatePrompt(promptId, promptData) {
    try {
      const response = await axios.put(`${this.apiBase}/api/ai/prompts/${promptId}`, promptData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        // Clear cache to force refresh
        this.clearCache();
        console.log(`✅ Prompt updated: ${promptId}`);
        return response.data;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Failed to update prompt:', error.message);
      throw error;
    }
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(promptId) {
    try {
      const response = await axios.delete(`${this.apiBase}/api/ai/prompts/${promptId}`, {
        timeout: 10000
      });

      if (response.status === 200 || response.status === 204) {
        // Clear cache to force refresh
        this.clearCache();
        console.log(`✅ Prompt deleted: ${promptId}`);
        return true;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Failed to delete prompt:', error.message);
      throw error;
    }
  }

  /**
   * Test a prompt with sample data
   */
  async testPrompt(promptId, testData) {
    try {
      const response = await axios.post(`${this.apiBase}/api/ai/prompts/${promptId}/test`, {
        testData: testData,
        timestamp: new Date().toISOString()
      }, {
        timeout: 30000, // Longer timeout for AI processing
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        console.log(`✅ Prompt test completed: ${promptId}`);
        return response.data;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Failed to test prompt:', error.message);
      throw error;
    }
  }

  /**
   * Get prompt usage analytics
   */
  async getPromptAnalytics(timeframe = '7d') {
    try {
      const response = await axios.get(`${this.apiBase}/api/ai/prompts/analytics?timeframe=${timeframe}`, {
        timeout: 10000
      });

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.warn('❌ Failed to get prompt analytics:', error.message);
      return null;
    }
  }

  /**
   * Search prompts by text content
   */
  async searchPrompts(query, filters = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        ...filters
      });

      const response = await axios.get(`${this.apiBase}/api/ai/prompts/search?${params}`, {
        timeout: 10000
      });

      if (response.status === 200) {
        return response.data.prompts || response.data.data || [];
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.warn('❌ Failed to search prompts:', error.message);
      // Fallback to local search
      return this.searchFallbackPrompts(query, filters);
    }
  }

  /**
   * Search fallback prompts locally
   */
  searchFallbackPrompts(query, filters = {}) {
    const queryLower = query.toLowerCase();
    
    return this.fallbackPrompts.filter(prompt => {
      const matchesQuery = 
        prompt.name.toLowerCase().includes(queryLower) ||
        prompt.description?.toLowerCase().includes(queryLower) ||
        prompt.prompt.toLowerCase().includes(queryLower);

      const matchesFilters = Object.keys(filters).every(key => {
        if (filters[key] === undefined || filters[key] === null) return true;
        return prompt[key] === filters[key];
      });

      return matchesQuery && matchesFilters;
    });
  }
}

module.exports = MCPPromptService;
