//services/ai/PromptManager.js - UPDATED WITH MISSING METHODS
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PromptManager {
  constructor() {
    this.promptsPath = path.join(__dirname, '../../data/ai/prompts.json');
    this.prompts = new Map();
    this.loadPrompts();
  }

  async loadPrompts() {
    try {
      const data = await fs.readFile(this.promptsPath, 'utf8');
      const prompts = JSON.parse(data);
      
      prompts.forEach(prompt => {
        this.prompts.set(prompt.id, prompt);
      });
      
      console.log(`✅ Loaded ${prompts.length} AI prompts`);
    } catch (error) {
      console.log('🔄 Creating default prompts configuration...');
      await this.createDefaultPrompts();
    }
  }

  async createDefaultPrompts() {
    const defaultPrompts = [
      {
        id: 'po_extraction_base',
        name: 'Purchase Order - Base Extraction',
        moduleId: 'document_extraction',
        category: 'purchase_order',
        version: '1.3.0',
        isActive: true,
        documentTypes: ['pdf', 'image'],
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        prompt: `Extract purchase order information with PRECISE table column identification.

CRITICAL RULES FOR HIGGSFLOW:
1. ALWAYS identify exact column order from table headers
2. QUANTITY vs UNIT PRICE identification:
   - Quantity: Usually smaller numbers (1-10,000 range)
   - Unit Price: Usually larger monetary values with decimals ($100.00, $2,200.00)
3. VALIDATION: quantity × unitPrice should ≈ totalPrice
4. If calculation mismatch > 10%, SWAP values and re-check

COMMON PO TABLE PATTERNS:
- Line | Part Number | Description | Quantity | UOM | Unit Price | Amount
- Line | Part Number | Delivery Date | Quantity | UOM | Unit Price | TAX | Amount

RETURN STRUCTURED JSON:
{
  "purchase_order": {
    "poNumber": "string",
    "dateIssued": "string", 
    "supplier": {
      "name": "string",
      "address": "string"
    },
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
        performance: { accuracy: 92, speed: 2.3, tokens: 1250, lastTested: null }
      },
      {
        id: 'ptp_supplier_specific',
        name: 'PTP Supplier - Enhanced Extraction',
        moduleId: 'document_extraction',
        category: 'purchase_order',
        version: '1.1.0',
        isActive: true,
        documentTypes: ['pdf'],
        suppliers: ['PTP', 'PT. PERINTIS TEKNOLOGI PERDANA'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        prompt: `PTP Purchase Order - SPECIALIZED EXTRACTION for PT. PERINTIS TEKNOLOGI PERDANA

TABLE LAYOUT: Line | Part Number | Delivery Date | Quantity | UOM | Unit Price | TAX | Amount

CRITICAL PTP-SPECIFIC RULES:
1. Quantity in column 4 (after Delivery Date)
2. Unit Price in column 6 (after UOM)
3. Amount in column 8 (final column)
4. Part numbers: 200RTG*, 400CON*, 400SHA*, 400RTG*

⚠️ SPECIAL PTP MULTI-LINE FORMAT:
- Line 1: "400QCR1068    1.00   PCS   20,500.00"
- Line 2: "THRUSTER" ← This is the ACTUAL product name
- DO NOT extract UOM values (PCS, UNI, SET, EA) as product names!

VALIDATION FOR PTP:
- quantity × unitPrice = amount (±5% tolerance)
- If mismatch detected, check for column misalignment

RETURN PTP-OPTIMIZED JSON:
{
  "purchase_order": {
    "supplier": {
      "name": "PT. PERINTIS TEKNOLOGI PERDANA",
      "type": "PTP_TEMPLATE"
    },
    "items": [
      {
        "productCode": "400QCR1068",
        "productName": "THRUSTER",
        "quantity": 1,
        "unit": "PCS",
        "unitPrice": 20500.00,
        "totalPrice": 20500.00,
        "extractionNotes": "Multi-line format processed"
      }
    ]
  },
  "metadata": {
    "supplier": "PTP",
    "extractionMethod": "PTP_SPECIALIZED",
    "confidence": 0.95
  }
}`,
        performance: { accuracy: 96, speed: 2.1, tokens: 980, lastTested: null }
      },
      {
        id: 'pi_extraction_base',
        name: 'Proforma Invoice - Base Extraction',
        moduleId: 'document_extraction',
        category: 'proforma_invoice',
        version: '1.1.0',
        isActive: true,
        documentTypes: ['pdf', 'email'],
        suppliers: ['ALL'],
        aiProvider: 'deepseek',
        temperature: 0.1,
        maxTokens: 2000,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        prompt: `Extract proforma invoice information for HiggsFlow procurement system.

PROFORMA INVOICE PARSING RULES:
1. Identify PI number, date, validity period
2. Extract complete supplier and buyer information
3. Parse itemized products with accurate pricing
4. Calculate totals including taxes and terms

KEY FIELDS TO EXTRACT:
- PI Number (usually starts with "PI", "PRO", or numeric)
- Issue date and validity date
- Supplier details (name, address, contact)
- Buyer information
- Itemized products with quantities and prices
- Payment and delivery terms

RETURN STRUCTURED JSON:
{
  "proforma_invoice": {
    "piNumber": "string",
    "date": "string",
    "validityPeriod": "string",
    "supplier": {
      "name": "string",
      "address": "string",
      "contact": "string"
    },
    "buyer": {
      "name": "string",
      "address": "string"
    },
    "items": [
      {
        "productCode": "string",
        "productName": "string",
        "quantity": number,
        "unit": "string",
        "unitPrice": number,
        "totalPrice": number
      }
    ],
    "totals": {
      "subtotal": number,
      "tax": number,
      "shipping": number,
      "grandTotal": number
    },
    "terms": {
      "payment": "string",
      "delivery": "string"
    }
  }
}`,
        performance: { accuracy: 88, speed: 2.1, tokens: 980, lastTested: null }
      }
    ];

    // Save to prompts map
    defaultPrompts.forEach(prompt => {
      this.prompts.set(prompt.id, prompt);
    });

    // Save to file
    await this.savePrompts();
    console.log('✅ Created default HiggsFlow AI prompts');
  }

  async savePrompts() {
    try {
      const promptsArray = Array.from(this.prompts.values());
      
      // Ensure directory exists
      const dir = path.dirname(this.promptsPath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(this.promptsPath, JSON.stringify(promptsArray, null, 2));
      return true;
    } catch (error) {
      console.error('❌ Failed to save prompts:', error);
      return false;
    }
  }

  // Get best prompt for task (core intelligence)
  async getPromptForTask(moduleId, taskCategory, context = {}) {
    const modulePrompts = Array.from(this.prompts.values())
      .filter(p => p.moduleId === moduleId && p.isActive);

    if (modulePrompts.length === 0) return null;

    let bestPrompt = null;
    let bestScore = 0;

    for (const prompt of modulePrompts) {
      let score = 0;

      // Category match (highest priority)
      if (prompt.category === taskCategory) score += 100;

      // Document type match
      if (context.documentType && prompt.documentTypes?.includes(context.documentType)) {
        score += 50;
      }

      // Supplier match (critical for HiggsFlow)
      if (context.supplier) {
        if (prompt.suppliers?.includes('ALL')) {
          score += 20;
        } else if (prompt.suppliers?.includes(context.supplier)) {
          score += 80; // High bonus for exact supplier match
        } else if (prompt.suppliers?.some(s => context.supplierName?.includes(s))) {
          score += 60; // Good bonus for supplier name match
        }
      }

      // Performance bonus
      score += (prompt.performance?.accuracy || 0) / 10;

      if (score > bestScore) {
        bestScore = score;
        bestPrompt = prompt;
      }
    }

    console.log(`🎯 Selected prompt: ${bestPrompt?.name} (score: ${bestScore})`);
    return bestPrompt;
  }

  // 🔧 NEW: Get individual prompt
  async getPrompt(promptId) {
    try {
      const prompt = this.prompts.get(promptId);
      
      if (prompt) {
        console.log(`✅ Retrieved prompt: ${promptId} - ${prompt.name}`);
        return prompt;
      } else {
        console.log(`⚠️ Prompt not found: ${promptId}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error getting prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // Save or update prompt (enhanced version)
  async savePrompt(promptData) {
    try {
      const prompt = {
        id: promptData.id || `prompt_${uuidv4()}`,
        ...promptData,
        lastModified: new Date().toISOString(),
        version: promptData.version || '1.0.0'
      };

      // If this is a new prompt without createdAt, add it
      if (!prompt.createdAt) {
        prompt.createdAt = new Date().toISOString();
      }

      this.prompts.set(prompt.id, prompt);
      const success = await this.savePrompts();
      
      if (success) {
        console.log(`✅ Prompt saved: ${prompt.id} - ${prompt.name}`);
      } else {
        console.error(`❌ Failed to save prompt: ${prompt.id}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error saving prompt:', error.message);
      throw error;
    }
  }

  // 🔧 NEW: Update existing prompt
  async updatePrompt(promptId, promptData) {
    try {
      const existingPrompt = this.prompts.get(promptId);
      
      if (!existingPrompt) {
        console.log(`⚠️ Prompt not found for update: ${promptId}, creating new one`);
        // If doesn't exist, create it with the specified ID
        return await this.savePrompt({ ...promptData, id: promptId });
      }

      const updatedPrompt = {
        ...existingPrompt,
        ...promptData,
        id: promptId, // Ensure ID doesn't change
        lastModified: new Date().toISOString(),
        // Preserve createdAt from original
        createdAt: existingPrompt.createdAt
      };

      this.prompts.set(promptId, updatedPrompt);
      const success = await this.savePrompts();

      if (success) {
        console.log(`✅ Prompt updated: ${promptId} - ${updatedPrompt.name}`);
      } else {
        console.error(`❌ Failed to update prompt: ${promptId}`);
      }

      return success;
    } catch (error) {
      console.error(`❌ Error updating prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // 🔧 NEW: Delete prompt
  async deletePrompt(promptId) {
    try {
      const existingPrompt = this.prompts.get(promptId);
      
      if (!existingPrompt) {
        console.log(`⚠️ Prompt not found for deletion: ${promptId}`);
        return false;
      }

      // Remove from memory
      this.prompts.delete(promptId);
      
      // Save to file
      const success = await this.savePrompts();

      if (success) {
        console.log(`✅ Prompt deleted: ${promptId} - ${existingPrompt.name}`);
      } else {
        console.error(`❌ Failed to delete prompt: ${promptId}`);
        // Restore in memory if file save failed
        this.prompts.set(promptId, existingPrompt);
      }

      return success;
    } catch (error) {
      console.error(`❌ Error deleting prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // Test prompt performance (enhanced)
  async testPrompt(promptId, testData) {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${promptId}`);
    }

    try {
      // Simulate test results (replace with actual AI call)
      const testResult = {
        success: true,
        promptId,
        promptName: prompt.name,
        testData,
        result: {
          accuracy: Math.random() * 0.2 + 0.8, // 80-100%
          responseTime: Math.random() * 2000 + 1000, // 1-3 seconds
          tokens: Math.floor(prompt.prompt.length * 1.2),
          confidence: Math.random() * 0.3 + 0.7, // 70-100%
          provider: prompt.aiProvider || 'deepseek'
        },
        metadata: {
          promptVersion: prompt.version,
          category: prompt.category,
          suppliers: prompt.suppliers,
          testTimestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      // Update prompt performance data
      prompt.performance = {
        ...prompt.performance,
        lastTested: new Date().toISOString(),
        testCount: (prompt.performance?.testCount || 0) + 1
      };

      // Save updated prompt
      await this.savePrompts();

      console.log(`✅ Prompt tested: ${promptId} - Confidence: ${testResult.result.confidence.toFixed(2)}`);
      
      return testResult;
    } catch (error) {
      console.error(`❌ Error testing prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // Get all prompts
  getAllPrompts() {
    return Array.from(this.prompts.values());
  }

  // Get prompts by module
  getPromptsByModule(moduleId) {
    return Array.from(this.prompts.values()).filter(p => p.moduleId === moduleId);
  }

  // 🔧 NEW: Get prompts by category
  getPromptsByCategory(category) {
    return Array.from(this.prompts.values()).filter(p => p.category === category);
  }

  // 🔧 NEW: Get active prompts only
  getActivePrompts() {
    return Array.from(this.prompts.values()).filter(p => p.isActive);
  }

  // 🔧 NEW: Get prompts by supplier
  getPromptsBySupplier(supplier) {
    return Array.from(this.prompts.values()).filter(p => 
      p.suppliers?.includes('ALL') || p.suppliers?.includes(supplier)
    );
  }

  // 🔧 NEW: Get prompt statistics
  getPromptStats() {
    const prompts = this.getAllPrompts();
    
    return {
      total: prompts.length,
      active: prompts.filter(p => p.isActive).length,
      inactive: prompts.filter(p => !p.isActive).length,
      byCategory: prompts.reduce((acc, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {}),
      byProvider: prompts.reduce((acc, p) => {
        const provider = p.aiProvider || 'unknown';
        acc[provider] = (acc[provider] || 0) + 1;
        return acc;
      }, {}),
      tested: prompts.filter(p => p.performance?.lastTested).length,
      averageAccuracy: prompts
        .filter(p => p.performance?.accuracy)
        .reduce((sum, p) => sum + p.performance.accuracy, 0) / 
        prompts.filter(p => p.performance?.accuracy).length || 0
    };
  }

  // 🔧 NEW: Validate prompt data
  validatePromptData(promptData) {
    const errors = [];

    if (!promptData.name || promptData.name.trim() === '') {
      errors.push('Prompt name is required');
    }

    if (!promptData.prompt || promptData.prompt.trim() === '') {
      errors.push('Prompt content is required');
    }

    if (!promptData.category || promptData.category.trim() === '') {
      errors.push('Prompt category is required');
    }

    if (!promptData.aiProvider || promptData.aiProvider.trim() === '') {
      errors.push('AI provider is required');
    }

    if (promptData.temperature && (promptData.temperature < 0 || promptData.temperature > 2)) {
      errors.push('Temperature must be between 0 and 2');
    }

    if (promptData.maxTokens && (promptData.maxTokens < 1 || promptData.maxTokens > 8000)) {
      errors.push('Max tokens must be between 1 and 8000');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = PromptManager;
