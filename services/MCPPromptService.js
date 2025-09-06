// services/MCPPromptService.js - Bridge between extraction and MCP Tools
const axios = require('axios');

class MCPPromptService {
  constructor() {
    this.apiBase = process.env.MCP_SERVER_URL || 'https://supplier-mcp-server-production.up.railway.app';
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.fallbackPrompts = this.createFallbackPrompts();
    this.requestTimeout = 15000; // Increased timeout for better reliability
    this.retryAttempts = 2; // Add retry mechanism
  }

  /**
   * Get the best prompt for a specific task with enhanced context handling
   * @param {string} moduleId - e.g., 'document_extraction'
   * @param {string} category - e.g., 'purchase_order', 'proforma_invoice', 'bank_payment'
   * @param {Object} context - { supplier, user, documentType, fileInfo }
   * @returns {Object|null} Selected prompt or null if none found
   */
  async getPromptForTask(moduleId, category, context = {}) {
    try {
      console.log(`🔍 MCPPromptService: Looking for prompt - ${moduleId}/${category}`);
      console.log(`📋 Context:`, {
        supplier: context.supplier || 'ANY',
        user: context.user?.email || 'anonymous',
        documentType: context.documentType || category,
        fileInfo: context.fileInfo?.originalname || 'unknown'
      });
      
      // Get all prompts for this category
      const prompts = await this.getPromptsWithRetry({ category, active: true });
      
      if (!prompts || prompts.length === 0) {
        console.log(`⚠️ No MCP prompts found for category: ${category}`);
        console.log(`🔄 Attempting fallback prompt search...`);
        return this.getFallbackPromptForCategory(category, context);
      }

      // Score and select best prompt
      const bestPrompt = this.selectBestPrompt(prompts, context);
      
      if (bestPrompt) {
        console.log(`✅ Selected MCP prompt: ${bestPrompt.name} (score: ${bestPrompt._score})`);
        console.log(`📊 Prompt details:`, {
          id: bestPrompt.id,
          version: bestPrompt.version,
          category: bestPrompt.category,
          suppliers: bestPrompt.suppliers
        });
        
        // Track usage (fire and forget)
        this.trackPromptUsage(bestPrompt.id, context).catch(console.warn);
        
        return bestPrompt;
      } else {
        console.log(`❌ No suitable MCP prompt found for context`);
        console.log(`🔄 Falling back to default prompts...`);
        return this.getFallbackPromptForCategory(category, context);
      }
    } catch (error) {
      console.error('❌ MCPPromptService error:', error.message);
      console.log(`🔄 Using fallback prompts due to error...`);
      return this.getFallbackPromptForCategory(category, context);
    }
  }

