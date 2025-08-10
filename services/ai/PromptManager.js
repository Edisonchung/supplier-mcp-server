//services/ai/PromptManager.js - UPDATED WITH FIRESTORE PERSISTENCE
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, writeBatch } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');

class PromptManager {
  constructor() {
    // Initialize Firebase
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID
    };
    
    const app = initializeApp(firebaseConfig);
    this.db = getFirestore(app);
    this.prompts = new Map();
    this.promptsCollection = collection(this.db, 'ai-prompts');
    this.loadPrompts();
  }

  // UPDATED: Load prompts from Firestore instead of file
  async loadPrompts() {
    try {
      console.log('🔄 Loading prompts from Firestore...');
      const querySnapshot = await getDocs(this.promptsCollection);
      this.prompts.clear();
      
      querySnapshot.forEach((doc) => {
        this.prompts.set(doc.id, doc.data());
      });
      
      console.log(`✅ Loaded ${this.prompts.size} AI prompts from Firestore`);
      
      // If no prompts found, create defaults
      if (this.prompts.size === 0) {
        console.log('📝 No prompts found, creating defaults...');
        await this.createDefaultPrompts();
      }
    } catch (error) {
      console.error('❌ Error loading prompts from Firestore:', error);
      console.log('🔄 Creating default prompts as fallback...');
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

    // Save to Firestore
    await this.savePrompts();
    console.log('✅ Created default HiggsFlow AI prompts in Firestore');
  }

  // UPDATED: Save all prompts to Firestore using batch write
  async savePrompts() {
    try {
      console.log('💾 Saving prompts to Firestore...');
      const batch = writeBatch(this.db);
      
      for (const [id, prompt] of this.prompts) {
        const promptRef = doc(this.promptsCollection, id);
        batch.set(promptRef, prompt);
      }
      
      await batch.commit();
      console.log('✅ All prompts saved to Firestore');
      return true;
    } catch (error) {
      console.error('❌ Failed to save prompts to Firestore:', error);
      return false;
    }
  }

  // Get best prompt for task (core intelligence) - UNCHANGED
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

  // Get individual prompt - UNCHANGED
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

  // UPDATED: Save individual prompt to Firestore
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

      // Save to Firestore
      const promptRef = doc(this.promptsCollection, prompt.id);
      await setDoc(promptRef, prompt);
      
      // Update local cache
      this.prompts.set(prompt.id, prompt);
      
      console.log(`✅ Prompt saved to Firestore: ${prompt.id} - ${prompt.name}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving prompt to Firestore:', error.message);
      return false;
    }
  }

  // UPDATED: Update existing prompt in Firestore
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

      // Save to Firestore
      const promptRef = doc(this.promptsCollection, promptId);
      await setDoc(promptRef, updatedPrompt);
      
      // Update local cache
      this.prompts.set(promptId, updatedPrompt);

      console.log(`✅ Prompt updated in Firestore: ${promptId} - ${updatedPrompt.name}`);
      return true;
    } catch (error) {
      console.error(`❌ Error updating prompt ${promptId} in Firestore:`, error.message);
      return false;
    }
  }

  // UPDATED: Delete prompt from Firestore
  async deletePrompt(promptId) {
    try {
      const existingPrompt = this.prompts.get(promptId);
      
      if (!existingPrompt) {
        console.log(`⚠️ Prompt not found for deletion: ${promptId}`);
        return false;
      }

      // Delete from Firestore
      await deleteDoc(doc(this.promptsCollection, promptId));
      
      // Remove from local cache
      this.prompts.delete(promptId);

      console.log(`✅ Prompt deleted from Firestore: ${promptId} - ${existingPrompt.name}`);
      return true;
    } catch (error) {
      console.error(`❌ Error deleting prompt ${promptId} from Firestore:`, error.message);
      // Restore in memory if Firestore delete failed
      if (existingPrompt) {
        this.prompts.set(promptId, existingPrompt);
      }
      return false;
    }
  }

  // Test prompt performance - UNCHANGED but enhanced with Firestore save
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

      // Save updated prompt to Firestore
      await this.savePrompt(prompt);

      console.log(`✅ Prompt tested: ${promptId} - Confidence: ${testResult.result.confidence.toFixed(2)}`);
      
      return testResult;
    } catch (error) {
      console.error(`❌ Error testing prompt ${promptId}:`, error.message);
      throw error;
    }
  }

  // Get all prompts - UNCHANGED
  getAllPrompts() {
    return Array.from(this.prompts.values());
  }

  // Get prompts by module - UNCHANGED
  getPromptsByModule(moduleId) {
    return Array.from(this.prompts.values()).filter(p => p.moduleId === moduleId);
  }

  // Get prompts by category - UNCHANGED
  getPromptsByCategory(category) {
    return Array.from(this.prompts.values()).filter(p => p.category === category);
  }

  // Get active prompts only - UNCHANGED
  getActivePrompts() {
    return Array.from(this.prompts.values()).filter(p => p.isActive);
  }

  // Get prompts by supplier - UNCHANGED
  getPromptsBySupplier(supplier) {
    return Array.from(this.prompts.values()).filter(p => 
      p.suppliers?.includes('ALL') || p.suppliers?.includes(supplier)
    );
  }

  // Get prompt statistics - UNCHANGED
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

  // Validate prompt data - UNCHANGED
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
