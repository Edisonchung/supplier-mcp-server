//controllers/mcp/MCPController.js
const MCPIntegrationService = require('../../services/mcp/MCPIntegrationService');

class MCPController {
  constructor() {
    this.mcpService = new MCPIntegrationService();
    this.isInitialized = false;
    
    // Initialize the service
    this.initialize();
  }

  async initialize() {
    try {
      // Wait for MCP service to initialize
      await new Promise((resolve) => {
        if (this.mcpService.isInitialized) {
          resolve();
        } else {
          this.mcpService.once('initialized', resolve);
        }
      });
      
      this.isInitialized = true;
      console.log('✅ MCP Controller initialized');
    } catch (error) {
      console.error('❌ MCP Controller initialization failed:', error);
    }
  }

  // GET /api/mcp/status - Get MCP service status
  async getStatus(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing',
          status: 'initializing'
        });
      }

      const status = await this.mcpService.getStatus();
      
      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('MCP status error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /api/mcp/capabilities - Get available MCP capabilities
  async getCapabilities(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const capabilities = this.mcpService.getCapabilities();
      
      res.json({
        success: true,
        data: capabilities,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('MCP capabilities error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /api/mcp/tools/execute - Execute MCP tool
  async executeTool(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { toolName, arguments: toolArgs, options = {} } = req.body;
      
      if (!toolName) {
        return res.status(400).json({
          success: false,
          error: 'Tool name is required'
        });
      }

      // Check if tool exists
      const tool = this.mcpService.mcpServer.tools.get(toolName);
      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool not found: ${toolName}`
        });
      }

      console.log(`🛠️ Executing MCP tool via API: ${toolName}`);
      const startTime = Date.now();

      try {
        const result = await tool.handler(toolArgs || {});
        const processingTime = Date.now() - startTime;

        res.json({
          success: true,
          data: {
            tool: toolName,
            result: result,
            metadata: {
              processingTime,
              executedAt: new Date().toISOString(),
              method: 'api',
              ...options.metadata
            }
          }
        });

        console.log(`✅ MCP tool ${toolName} executed successfully in ${processingTime}ms`);
      } catch (toolError) {
        console.error(`❌ MCP tool execution error (${toolName}):`, toolError);
        res.status(500).json({
          success: false,
          error: `Tool execution failed: ${toolError.message}`,
          tool: toolName
        });
      }
    } catch (error) {
      console.error('MCP tool execution error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /api/mcp/tools - List available MCP tools
  async listTools(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const tools = Array.from(this.mcpService.mcpServer.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));

      res.json({
        success: true,
        data: {
          tools: tools,
          count: tools.length
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('MCP tools list error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /api/mcp/extract - Enhanced document extraction via MCP
  async extractDocument(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const file = req.file;
      const { documentType, supplier, context } = req.body;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      console.log(`📄 MCP document extraction: ${file.originalname}`);

      // Read file content
      const fs = require('fs').promises;
      const fileContent = await fs.readFile(file.path, 'utf8').catch(() => 
        `Binary file: ${file.originalname} (${file.mimetype})`
      );

      // Use MCP tool for extraction
      const tool = this.mcpService.mcpServer.tools.get('extract_purchase_order');
      if (!tool) {
        throw new Error('MCP extraction tool not available');
      }

      const result = await tool.handler({
        content: fileContent,
        supplier: supplier,
        documentType: documentType || this.detectDocumentType(file.mimetype),
        context: {
          filename: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          ...context
        }
      });

      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        console.warn('Failed to cleanup uploaded file:', unlinkError.message);
      }

      res.json({
        success: true,
        data: result.result,
        metadata: {
          ...result.metadata,
          mcp_enhanced: true,
          extraction_method: 'mcp_tool',
          file_info: {
            name: file.originalname,
            size: file.size,
            type: file.mimetype
          }
        }
      });

    } catch (error) {
      console.error('MCP document extraction error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_extraction'
      });
    }
  }

  // POST /api/mcp/analyze/supplier - Supplier analysis via MCP
  async analyzeSupplier(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { supplierName, timeframe, metrics } = req.body;

      if (!supplierName) {
        return res.status(400).json({
          success: false,
          error: 'Supplier name is required'
        });
      }

      console.log(`🏢 MCP supplier analysis: ${supplierName}`);

      // Use MCP tool for supplier analysis
      const tool = this.mcpService.mcpServer.tools.get('analyze_supplier_performance');
      if (!tool) {
        throw new Error('MCP supplier analysis tool not available');
      }

      const result = await tool.handler({
        supplierName: supplierName,
        timeframe: timeframe || '90d',
        metrics: metrics || ['delivery', 'quality', 'pricing', 'communication']
      });

      res.json({
        success: true,
        data: result,
        metadata: {
          analysis_method: 'mcp_tool',
          enhanced_intelligence: true,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('MCP supplier analysis error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_supplier_analysis'
      });
    }
  }

  // POST /api/mcp/recommendations - Procurement recommendations via MCP
  async getRecommendations(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { category, budget, urgency, requirements } = req.body;

      if (!category) {
        return res.status(400).json({
          success: false,
          error: 'Product category is required'
        });
      }

      console.log(`💡 MCP procurement recommendations: ${category}`);

      // Use MCP tool for recommendations
      const tool = this.mcpService.mcpServer.tools.get('generate_procurement_recommendations');
      if (!tool) {
        throw new Error('MCP recommendations tool not available');
      }

      const result = await tool.handler({
        category: category,
        budget: budget,
        urgency: urgency || 'medium',
        requirements: requirements || {}
      });

      res.json({
        success: true,
        data: result,
        metadata: {
          recommendation_method: 'mcp_intelligence',
          ai_enhanced: true,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('MCP recommendations error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_recommendations'
      });
    }
  }

  // POST /api/mcp/classify - Document classification via MCP
  async classifyDocument(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { content, filename } = req.body;

      if (!content) {
        return res.status(400).json({
          success: false,
          error: 'Document content is required'
        });
      }

      console.log(`📋 MCP document classification: ${filename || 'unnamed'}`);

      // Use MCP tool for classification
      const tool = this.mcpService.mcpServer.tools.get('classify_document');
      if (!tool) {
        throw new Error('MCP classification tool not available');
      }

      const result = await tool.handler({
        content: content,
        filename: filename
      });

      res.json({
        success: true,
        data: result,
        metadata: {
          classification_method: 'mcp_ai',
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('MCP classification error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_classification'
      });
    }
  }

  // POST /api/mcp/batch - Batch processing via MCP
  async processBatch(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { documents, processingOptions } = req.body;

      if (!documents || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Documents array is required and must not be empty'
        });
      }

      console.log(`📦 MCP batch processing: ${documents.length} documents`);

      // Use MCP tool for batch processing
      const tool = this.mcpService.mcpServer.tools.get('batch_process_documents');
      if (!tool) {
        throw new Error('MCP batch processing tool not available');
      }

      const result = await tool.handler({
        documents: documents,
        processingOptions: processingOptions || {}
      });

      res.json({
        success: true,
        data: result,
        metadata: {
          processing_method: 'mcp_batch',
          enhanced_throughput: true,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('MCP batch processing error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_batch_processing'
      });
    }
  }

  // GET /api/mcp/monitor - System monitoring via MCP
  async getSystemMonitoring(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { include_details } = req.query;

      console.log('📊 MCP system monitoring check');

      // Use MCP tool for system health
      const tool = this.mcpService.mcpServer.tools.get('system_health_check');
      if (!tool) {
        throw new Error('MCP monitoring tool not available');
      }

      const result = await tool.handler({
        include_details: include_details === 'true'
      });

      res.json({
        success: true,
        data: result,
        metadata: {
          monitoring_method: 'mcp_realtime',
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('MCP monitoring error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_monitoring'
      });
    }
  }

  // POST /api/mcp/stream - Start streaming process
  async startStreamProcess(req, res) {
    try {
      if (!this.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'MCP service still initializing'
        });
      }

      const { processType, content, supplier, filename } = req.body;

      if (!processType) {
        return res.status(400).json({
          success: false,
          error: 'Process type is required'
        });
      }

      console.log(`🔄 Starting MCP streaming process: ${processType}`);

      // Generate a unique process ID
      const processId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Start the streaming process
      // Note: In a real implementation, you'd use WebSocket for real-time updates
      // For API endpoint, we'll simulate streaming by providing immediate feedback

      if (processType === 'document_analysis' && content) {
        // Quick analysis for API response
        const classifyTool = this.mcpService.mcpServer.tools.get('classify_document');
        const extractTool = this.mcpService.mcpServer.tools.get('extract_purchase_order');
        
        const [classResult, extractResult] = await Promise.all([
          classifyTool.handler({ content, filename }),
          extractTool.handler({ content, supplier, documentType: 'text' })
        ]);

        res.json({
          success: true,
          data: {
            processId: processId,
            processType: processType,
            status: 'completed',
            result: {
              classification: classResult,
              extraction: extractResult.result,
              metadata: extractResult.metadata
            }
          },
          metadata: {
            streaming_method: 'mcp_api',
            timestamp: new Date().toISOString()
          }
        });
      } else {
        res.json({
          success: true,
          data: {
            processId: processId,
            processType: processType,
            status: 'initiated',
            message: 'Process started. Use WebSocket connection for real-time updates.',
            websocket_url: `ws://localhost:${process.env.MCP_WS_PORT || 8080}/mcp`
          },
          metadata: {
            streaming_method: 'websocket_required',
            timestamp: new Date().toISOString()
          }
        });
      }

    } catch (error) {
      console.error('MCP stream process error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        context: 'mcp_stream_process'
      });
    }
  }

  // Helper method to detect document type from MIME type
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

module.exports = MCPController;
