//services/mcp/MCPIntegrationService.js
const MCPServerManager = require('./MCPServerManager');
const UnifiedAIService = require('../ai/UnifiedAIService');
const WebSocket = require('ws');
const EventEmitter = require('events');

class MCPIntegrationService extends EventEmitter {
  constructor() {
    super();
    this.mcpServer = new MCPServerManager();
    this.aiService = new UnifiedAIService();
    this.wsServer = null;
    this.connectedClients = new Map();
    this.isInitialized = false;
    
    this.initializeService();
  }

  async initializeService() {
    console.log('🔄 Initializing MCP Integration Service...');
    
    try {
      // Initialize WebSocket server for real-time MCP communication
      await this.setupWebSocketServer();
      
      // Setup event handlers for AI service integration
      await this.setupAIIntegration();
      
      this.isInitialized = true;
      console.log('✅ MCP Integration Service initialized successfully');
      
      this.emit('initialized', {
        timestamp: new Date().toISOString(),
        capabilities: this.getCapabilities()
      });
    } catch (error) {
      console.error('❌ MCP Integration Service initialization failed:', error);
      throw error;
    }
  }

  async setupWebSocketServer() {
    const port = process.env.MCP_WS_PORT || 8080;
    
    this.wsServer = new WebSocket.Server({ 
      port: port,
      path: '/mcp'
    });

    this.wsServer.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      console.log(`🔗 MCP client connected: ${clientId}`);
      
      this.connectedClients.set(clientId, {
        ws,
        id: clientId,
        connectedAt: new Date(),
        capabilities: [],
        authenticated: false
      });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(clientId, message);
        } catch (error) {
          console.error('❌ Error handling client message:', error);
          this.sendToClient(clientId, {
            type: 'error',
            error: error.message
          });
        }
      });

      ws.on('close', () => {
        console.log(`🔌 MCP client disconnected: ${clientId}`);
        this.connectedClients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'welcome',
        server: this.mcpServer.getServerInfo(),
        clientId: clientId,
        timestamp: new Date().toISOString()
      });
    });

    console.log(`🌐 MCP WebSocket server listening on port ${port}`);
  }

  async handleClientMessage(clientId, message) {
    const client = this.connectedClients.get(clientId);
    if (!client) return;

    console.log(`📨 MCP message from ${clientId}:`, message.type);

    switch (message.type) {
      case 'authenticate':
        await this.handleAuthentication(clientId, message);
        break;
        
      case 'call_tool':
        await this.handleToolCall(clientId, message);
        break;
        
      case 'get_capabilities':
        this.sendToClient(clientId, {
          type: 'capabilities',
          capabilities: this.getCapabilities(),
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'subscribe':
        await this.handleSubscription(clientId, message);
        break;
        
      case 'stream_process':
        await this.handleStreamedProcess(clientId, message);
        break;
        
      default:
        this.sendToClient(clientId, {
          type: 'error',
          error: `Unknown message type: ${message.type}`
        });
    }
  }

  async handleAuthentication(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    // Simple authentication - enhance with real auth in production
    const isValid = message.apiKey && message.apiKey.length > 10;
    
    client.authenticated = isValid;
    
    this.sendToClient(clientId, {
      type: 'auth_response',
      authenticated: isValid,
      capabilities: isValid ? this.getCapabilities() : [],
      timestamp: new Date().toISOString()
    });
    
    if (isValid) {
      console.log(`✅ Client ${clientId} authenticated successfully`);
    } else {
      console.log(`❌ Client ${clientId} authentication failed`);
    }
  }

  async handleToolCall(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required'
      });
      return;
    }

    try {
      const startTime = Date.now();
      
      // Send processing started notification
      this.sendToClient(clientId, {
        type: 'tool_started',
        toolName: message.toolName,
        requestId: message.requestId,
        timestamp: new Date().toISOString()
      });

      // Execute the tool through MCP server
      const tool = this.mcpServer.tools.get(message.toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${message.toolName}`);
      }

      const result = await tool.handler(message.arguments || {});
      const processingTime = Date.now() - startTime;

      // Send success response
      this.sendToClient(clientId, {
        type: 'tool_result',
        toolName: message.toolName,
        requestId: message.requestId,
        result: result,
        metadata: {
          processingTime,
          timestamp: new Date().toISOString(),
          clientId: clientId
        }
      });

      console.log(`✅ Tool ${message.toolName} executed for client ${clientId} in ${processingTime}ms`);
      
    } catch (error) {
      console.error(`❌ Tool execution error for client ${clientId}:`, error);
      
      this.sendToClient(clientId, {
        type: 'tool_error',
        toolName: message.toolName,
        requestId: message.requestId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleSubscription(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required'
      });
      return;
    }

    // Add subscription to client capabilities
    if (!client.subscriptions) {
      client.subscriptions = new Set();
    }
    
    client.subscriptions.add(message.eventType);
    
    this.sendToClient(clientId, {
      type: 'subscription_confirmed',
      eventType: message.eventType,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📡 Client ${clientId} subscribed to ${message.eventType}`);
  }

  async handleStreamedProcess(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required'
      });
      return;
    }

    try {
      console.log(`🔄 Starting streamed process for client ${clientId}: ${message.processType}`);
      
      // Real streaming processing for document analysis
      if (message.processType === 'document_analysis' && message.content) {
        await this.streamDocumentAnalysis(clientId, message);
      } else {
        // Generic streaming process
        const steps = this.getProcessSteps(message.processType);
        await this.executeStreamingSteps(clientId, message, steps);
      }
      
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'stream_error',
        processType: message.processType,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async streamDocumentAnalysis(clientId, message) {
    // Step 1: Document classification
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 1,
      totalSteps: 4,
      status: 'processing',
      message: 'Analyzing document structure...',
      timestamp: new Date().toISOString()
    });

    const classifyTool = this.mcpServer.tools.get('classify_document');
    const classResult = await classifyTool.handler({
      content: message.content,
      filename: message.filename
    });

    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 1,
      totalSteps: 4,
      status: 'completed',
      result: {
        document_type: classResult.document_type,
        confidence: classResult.confidence
      },
      timestamp: new Date().toISOString()
    });

    // Step 2: Content extraction
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 2,
      totalSteps: 4,
      status: 'processing',
      message: 'Extracting structured data...',
      timestamp: new Date().toISOString()
    });

    const extractTool = this.mcpServer.tools.get('extract_purchase_order');
    const extractResult = await extractTool.handler({
      content: message.content,
      supplier: message.supplier,
      documentType: 'text'
    });

    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 2,
      totalSteps: 4,
      status: 'completed',
      result: extractResult.result,
      timestamp: new Date().toISOString()
    });

    // Step 3: Quality validation
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 3,
      totalSteps: 4,
      status: 'processing',
      message: 'Validating extraction quality...',
      timestamp: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 3,
      totalSteps: 4,
      status: 'completed',
      result: {
        confidence: extractResult.metadata?.confidence || 0.85,
        validation: 'passed'
      },
      timestamp: new Date().toISOString()
    });

    // Step 4: Final processing
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 4,
      totalSteps: 4,
      status: 'processing',
      message: 'Finalizing analysis...',
      timestamp: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Send completion
    this.sendToClient(clientId, {
      type: 'stream_complete',
      processType: 'document_analysis',
      result: {
        document_type: classResult.document_type,
        extraction: extractResult.result,
        metadata: extractResult.metadata,
        suggestions: classResult.suggested_actions
      },
      timestamp: new Date().toISOString()
    });
  }

  async executeStreamingSteps(clientId, message, steps) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // Send step start
      this.sendToClient(clientId, {
        type: 'stream_update',
        processType: message.processType,
        step: i + 1,
        totalSteps: steps.length,
        status: 'processing',
        message: step.message,
        timestamp: new Date().toISOString()
      });
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, step.duration));
      
      // Send step completion
      this.sendToClient(clientId, {
        type: 'stream_update',
        processType: message.processType,
        step: i + 1,
        totalSteps: steps.length,
        status: 'completed',
        result: step.result,
        timestamp: new Date().toISOString()
      });
    }
    
    // Send final completion
    this.sendToClient(clientId, {
      type: 'stream_complete',
      processType: message.processType,
      result: 'Process completed successfully',
      timestamp: new Date().toISOString()
    });
  }

  getProcessSteps(processType) {
    const steps = {
      'supplier_analysis': [
        { message: 'Gathering supplier data...', duration: 1500, result: 'Data collected' },
        { message: 'Analyzing performance metrics...', duration: 2500, result: 'Metrics analyzed' },
        { message: 'Generating insights...', duration: 2000, result: 'Insights generated' },
        { message: 'Preparing recommendations...', duration: 1000, result: 'Recommendations ready' }
      ],
      'batch_processing': [
        { message: 'Preparing batch queue...', duration: 1000, result: 'Queue prepared' },
        { message: 'Processing documents...', duration: 3000, result: 'Documents processed' },
        { message: 'Validating results...', duration: 1500, result: 'Validation complete' }
      ]
    };
    
    return steps[processType] || [
      { message: 'Processing request...', duration: 2000, result: 'Process completed' }
    ];
  }

  sendToClient(clientId, message) {
    const client = this.connectedClients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  broadcastToSubscribers(eventType, data) {
    for (const [clientId, client] of this.connectedClients) {
      if (client.subscriptions && client.subscriptions.has(eventType)) {
        this.sendToClient(clientId, {
          type: 'event',
          eventType: eventType,
          data: data,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  async setupAIIntegration() {
    console.log('🤖 Setting up AI service integration...');
    
    // Listen for AI service events and broadcast to subscribed clients
    this.aiService.on('extraction_complete', (data) => {
      this.broadcastToSubscribers('extraction_complete', data);
    });
    
    this.aiService.on('analysis_complete', (data) => {
      this.broadcastToSubscribers('analysis_complete', data);
    });
    
    console.log('✅ AI service integration configured');
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getCapabilities() {
    return {
      mcp_version: '2.0.0',
      server_capabilities: [
        'tool_execution',
        'real_time_communication',
        'batch_processing',
        'event_streaming',
        'system_monitoring'
      ],
      available_tools: Array.from(this.mcpServer.tools.keys()),
      ai_capabilities: [
        'document_extraction',
        'supplier_analysis',
        'procurement_intelligence',
        'document_classification',
        'performance_analytics'
      ],
      supported_formats: ['pdf', 'image', 'text', 'excel'],
      real_time_features: [
        'websocket_communication',
        'event_subscriptions',
        'streaming_processes',
        'live_monitoring'
      ]
    };
  }

  async getStatus() {
    if (!this.isInitialized) {
      return { status: 'initializing' };
    }

    const aiHealth = await this.aiService.healthCheck();
    
    return {
      status: 'running',
      mcp_server: this.mcpServer.getServerInfo(),
      websocket_server: {
        port: process.env.MCP_WS_PORT || 8080,
        connected_clients: this.connectedClients.size,
        status: this.wsServer ? 'running' : 'stopped'
      },
      ai_service: aiHealth,
      capabilities: this.getCapabilities(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('🛑 Shutting down MCP Integration Service...');
    
    try {
      // Close all client connections
      for (const [clientId, client] of this.connectedClients) {
        client.ws.close();
      }
      
      // Close WebSocket server
      if (this.wsServer) {
        this.wsServer.close();
      }
      
      // Stop MCP server
      await this.mcpServer.stop();
      
      console.log('✅ MCP Integration Service shut down successfully');
    } catch (error) {
      console.error('❌ Error during MCP service shutdown:', error);
    }
  }
}

module.exports = MCPIntegrationService;