  /**
   * Get prompts from MCP API with caching and retry mechanism
   */
  async getPromptsWithRetry(filters = {}, attempt = 1) {
    try {
      return await this.getPrompts(filters);
    } catch (error) {
      if (attempt < this.retryAttempts) {
        console.log(`🔄 Retry attempt ${attempt + 1} for MCP API...`);
        await this.delay(1000 * attempt); // Progressive delay
        return this.getPromptsWithRetry(filters, attempt + 1);
      }
      throw error;
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
        timeout: this.requestTimeout,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HiggsFlow-MCPPromptService/1.1',
          'X-Request-Source': 'extraction-service'
        }
      });

      if (response.status === 200) {
        const prompts = response.data.data || response.data.prompts || response.data || [];
        
        // Validate prompts structure
        const validPrompts = prompts.filter(prompt => 
          prompt && prompt.id && prompt.name && prompt.category
        );
        
        if (validPrompts.length !== prompts.length) {
          console.warn(`⚠️ Filtered ${prompts.length - validPrompts.length} invalid prompts`);
        }
        
        // Cache the result
        this.cache.set(cacheKey, {
          data: validPrompts,
          timestamp: Date.now()
        });
        
        console.log(`✅ Fetched ${validPrompts.length} valid prompts from MCP API`);
        return validPrompts;
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
   * Enhanced prompt selection with better scoring algorithm
   */
  selectBestPrompt(prompts, context) {
    console.log(`🎯 Selecting best prompt from ${prompts.length} candidates`);
    console.log(`📝 Context details:`, {
      supplier: context.supplier,
      documentType: context.documentType,
      userEmail: context.user?.email,
      fileName: context.fileInfo?.originalname
    });
    
    const scored = prompts.map(prompt => {
      let score = 0;
      const reasons = [];
      
      // 🔥 CRITICAL: Document Type Category Matching (HIGHEST PRIORITY)
      if (context.documentType) {
        const docType = context.documentType.toLowerCase();
        const promptCategory = prompt.category?.toLowerCase();
        const promptName = prompt.name?.toLowerCase() || '';
        
        console.log(`🔍 Evaluating prompt "${prompt.name}" for document type "${docType}"`);
        
        // 1. EXACT CATEGORY MATCH - Highest Priority
        if (promptCategory === docType || 
            (docType.includes('bank_payment') && promptCategory === 'bank_payment') ||
            (docType.includes('purchase') && promptCategory === 'purchase_order') ||
            (docType.includes('proforma') && promptCategory === 'proforma_invoice')) {
          score += 1000;
          reasons.push(`EXACT category match: ${promptCategory} (+1000)`);
        }
        
        // 2. WRONG CATEGORY - Immediate Rejection
        else if (
          (docType.includes('bank_payment') && (promptCategory === 'purchase_order' || promptCategory === 'proforma_invoice')) ||
          (docType.includes('purchase') && (promptCategory === 'proforma_invoice' || promptCategory === 'bank_payment')) ||
          (docType.includes('proforma') && (promptCategory === 'purchase_order' || promptCategory === 'bank_payment'))
        ) {
          score = -1000;
          reasons.push(`WRONG category: ${promptCategory} for ${docType} (-1000) - REJECTED`);
        }
        
        // 3. NAME-BASED MATCHING (only if not already rejected)
        if (score >= 0) {
          if (docType.includes('bank') && promptName.includes('bank')) {
            score += 800;
            reasons.push(`Bank name match (+800)`);
          }
          if (docType.includes('payment') && promptName.includes('payment')) {
            score += 800;
            reasons.push(`Payment name match (+800)`);
          }
          if (docType.includes('purchase') && promptName.includes('purchase')) {
            score += 700;
            reasons.push(`Purchase name match (+700)`);
          }
          if (docType.includes('proforma') && promptName.includes('proforma')) {
            score += 700;
            reasons.push(`Proforma name match (+700)`);
          }
        }
      }
      
      // 🏢 SUPPLIER MATCHING (only if not rejected)
      if (score >= 0 && context.supplier && prompt.suppliers) {
        const supplierMatch = prompt.suppliers.find(s => 
          s.toLowerCase() === context.supplier.toLowerCase() ||
          context.supplier.toLowerCase().includes(s.toLowerCase()) ||
          s.toLowerCase().includes(context.supplier.toLowerCase())
        );
        
        if (supplierMatch && supplierMatch !== 'ALL') {
          score += 300;
          reasons.push(`Supplier match: ${supplierMatch} (+300)`);
        } else if (prompt.suppliers.includes('ALL')) {
          score += 150;
          reasons.push(`Universal supplier (+150)`);
        }
      }
      
      // 👤 USER TARGETING (only if not rejected)
      if (score >= 0 && context.user?.email && prompt.targetUsers) {
        if (prompt.targetUsers.includes(context.user.email)) {
          score += 200;
          reasons.push(`User targeting (+200)`);
        }
      }
      
      // 📊 PERFORMANCE METRICS (only if not rejected)
      if (score >= 0 && prompt.performance) {
        const perfScore = (prompt.performance.accuracy || 0) * 2;
        score += perfScore;
        if (perfScore > 0) {
          reasons.push(`Performance: ${prompt.performance.accuracy}% (+${perfScore})`);
        }
      }
      
      // 🔢 VERSION PREFERENCE (only if not rejected)
      if (score >= 0 && prompt.version) {
        const versionScore = this.getVersionScore(prompt.version);
        score += versionScore;
        if (versionScore > 0) {
          reasons.push(`Version: ${prompt.version} (+${versionScore})`);
        }
      }
      
      // 🎯 PRIORITY PREFIXES (only if not rejected)
      if (score >= 0 && prompt.name) {
        if (prompt.name.match(/^(A\s*-|AAA|PRIORITY)/i)) {
          score += 500;
          reasons.push(`Priority prefix (+500)`);
        }
      }
      
      console.log(`📊 Prompt "${prompt.name}" scored: ${score}`);
      if (reasons.length > 0) {
        console.log(`   Reasons: ${reasons.join(', ')}`);
      }
      
      return { ...prompt, _score: score, _reasons: reasons };
    });
    
    // Sort by score (highest first)
    const sorted = scored.sort((a, b) => b._score - a._score);
    
    console.log('🏆 Top 3 scoring prompts:');
    sorted.slice(0, 3).forEach((prompt, i) => {
      console.log(`   ${i + 1}. ${prompt.name} (score: ${prompt._score})`);
      if (prompt._reasons.length > 0) {
        console.log(`      ${prompt._reasons.join(', ')}`);
      }
    });
    
    const bestPrompt = sorted[0];
    
    // 🚨 CRITICAL: Only return prompts with positive scores
    if (bestPrompt && bestPrompt._score > 0) {
      console.log(`✅ Selected: ${bestPrompt.name} with score ${bestPrompt._score}`);
      return bestPrompt;
    } else {
      console.log(`❌ No suitable prompt found - best score: ${bestPrompt?._score || 'none'}`);
      console.log('💡 Reason: No category-matched prompts available or all prompts rejected');
      return null;
    }
  }

  /**
   * Get fallback prompt for specific category
   */
  getFallbackPromptForCategory(category, context = {}) {
    console.log(`🔄 Getting fallback prompt for category: ${category}`);
    
    const fallbacks = this.getFallbackPrompts({ category, active: true });
    
    if (fallbacks.length > 0) {
      // Apply same selection logic to fallbacks
      const selected = this.selectBestPrompt(fallbacks, context);
      if (selected) {
        console.log(`✅ Using fallback prompt: ${selected.name}`);
        return selected;
      }
    }
    
    // If no category-specific fallback, get general fallback
    const generalFallback = this.fallbackPrompts.find(p => 
      p.category === category || p.suppliers.includes('ALL')
    );
    
    if (generalFallback) {
      console.log(`✅ Using general fallback prompt: ${generalFallback.name}`);
      return generalFallback;
    }
    
    console.log(`❌ No fallback prompt available for category: ${category}`);
    return null;
  }

  /**
   * Enhanced version scoring
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
   * Track prompt usage analytics with enhanced context
   */
  async trackPromptUsage(promptId, context) {
    try {
      const payload = {
        context: {
          ...context,
          timestamp: new Date().toISOString(),
          userAgent: 'HiggsFlow-MCPPromptService/1.1'
        },
        system: 'dual_extraction',
        version: '1.1'
      };

      await axios.post(`${this.apiBase}/api/ai/prompts/${promptId}/usage`, payload, { 
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Source': 'extraction-service'
        }
      });
      
      console.log(`📈 Usage tracked for prompt: ${promptId}`);
    } catch (error) {
      // Silently fail - analytics shouldn't break extraction
      console.warn('📊 Analytics tracking failed:', error.message);
    }
  }

  /**
   * Enhanced health check with detailed diagnostics
   */
  async healthCheck() {
    try {
      const startTime = Date.now();
      const response = await axios.get(`${this.apiBase}/api/ai/health`, {
        timeout: 5000,
        headers: {
          'User-Agent': 'HiggsFlow-MCPPromptService/1.1'
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        apiUrl: this.apiBase,
        responseTime: `${responseTime}ms`,
        apiResponseTime: response.headers['x-response-time'] || 'unknown',
        timestamp: new Date().toISOString(),
        cacheSize: this.cache.size,
        fallbackPromptsCount: this.fallbackPrompts.length
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        apiUrl: this.apiBase,
        error: error.message,
        timestamp: new Date().toISOString(),
        cacheSize: this.cache.size,
        fallbackPromptsCount: this.fallbackPrompts.length,
        fallbackAvailable: true
      };
    }
  }

  /**
   * Utility function for delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get count of available MCP prompts
   */
  async getPromptCount() {
    try {
      const prompts = await this.getPrompts();
      return prompts.length;
    } catch {
      return this.fallbackPrompts.length;
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
   * Enhanced fallback prompts with better bank payment support
   */
  createFallbackPrompts() {
    return [
      {
        id: 'fallback_bp_base',
        name: 'A - Bank Payment - Enhanced Extraction (Fallback)',
        category: 'bank_payment',
        version: '1.2.0',
        isActive: true,
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Enhanced fallback prompt for bank payment documents',
        prompt: `Extract bank payment information with ENHANCED accuracy for Malaysian banking documents.

CRITICAL BANK PAYMENT RULES:
1. This is a BANK PAYMENT document from Malaysian financial institutions
2. Look for payment reference numbers, transaction IDs, and bank reference codes
3. Extract BOTH payer (sender) and payee (recipient) information
4. Identify payment method: Online Banking, GIRO, Cheque, Wire Transfer, etc.
5. Currency is typically MYR (Malaysian Ringgit) but may be USD, SGD, etc.
6. Extract payment purpose/description and any reference codes

Common Malaysian Bank Formats:
- Reference: TT240901001234567
- Transaction ID: FT24090112345678
- Payment Date: DD/MM/YYYY or DD-MM-YYYY
- Amount: RM 1,234.56 or MYR 1,234.56

ENHANCED EXTRACTION RULES:
1. **Payment Reference**: Look for TT, FT, IBG, GIRO reference numbers
2. **Bank Details**: Extract both sender and recipient bank names, account numbers
3. **Payment Purpose**: Extract description, invoice references, project codes
4. **Fees**: Look for bank charges, processing fees, total deducted amounts
5. **Exchange Rates**: If foreign currency, extract conversion rates

RETURN STRUCTURED JSON:
{
  "bank_payment": {
    "paymentReference": "string",
    "transactionId": "string",
    "paymentDate": "string",
    "paymentMethod": "string",
    "payer": {
      "name": "string",
      "accountNumber": "string",
      "bankName": "string",
      "address": "string"
    },
    "payee": {
      "name": "string",
      "accountNumber": "string",
      "bankName": "string",
      "address": "string"
    },
    "amount": {
      "value": number,
      "currency": "string",
      "exchangeRate": number
    },
    "purpose": "string",
    "description": "string",
    "fees": {
      "processingFee": number,
      "bankCharges": number,
      "totalDeducted": number
    },
    "status": "string"
  }
}`,
        performance: { accuracy: 88, speed: 2.8, tokens: 1800 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      },
      {
        id: 'fallback_po_enhanced',
        name: 'A - Purchase Order - Enhanced Extraction (Fallback)',
        category: 'purchase_order',
        version: '1.2.0',
        isActive: true,
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Enhanced fallback prompt for purchase orders with better project code detection',
        prompt: `Extract purchase order information with ENHANCED table column identification and project code detection.

CRITICAL TABLE PARSING RULES:
1. ALWAYS identify exact column order from table header
2. Enhanced PO table patterns:
   - Line | Part Number | Description | Delivery Date | Quantity | UOM | Unit Price | Amount | Project Code
   - No. | Item Code | Item Description | Qty | Unit | Rate | Total | Project

3. ENHANCED QUANTITY vs UNIT PRICE identification:
   - Quantity: Usually smaller numbers (1-10,000 range), whole numbers or decimals
   - Unit Price: Usually larger monetary values with decimals, currency symbols
   - Look for currency patterns: "RM 100.00", "USD 2,200.00", "$1,500.00"
   - Cross-validate: quantity × unitPrice should ≈ totalPrice

4. ENHANCED VALIDATION RULES:
   - If calculation mismatch > 5%, flag for review
   - If SWAP needed, document the correction in extraction notes
   - Validate UOM against standard units (PCS, SET, EA, KG, M, etc.)

5. ENHANCED PROJECT CODE EXTRACTION:
   - Project codes: FS-S3798, BWS-S1046, PRJ-2024-001, etc.
   - Look in: blue text, separate columns, item descriptions, headers
   - May appear per line item or as header reference
   - Format patterns: [2-4 letters]-[alphanumeric], PRJ-[year]-[number]

6. SUPPLIER-SPECIFIC ENHANCEMENTS:
   - PTP: Multi-line format with description below part number
   - Chinese suppliers: Look for model numbers and brand information
   - Local suppliers: Check for SST/GST tax information

RETURN ENHANCED STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string",
    "deliveryDate": "string",
    "supplier": { 
      "name": "string", 
      "address": "string", 
      "contact": "string",
      "email": "string"
    },
    "buyer": {
      "name": "string",
      "address": "string",
      "contact": "string"
    },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number,
        "projectCode": "string",
        "deliveryDate": "string",
        "notes": "string"
      }
    ],
    "totals": {
      "subtotal": number,
      "tax": number,
      "totalAmount": number,
      "currency": "string"
    },
    "terms": {
      "payment": "string",
      "delivery": "string",
      "warranty": "string"
    },
    "extractionNotes": "string"
  }
}`,
        performance: { accuracy: 90, speed: 2.3, tokens: 1600 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      },
      {
        id: 'fallback_pi_enhanced',
        name: 'A - Proforma Invoice - Enhanced Extraction (Fallback)',
        category: 'proforma_invoice',
        version: '1.2.0',
        isActive: true,
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Enhanced fallback PI prompt with better Chinese supplier support',
        prompt: `Extract proforma invoice information from Chinese supplier documents with ENHANCED accuracy.
    
CRITICAL PI-SPECIFIC RULES:
1. This is a PROFORMA INVOICE (PI) from Chinese supplier to Malaysian buyer
2. Enhanced table format: Sr NO | ITEMS NAME | MODEL | BRAND | QUANTITY | UNIT PRICE | TOTAL PRICE
3. Extract ALL items with complete brand and model information
4. Enhanced currency handling: USD, EUR, CNY with proper symbol recognition
5. Shipping terms: FOB, CIF, EXW, DDP with enhanced detection
6. Payment terms: T/T, L/C, Western Union with percentage breakdowns

ENHANCED EXTRACTION RULES:
1. **Brand Recognition**: SKF, FAG, NSK, NTN, TIMKEN, KOYO, etc.
2. **Model Numbers**: Complex alphanumeric codes (HM518445/10, 32222, etc.)
3. **Shipping Costs**: Separate air freight, sea freight, express delivery
4. **Lead Times**: Production time, shipping time, total delivery time
5. **Validity**: PI validity period, price validity, terms expiration

Enhanced Chinese Supplier Patterns:
- 型号 (Model): Technical part numbers
- 品牌 (Brand): International bearing brands
- 数量 (Quantity): Order quantities
- 单价 (Unit Price): Per piece pricing
- 总价 (Total Price): Line totals

RETURN ENHANCED STRUCTURED JSON:
{
  "proforma_invoice": {
    "piNumber": "string",
    "date": "string",
    "validUntil": "string",
    "supplier": { 
      "name": "string", 
      "contact": "string",
      "email": "string",
      "phone": "string",
      "address": "string",
      "country": "string"
    },
    "buyer": { 
      "name": "string", 
      "contact": "string",
      "email": "string",
      "phone": "string",
      "address": "string",
      "country": "string"
    },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string",
        "model": "string",
        "brand": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number,
        "specifications": "string",
        "origin": "string"
      }
    ],
    "totals": {
      "subtotal": number,
      "freight": {
        "air": number,
        "sea": number,
        "express": number,
        "method": "string"
      },
      "totalCost": number,
      "currency": "string"
    },
    "terms": {
      "payment": "string",
      "paymentPercent": "string",
      "delivery": "string",
      "leadTime": "string",
      "packaging": "string",
      "shipping": "string",
      "incoterm": "string"
    },
    "validity": {
      "priceValid": "string",
      "piValid": "string",
      "deliveryTime": "string"
    }
  }
}`,
        performance: { accuracy: 87, speed: 2.5, tokens: 1800 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      },
      {
        id: 'fallback_ptp_enhanced',
        name: 'AAA - PTP Supplier - Enhanced Extraction (Fallback)',
        category: 'purchase_order',
        version: '1.2.0',
        isActive: true,
        suppliers: ['PTP', 'PT. PERINTIS TEKNOLOGI PERDANA', 'PERINTIS'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2500,
        description: 'Enhanced PTP-specific prompt with better multi-line handling',
        prompt: `Extract purchase order information from PT. PERINTIS TEKNOLOGI PERDANA with ENHANCED multi-line parsing.
    
CRITICAL PTP-SPECIFIC RULES:
1. PTP uses COMPLEX multi-line format where product information spans multiple lines
2. Enhanced format recognition:
   Line | Part Number | Quantity | UOM | Price
   [space] | Product Description (indented on next line)
   [space] | Additional specifications or notes

3. ENHANCED PARSING RULES:
   - NEVER use UOM values (PCS, UNI, SET, EA, UNIT) as product names
   - Product description is ALWAYS on the line below the part number
   - Look for indentation patterns and text formatting
   - Specifications may span multiple continuation lines

4. PTP PRODUCT PATTERNS:
   - Marine equipment: THRUSTER, WINCH, PUMP, VALVE
   - Rubber products: RUBBER HOSE, GASKET, SEAL
   - Technical parts: COUPLING, BEARING, FILTER

Enhanced PTP Format Example:
Line  Part Number                    Qty    UOM   Price
1     400QCR1068                     1.00   PCS   20,500.00
      THRUSTER - TUNNEL BOW          <-- Main product name
      Technical specifications...     <-- Additional details
2     B247K18x12x1000               10.00   UNI   325,000.00  
      RUBBER HOSE - HYDRAULIC        <-- Main product name
      Pressure rating: 250 BAR      <-- Specifications

ENHANCED EXTRACTION RULES:
5. **Project Code Detection**: Look for project references in headers, footers, or line items
6. **Delivery Terms**: Extract specific delivery dates and locations
7. **Technical Specs**: Capture detailed specifications for marine/industrial equipment
8. **Currency**: Handle both IDR (Indonesian Rupiah) and USD pricing

RETURN ENHANCED STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string",
    "supplier": { 
      "name": "string", 
      "address": "string", 
      "contact": "string",
      "country": "Indonesia"
    },
    "buyer": {
      "name": "string",
      "address": "string", 
      "contact": "string"
    },
    "items": [
      {
        "lineNumber": number,
        "productCode": "string",
        "productName": "string (NEVER UOM)",
        "specifications": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number,
        "projectCode": "string",
        "category": "string"
      }
    ],
    "totals": {
      "subtotal": number,
      "tax": number,
      "totalAmount": number,
      "currency": "string"
    },
    "terms": {
      "deliveryDate": "string",
      "deliveryLocation": "string",
      "paymentTerms": "string",
      "shipping": "string"
    },
    "extractionNotes": "Enhanced PTP multi-line format processed"
  }
}`,
        performance: { accuracy: 94, speed: 2.1, tokens: 1400 },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      }
    ];
  }

  /**
   * Enhanced fallback prompts filtering
   */
  getFallbackPrompts(filters = {}) {
    console.log('🔄 Using enhanced fallback prompts - MCP API unavailable');
    
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
        p.suppliers.some(s => 
          s.toLowerCase().includes(filters.supplier.toLowerCase()) ||
          filters.supplier.toLowerCase().includes(s.toLowerCase())
        )
      );
    }

    console.log(`🔄 Returning ${filtered.length} enhanced fallback prompts`);
    return filtered;
  }

  // Enhanced API methods with better error handling...

  /**
   * Save a new prompt to MCP system with enhanced validation
   */
  async savePrompt(promptData) {
    try {
      // Validate prompt data
      if (!promptData.name || !promptData.category || !promptData.prompt) {
        throw new Error('Missing required fields: name, category, prompt');
      }

      const response = await axios.post(`${this.apiBase}/api/ai/prompts`, promptData, {
        timeout: this.requestTimeout,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Source': 'extraction-service'
        }
      });

      if (response.status === 200 || response.status === 201) {
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
   * Enhanced search with better fallback handling
   */
  async searchPrompts(query, filters = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        ...filters
      });

      const response = await axios.get(`${this.apiBase}/api/ai/prompts/search?${params}`, {
        timeout: this.requestTimeout,
        headers: {
          'X-Request-Source': 'extraction-service'
        }
      });

      if (response.status === 200) {
        return response.data.prompts || response.data.data || [];
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to search prompts via API:', error.message);
      console.log('🔄 Falling back to local search...');
      return this.searchFallbackPrompts(query, filters);
    }
  }

  /**
   * Enhanced local search with better matching
   */
  searchFallbackPrompts(query, filters = {}) {
    const queryLower = query.toLowerCase();
    
    return this.fallbackPrompts.filter(prompt => {
      const matchesQuery = 
        prompt.name.toLowerCase().includes(queryLower) ||
        prompt.description?.toLowerCase().includes(queryLower) ||
        prompt.prompt.toLowerCase().includes(queryLower) ||
        prompt.category.toLowerCase().includes(queryLower) ||
        prompt.suppliers.some(s => s.toLowerCase().includes(queryLower));

      const matchesFilters = Object.keys(filters).every(key => {
        if (filters[key] === undefined || filters[key] === null) return true;
        
        if (key === 'supplier' && Array.isArray(prompt.suppliers)) {
          return prompt.suppliers.includes('ALL') || 
                 prompt.suppliers.includes(filters[key]);
        }
        
        return prompt[key] === filters[key];
      });

      return matchesQuery && matchesFilters;
    });
  }

  // ... Include all other existing methods (updatePrompt, deletePrompt, testPrompt, getPromptAnalytics) with enhanced error handling
}

module.exports = MCPPromptService;
