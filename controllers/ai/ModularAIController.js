//controllers/ai/ModularAIController.js - UPDATED WITH FIREBASE INTEGRATION FIXES
const UnifiedAIService = require('../../services/ai/UnifiedAIService');

class ModularAIController {
  constructor() {
    this.aiService = new UnifiedAIService();
  }

  // Enhanced document extraction
  async extractDocument(req, res) {
    try {
      const { documentType, supplier, context } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      console.log(`📄 Extracting ${documentType} from ${supplier || 'unknown supplier'}`);

      // Read file content (you might need to adjust based on your existing logic)
      const fs = require('fs').promises;
      const fileContent = await fs.readFile(file.path, 'utf8').catch(() => 
        'Binary file content - processed via existing extraction logic'
      );

      // Process through Unified AI Service
      const result = await this.aiService.extractFromDocument(fileContent, documentType, {
        supplier,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        ...context
      });

      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        console.warn('Failed to cleanup uploaded file:', unlinkError.message);
      }

      res.json({
        success: result.success,
        data: result.result,
        metadata: {
          ...result.metadata,
          modularAI: true,
          originalFile: {
            name: file.originalname,
            size: file.size,
            type: file.mimetype
          }
        }
      });

    } catch (error) {
      console.error('Document extraction error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'modular_ai_extraction'
      });
    }
  }

  // Module management endpoints
  async getAllModules(req, res) {
    try {
      const modules = await this.aiService.getModules();
      res.json({
        success: true,
        data: modules,
        count: modules.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getModule(req, res) {
    try {
      const { moduleId } = req.params;
      const module = await this.aiService.getModule(moduleId);
      
      if (!module) {
        return res.status(404).json({
          success: false,
          error: 'Module not found'
        });
      }

      res.json({
        success: true,
        data: module
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateModule(req, res) {
    try {
      const { moduleId } = req.params;
      const updates = req.body;
      
      const success = await this.aiService.updateModule(moduleId, updates);
      
      if (success) {
        res.json({
          success: true,
          message: 'Module updated successfully'
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Module not found'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 🔧 UPDATED: Prompt management endpoints with Firebase integration
  async getAllPrompts(req, res) {
    try {
      // Wait for AI service initialization
      await this.aiService.initPromise;
      
      const { moduleId } = req.query;
      let prompts;
      
      if (moduleId) {
        prompts = await this.aiService.getPromptsByModule(moduleId);
      } else {
        prompts = await this.aiService.getPrompts();
      }
      
      // Ensure prompts is always an array
      const promptsArray = Array.isArray(prompts) ? prompts : [];
      
      res.json({
        success: true,
        data: promptsArray,
        count: promptsArray.length
      });
    } catch (error) {
      console.error('Error getting prompts:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        data: [], // Ensure data is always present
        count: 0
      });
    }
  }

  // 🔧 UPDATED: Get individual prompt with better error handling
  async getPrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const { id } = req.params;
      const prompt = await this.aiService.getPrompt(id);
      
      if (!prompt) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found'
        });
      }

      res.json({
        success: true,
        data: prompt
      });
    } catch (error) {
      console.error('Error getting prompt:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 🔧 UPDATED: Save prompt with validation and Firebase integration
  async savePrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const promptData = req.body;
      
      // Enhanced validation
      if (!promptData.name || !promptData.prompt) {
        return res.status(400).json({
          success: false,
          error: 'Name and prompt content are required'
        });
      }

      // Add metadata for new prompts
      if (!promptData.id) {
        promptData.createdAt = new Date().toISOString();
        promptData.version = promptData.version || '1.0.0';
      }
      promptData.lastModified = new Date().toISOString();

      const success = await this.aiService.savePrompt(promptData);
      
      if (success) {
        res.json({
          success: true,
          message: 'Prompt saved successfully',
          data: promptData
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to save prompt to Firebase storage'
        });
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      res.status(500).json({
        success: false,
        error: `Save failed: ${error.message}`
      });
    }
  }

  // 🔧 UPDATED: Update existing prompt with Firebase integration
  async updatePrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const { id } = req.params;
      const promptData = req.body;
      
      // Ensure the ID matches and add metadata
      promptData.id = id;
      promptData.lastModified = new Date().toISOString();
      
      const success = await this.aiService.updatePrompt(id, promptData);
      
      if (success) {
        res.json({
          success: true,
          message: 'Prompt updated successfully',
          data: promptData
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Prompt not found or update failed'
        });
      }
    } catch (error) {
      console.error('Error updating prompt:', error);
      res.status(500).json({
        success: false,
        error: `Update failed: ${error.message}`
      });
    }
  }

  // 🔧 UPDATED: Delete prompt with Firebase integration
  async deletePrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const { id } = req.params;
      
      const success = await this.aiService.deletePrompt(id);
      
      if (success) {
        res.json({
          success: true,
          message: 'Prompt deleted successfully'
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Prompt not found'
        });
      }
    } catch (error) {
      console.error('Error deleting prompt:', error);
      res.status(500).json({
        success: false,
        error: `Delete failed: ${error.message}`
      });
    }
  }

  // 🔧 UPDATED: Test prompt with better error handling
  async testPrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const { promptId, testData } = req.body;
      
      if (!promptId || !testData) {
        return res.status(400).json({
          success: false,
          error: 'promptId and testData are required'
        });
      }
      
      const result = await this.aiService.testPrompt(promptId, testData);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error testing prompt:', error);
      res.status(500).json({
        success: false,
        error: `Test failed: ${error.message}`
      });
    }
  }

  // 🔧 UPDATED: Test specific prompt
  async testSpecificPrompt(req, res) {
    try {
      await this.aiService.initPromise;
      
      const { id } = req.params;
      const { testData } = req.body;
      
      if (!testData) {
        return res.status(400).json({
          success: false,
          error: 'testData is required'
        });
      }
      
      const result = await this.aiService.testPrompt(id, testData);
      
      res.json({
        success: true,
        data: result,
        promptId: id
      });
    } catch (error) {
      console.error('Error testing specific prompt:', error);
      res.status(500).json({
        success: false,
        error: `Test failed: ${error.message}`
      });
    }
  }

  // System health and status
  async getSystemHealth(req, res) {
    try {
      const health = await this.aiService.healthCheck();
      const providerStatus = await this.aiService.getProviderStatus();
      
      res.json({
        success: true,
        health,
        providers: providerStatus,
        modularAI: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Enhanced extraction for PTP supplier
  async extractPurchaseOrder(req, res) {
    try {
      const file = req.file;
      const { supplier } = req.body;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      console.log(`📄 PO Extraction: ${file.originalname} from ${supplier || 'unknown'}`);

      // Read file content
      const fs = require('fs').promises;
      const fileContent = await fs.readFile(file.path, 'utf8').catch(() => 
        `Binary file: ${file.originalname} (${file.mimetype})`
      );

      // Use enhanced extraction with supplier context
      const result = await this.aiService.extractFromDocument(fileContent, 'purchase_order', {
        supplier: supplier,
        filename: file.originalname,
        documentType: this.detectDocumentType(file.mimetype),
        enhancedMode: true
      });

      // Clean up
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        console.warn('Failed to cleanup file:', unlinkError.message);
      }

      res.json({
        success: result.success,
        data: result.result,
        metadata: {
          ...result.metadata,
          extraction_method: 'modular_ai_enhanced',
          supplier_specific: !!supplier,
          file_info: {
            name: file.originalname,
            size: file.size,
            type: file.mimetype
          }
        }
      });

    } catch (error) {
      console.error('PO extraction error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'purchase_order_extraction'
      });
    }
  }

  // Enhanced extraction for Proforma Invoice
  async extractProformaInvoice(req, res) {
    try {
      const file = req.file;
      const { supplier } = req.body;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      console.log(`📄 PI Extraction: ${file.originalname}`);

      // Read file content
      const fs = require('fs').promises;
      const fileContent = await fs.readFile(file.path, 'utf8').catch(() => 
        `Binary file: ${file.originalname} (${file.mimetype})`
      );

      // Use enhanced extraction
      const result = await this.aiService.extractFromDocument(fileContent, 'proforma_invoice', {
        supplier: supplier,
        filename: file.originalname,
        documentType: this.detectDocumentType(file.mimetype)
      });

      // Clean up
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        console.warn('Failed to cleanup file:', unlinkError.message);
      }

      res.json({
        success: result.success,
        data: result.result,
        metadata: {
          ...result.metadata,
          extraction_method: 'modular_ai',
          document_type: 'proforma_invoice'
        }
      });

    } catch (error) {
      console.error('PI extraction error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'proforma_invoice_extraction'
      });
    }
  }

  // Quick test endpoint
  async quickTest(req, res) {
    try {
      console.log('🧪 Running quick AI test...');

      // Test document
      const testDocument = `
        PURCHASE ORDER
        PO Number: PO-TEST-001
        Supplier: Test Supplier Ltd.
        
        Line Items:
        1. Product A - Qty: 5 - Unit Price: $100.00 - Total: $500.00
        2. Product B - Qty: 3 - Unit Price: $200.00 - Total: $600.00
        
        Total Amount: $1,100.00
      `;

      const result = await this.aiService.extractFromDocument(testDocument, 'purchase_order', {
        supplier: 'TEST_SUPPLIER',
        filename: 'test-document.txt',
        testMode: true
      });

      res.json({
        success: true,
        message: 'Quick test completed',
        test_result: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Quick test error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'quick_test'
      });
    }
  }

  // Helper method to detect document type
  detectDocumentType(mimeType) {
    const typeMap = {
      'application/pdf': 'pdf',
      'image/jpeg': 'image',
      'image/png': 'image',
      'image/tiff': 'image',
      'text/plain': 'text',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
      'application/vnd.ms-excel': 'excel'
    };
    
    return typeMap[mimeType] || 'auto-detect';
  }
}

module.exports = ModularAIController;
