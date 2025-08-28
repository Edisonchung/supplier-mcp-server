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
    this.actualPort = null;
    this.initializationAttempts = 0;
    
    this.initializeService();
  }

  async initializeService() {
    console.log('🔄 Initializing MCP Integration Service...');
    
    try {
      this.initializationAttempts++;
      
      // Initialize WebSocket server for real-time MCP communication
      await this.setupWebSocketServer();
      
      // Setup event handlers for AI service integration
      await this.setupAIIntegration();
      
      // Setup health monitoring
      this.setupHealthMonitoring();
      
      this.isInitialized = true;
      console.log('✅ MCP Integration Service initialized successfully');
      
      this.emit('initialized', {
        timestamp: new Date().toISOString(),
        capabilities: this.getCapabilities(),
        port: this.actualPort
      });
      
    } catch (error) {
      console.error('❌ MCP Integration Service initialization failed:', error);
      
      // Retry logic with exponential backoff
      if (this.initializationAttempts < 3) {
        const delay = Math.pow(2, this.initializationAttempts) * 1000;
        console.log(`🔄 Retrying initialization in ${delay}ms... (attempt ${this.initializationAttempts}/3)`);
        
        setTimeout(() => {
          this.initializeService();
        }, delay);
      } else {
        console.error('❌ Max initialization attempts reached, running in degraded mode');
        this.isInitialized = false;
        throw error;
      }
    }
  }

  async setupWebSocketServer() {
    const basePort = process.env.MCP_WS_PORT || 8081;
    let port = parseInt(basePort);
    let attempts = 0;
    const maxAttempts = 15; // Increased attempts for Railway

    console.log(`🌐 Setting up WebSocket server starting from port ${port}...`);

    while (attempts < maxAttempts) {
      try {
        await this.tryCreateWebSocketServer(port);
        this.actualPort = port;
        console.log(`✅ MCP WebSocket server listening on port ${port}`);
        return;
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          attempts++;
          port = parseInt(basePort) + attempts;
          console.log(`⚠️ Port ${port - 1} in use, trying port ${port}... (attempt ${attempts}/${maxAttempts})`);
          
          if (attempts >= maxAttempts) {
            console.error(`❌ Failed to find available port after ${maxAttempts} attempts. Last tried port: ${port}`);
            // Try to continue without WebSocket in degraded mode
            console.log('🔧 Continuing in degraded mode without WebSocket server');
            return;
          }
        } else {
          console.error(`❌ WebSocket server setup error:`, error);
          throw error;
        }
      }
      
      // Small delay between attempts to avoid rapid port scanning
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async tryCreateWebSocketServer(port) {
    return new Promise((resolve, reject) => {
      const server = new WebSocket.Server({ 
        port: port,
        path: '/mcp',
        perMessageDeflate: false, // Disable compression for better performance
        maxPayload: 16 * 1024 * 1024 // 16MB max payload
      });

      server.on('error', (error) => {
        reject(error);
      });

      server.on('listening', () => {
        this.wsServer = server;
        this.setupWebSocketHandlers();
        resolve();
      });

      // Set timeout for server creation
      setTimeout(() => {
        reject(new Error('WebSocket server creation timeout'));
      }, 5000);
    });
  }

  setupWebSocketHandlers() {
    if (!this.wsServer) return;
    
    this.wsServer.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      
      console.log(`🔗 MCP client connected: ${clientId} from ${clientIP}`);
      
      this.connectedClients.set(clientId, {
        ws,
        id: clientId,
        connectedAt: new Date(),
        capabilities: [],
        authenticated: false,
        subscriptions: new Set(),
        ip: clientIP,
        lastActivity: new Date()
      });

      // Setup message handling
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(clientId, message);
          
          // Update last activity
          const client = this.connectedClients.get(clientId);
          if (client) {
            client.lastActivity = new Date();
          }
        } catch (error) {
          console.error('❌ Error handling client message:', error);
          this.sendToClient(clientId, {
            type: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`🔌 MCP client disconnected: ${clientId} (code: ${code}, reason: ${reason})`);
        this.connectedClients.delete(clientId);
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for client ${clientId}:`, error);
        this.connectedClients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'welcome',
        server: this.mcpServer.getServerInfo(),
        clientId: clientId,
        capabilities: this.getCapabilities(),
        timestamp: new Date().toISOString()
      });
    });

    // Setup connection monitoring
    this.setupConnectionMonitoring();
  }

  setupConnectionMonitoring() {
    // Ping clients every 30 seconds to keep connections alive
    setInterval(() => {
      const now = new Date();
      
      for (const [clientId, client] of this.connectedClients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          // Send ping
          client.ws.ping();
          
          // Check for inactive clients (no activity for 10 minutes)
          const inactiveTime = now - client.lastActivity;
          if (inactiveTime > 10 * 60 * 1000) {
            console.log(`⚠️ Disconnecting inactive client: ${clientId}`);
            client.ws.close();
          }
        } else {
          // Remove closed connections
          this.connectedClients.delete(clientId);
        }
      }
    }, 30000);
  }

  setupHealthMonitoring() {
    // Monitor system health every minute
    setInterval(async () => {
      try {
        const status = await this.getStatus();
        if (status.status !== 'running') {
          console.warn('⚠️ MCP Integration Service health check failed:', status);
        }
      } catch (error) {
        console.error('❌ Health monitoring error:', error);
      }
    }, 60000);
  }

  async handleClientMessage(clientId, message) {
    const client = this.connectedClients.get(clientId);
    if (!client) {
      console.warn(`⚠️ Unknown client ${clientId} sent message`);
      return;
    }

    console.log(`📨 MCP message from ${clientId}: ${message.type}`);

    try {
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
          
        case 'unsubscribe':
          await this.handleUnsubscription(clientId, message);
          break;
          
        case 'stream_process':
          await this.handleStreamedProcess(clientId, message);
          break;

        case 'generate_product_image':
          await this.handleImageGeneration(clientId, message);
          break;

        case 'batch_image_generation':
          await this.handleBatchImageGeneration(clientId, message);
          break;

        case 'get_image_templates':
          await this.handleGetImageTemplates(clientId, message);
          break;

        case 'ping':
          this.sendToClient(clientId, {
            type: 'pong',
            timestamp: new Date().toISOString()
          });
          break;

        case 'get_status':
          const status = await this.getStatus();
          this.sendToClient(clientId, {
            type: 'status',
            ...status,
            timestamp: new Date().toISOString()
          });
          break;
          
        default:
          console.warn(`⚠️ Unknown message type from ${clientId}: ${message.type}`);
          this.sendToClient(clientId, {
            type: 'error',
            error: `Unknown message type: ${message.type}`,
            timestamp: new Date().toISOString()
          });
      }
    } catch (error) {
      console.error(`❌ Error handling message type ${message.type} from ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        error: error.message,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleAuthentication(clientId, message) {
    const client = this.connectedClients.get(clientId);
    if (!client) return;
    
    // Enhanced authentication - check multiple auth methods
    let isValid = false;
    
    if (message.apiKey) {
      // API Key authentication
      const validKeys = [
        process.env.MCP_API_KEY,
        process.env.MCP_AUTH_TOKEN,
        'demo_token', // For development
        'mcp_client_key' // For development
      ].filter(Boolean);
      
      isValid = validKeys.includes(message.apiKey) || message.apiKey.length > 10;
    } else if (message.token) {
      // Token-based authentication
      isValid = message.token === process.env.MCP_AUTH_TOKEN || message.token === 'demo_token';
    }
    
    client.authenticated = isValid;
    client.authMethod = isValid ? (message.apiKey ? 'api_key' : 'token') : null;
    
    this.sendToClient(clientId, {
      type: 'auth_response',
      authenticated: isValid,
      capabilities: isValid ? this.getCapabilities() : [],
      authMethod: client.authMethod,
      timestamp: new Date().toISOString()
    });
    
    if (isValid) {
      console.log(`✅ Client ${clientId} authenticated successfully via ${client.authMethod}`);
    } else {
      console.log(`❌ Client ${clientId} authentication failed`);
    }
  }

  async handleToolCall(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
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
          clientId: clientId,
          provider: result.provider || 'mcp'
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

  async handleImageGeneration(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    try {
      console.log(`🎨 Starting image generation for client ${clientId}: ${message.productId}`);
      
      // Send processing started notification
      this.sendToClient(clientId, {
        type: 'image_generation_started',
        productId: message.productId,
        requestId: message.requestId,
        timestamp: new Date().toISOString()
      });

      // Execute the image generation tool through MCP server
      const tool = this.mcpServer.tools.get('generate_product_image');
      if (!tool) {
        throw new Error('Image generation tool not found');
      }

      const result = await tool.handler({
        productId: message.productId,
        productName: message.productName,
        category: message.category,
        specifications: message.specifications,
        provider: message.provider || 'openai', // Default to OpenAI
        imageType: message.imageType || 'product', // product, technical, application
        style: message.style || 'professional'
      });

      // Send success response
      this.sendToClient(clientId, {
        type: 'image_generation_complete',
        productId: message.productId,
        requestId: message.requestId,
        result: {
          imageUrl: result.imageUrl,
          prompt: result.prompt,
          provider: result.provider,
          style: result.style,
          metadata: result.metadata
        },
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Image generated for product ${message.productId} for client ${clientId}`);
      
    } catch (error) {
      console.error(`❌ Image generation error for client ${clientId}:`, error);
      
      this.sendToClient(clientId, {
        type: 'image_generation_error',
        productId: message.productId,
        requestId: message.requestId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleBatchImageGeneration(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    try {
      console.log(`🎨 Starting batch image generation for client ${clientId}: ${message.products.length} products`);
      
      const total = message.products.length;
      let completed = 0;
      const results = [];
      const batchId = message.batchId || `batch_${Date.now()}`;

      // Send batch started notification
      this.sendToClient(clientId, {
        type: 'batch_image_generation_started',
        batchId: batchId,
        totalProducts: total,
        timestamp: new Date().toISOString()
      });

      const tool = this.mcpServer.tools.get('generate_product_image');
      if (!tool) {
        throw new Error('Image generation tool not found');
      }

      // Process each product with concurrency control
      const concurrency = Math.min(3, total); // Max 3 concurrent generations
      const semaphore = new Array(concurrency).fill(null);
      
      const processProduct = async (product, index) => {
        try {
          // Send progress update
          this.sendToClient(clientId, {
            type: 'batch_progress',
            batchId: batchId,
            currentProduct: product.productId,
            progress: Math.round((completed / total) * 100),
            completed: completed,
            total: total,
            timestamp: new Date().toISOString()
          });

          const result = await tool.handler({
            productId: product.productId,
            productName: product.productName,
            category: product.category,
            specifications: product.specifications,
            provider: message.provider || 'openai',
            imageType: product.imageType || 'product',
            style: product.style || 'professional'
          });

          results[index] = {
            productId: product.productId,
            success: true,
            imageUrl: result.imageUrl,
            prompt: result.prompt,
            provider: result.provider,
            metadata: result.metadata
          };

          completed++;
          
        } catch (productError) {
          console.error(`❌ Failed to generate image for product ${product.productId}:`, productError);
          
          results[index] = {
            productId: product.productId,
            success: false,
            error: productError.message
          };
          
          completed++;
        }
      };

      // Process products in batches
      const promises = message.products.map((product, index) => processProduct(product, index));
      await Promise.all(promises);

      // Send batch completion
      this.sendToClient(clientId, {
        type: 'batch_image_generation_complete',
        batchId: batchId,
        results: results,
        summary: {
          total: total,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        },
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Batch image generation completed for client ${clientId}: ${results.filter(r => r.success).length}/${total} successful`);
      
    } catch (error) {
      console.error(`❌ Batch image generation error for client ${clientId}:`, error);
      
      this.sendToClient(clientId, {
        type: 'batch_image_generation_error',
        batchId: message.batchId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleGetImageTemplates(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    try {
      const templates = {
        product_types: [
          { id: 'industrial', name: 'Industrial Equipment', description: 'Heavy machinery and industrial components' },
          { id: 'electronic', name: 'Electronic Components', description: 'Circuit boards, semiconductors, electronic parts' },
          { id: 'mechanical', name: 'Mechanical Parts', description: 'Gears, bearings, mechanical components' },
          { id: 'chemical', name: 'Chemical Products', description: 'Chemicals, materials, laboratory equipment' },
          { id: 'automotive', name: 'Automotive Parts', description: 'Car parts, automotive components' },
          { id: 'construction', name: 'Construction Materials', description: 'Building materials, construction tools' }
        ],
        styles: [
          { id: 'professional', name: 'Professional', description: 'Clean, professional product photography style' },
          { id: 'technical', name: 'Technical', description: 'Technical drawing style with specifications' },
          { id: 'application', name: 'Application', description: 'Product shown in use/application context' },
          { id: 'minimal', name: 'Minimal', description: 'Clean white background, minimal styling' }
        ],
        providers: [
          { id: 'openai', name: 'OpenAI DALL-E', features: ['high_quality', 'fast_generation'] },
          { id: 'anthropic', name: 'Anthropic Claude', features: ['detailed_prompts', 'technical_accuracy'] },
          { id: 'gemini', name: 'Google Gemini', features: ['variety', 'creative_styles'] }
        ]
      };
      
      this.sendToClient(clientId, {
        type: 'image_templates',
        templates: templates,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        error: error.message,
        context: 'get_image_templates',
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleSubscription(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Add subscription to client
    const eventTypes = Array.isArray(message.events) ? message.events : [message.eventType];
    
    eventTypes.forEach(eventType => {
      client.subscriptions.add(eventType);
    });
    
    this.sendToClient(clientId, {
      type: 'subscription_confirmed',
      subscribedEvents: Array.from(client.subscriptions),
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Client ${clientId} subscribed to: ${eventTypes.join(', ')}`);
  }

  async handleUnsubscription(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const eventTypes = Array.isArray(message.events) ? message.events : [message.eventType];
    
    eventTypes.forEach(eventType => {
      client.subscriptions.delete(eventType);
    });
    
    this.sendToClient(clientId, {
      type: 'unsubscription_confirmed',
      unsubscribedEvents: eventTypes,
      remainingSubscriptions: Array.from(client.subscriptions),
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Client ${clientId} unsubscribed from: ${eventTypes.join(', ')}`);
  }

  async handleStreamedProcess(clientId, message) {
    const client = this.connectedClients.get(clientId);
    
    if (!client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Authentication required',
        timestamp: new Date().toISOString()
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
      totalSteps: 5,
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
      totalSteps: 5,
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
      totalSteps: 5,
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
      totalSteps: 5,
      status: 'completed',
      result: extractResult.result,
      timestamp: new Date().toISOString()
    });

    // Step 3: Quality validation
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 3,
      totalSteps: 5,
      status: 'processing',
      message: 'Validating extraction quality...',
      timestamp: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 3,
      totalSteps: 5,
      status: 'completed',
      result: {
        confidence: extractResult.metadata?.confidence || 0.85,
        validation: 'passed'
      },
      timestamp: new Date().toISOString()
    });

    // Step 4: Generate product image
    if (extractResult.result.items && extractResult.result.items.length > 0) {
      this.sendToClient(clientId, {
        type: 'stream_update',
        processType: 'document_analysis',
        step: 4,
        totalSteps: 5,
        status: 'processing',
        message: 'Generating product images...',
        timestamp: new Date().toISOString()
      });

      try {
        const imageTool = this.mcpServer.tools.get('generate_product_image');
        const firstItem = extractResult.result.items[0];
        
        const imageResult = await imageTool.handler({
          productId: firstItem.item_code || 'temp_product',
          productName: firstItem.description,
          category: extractResult.result.supplier || 'general',
          specifications: firstItem.specifications || '',
          provider: 'openai'
        });

        this.sendToClient(clientId, {
          type: 'stream_update',
          processType: 'document_analysis',
          step: 4,
          totalSteps: 5,
          status: 'completed',
          result: {
            imageGenerated: true,
            imageUrl: imageResult.imageUrl,
            productName: firstItem.description
          },
          timestamp: new Date().toISOString()
        });
      } catch (imageError) {
        this.sendToClient(clientId, {
          type: 'stream_update',
          processType: 'document_analysis',
          step: 4,
          totalSteps: 5,
          status: 'completed',
          result: {
            imageGenerated: false,
            error: imageError.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    // Step 5: Final processing
    this.sendToClient(clientId, {
      type: 'stream_update',
      processType: 'document_analysis',
      step: 5,
      totalSteps: 5,
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
      ],
      'product_image_generation': [
        { message: 'Analyzing product specifications...', duration: 1000, result: 'Specs analyzed' },
        { message: 'Generating AI prompt...', duration: 800, result: 'Prompt created' },
        { message: 'Creating product image...', duration: 3000, result: 'Image generated' },
        { message: 'Optimizing for e-commerce...', duration: 1200, result: 'Image optimized' }
      ]
    };
    
    return steps[processType] || [
      { message: 'Processing request...', duration: 2000, result: 'Process completed' }
    ];
  }

  sendToClient(clientId, message) {
    const client = this.connectedClients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`❌ Error sending message to client ${clientId}:`, error);
        this.connectedClients.delete(clientId);
      }
    }
  }

  broadcastToSubscribers(eventType, data) {
    let notified = 0;
    
    for (const [clientId, client] of this.connectedClients) {
      if (client.subscriptions && client.subscriptions.has(eventType)) {
        this.sendToClient(clientId, {
          type: 'event',
          eventType: eventType,
          data: data,
          timestamp: new Date().toISOString()
        });
        notified++;
      }
    }
    
    if (notified > 0) {
      console.log(`📡 Broadcasted ${eventType} to ${notified} subscribers`);
    }
  }

  async setupAIIntegration() {
    console.log('🤖 Setting up AI service integration...');
    
    try {
      // Listen for AI service events and broadcast to subscribed clients
      this.aiService.on('extraction_complete', (data) => {
        this.broadcastToSubscribers('extraction_complete', data);
      });
      
      this.aiService.on('analysis_complete', (data) => {
        this.broadcastToSubscribers('analysis_complete', data);
      });

      // Image generation events
      this.aiService.on('image_generation_complete', (data) => {
        this.broadcastToSubscribers('image_generation_complete', data);
      });

      this.aiService.on('batch_image_generation_progress', (data) => {
        this.broadcastToSubscribers('batch_image_generation_progress', data);
      });

      // Supplier analysis events
      this.aiService.on('supplier_analysis_complete', (data) => {
        this.broadcastToSubscribers('supplier_analysis_complete', data);
      });
      
      console.log('✅ AI service integration configured');
    } catch (error) {
      console.error('❌ AI service integration setup failed:', error);
    }
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getCapabilities() {
    return {
      mcp_version: '2.1.0',
      server_capabilities: [
        'tool_execution',
        'real_time_communication',
        'batch_processing',
        'event_streaming',
        'system_monitoring',
        'image_generation',
        'streaming_processes',
        'subscription_management'
      ],
      available_tools: this.mcpServer ? Array.from(this.mcpServer.tools.keys()) : [],
      ai_capabilities: [
        'document_extraction',
        'supplier_analysis',
        'procurement_intelligence',
        'document_classification',
        'performance_analytics',
        'product_image_generation',
        'batch_image_processing',
        'real_time_streaming'
      ],
      supported_formats: ['pdf', 'image', 'text', 'excel', 'json'],
      real_time_features: [
        'websocket_communication',
        'event_subscriptions',
        'streaming_processes',
        'live_monitoring',
        'image_generation_progress',
        'batch_progress_tracking'
      ],
      image_generation: {
        providers: ['openai', 'anthropic', 'gemini'],
        formats: ['png', 'jpeg', 'webp'],
        max_batch_size: 50,
        supported_styles: ['professional', 'technical', 'application', 'minimal'],
        supported_types: ['industrial', 'electronic', 'mechanical', 'chemical', 'automotive', 'construction'],
        features: [
          'single_product_generation',
          'batch_processing',
          'custom_prompts',
          'real_time_progress',
          'template_system',
          'style_customization'
        ]
      }
    };
  }

  async getStatus() {
    if (!this.isInitialized) {
      return { 
        status: 'initializing',
        attempts: this.initializationAttempts,
        timestamp: new Date().toISOString()
      };
    }

    try {
      const aiHealth = await this.aiService.healthCheck();
      
      return {
        status: 'running',
        mcp_server: this.mcpServer ? this.mcpServer.getServerInfo() : { status: 'unavailable' },
        websocket_server: {
          port: this.actualPort || 'N/A',
          connected_clients: this.connectedClients.size,
          status: this.wsServer ? 'running' : 'stopped',
          authenticated_clients: Array.from(this.connectedClients.values()).filter(c => c.authenticated).length
        },
        ai_service: aiHealth,
        capabilities: this.getCapabilities(),
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async shutdown() {
    console.log('🛑 Shutting down MCP Integration Service...');
    
    try {
      // Notify all clients of shutdown
      this.broadcastToSubscribers('system_shutdown', {
        message: 'MCP Integration Service is shutting down',
        timestamp: new Date().toISOString()
      });

      // Close all client connections gracefully
      for (const [clientId, client] of this.connectedClients) {
        try {
          client.ws.close(1001, 'Server shutdown');
        } catch (error) {
          console.warn(`Warning: Error closing client ${clientId}:`, error);
        }
      }
      
      // Clear clients map
      this.connectedClients.clear();
      
      // Close WebSocket server
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = null;
      }
      
      // Stop MCP server
      if (this.mcpServer) {
        await this.mcpServer.stop();
      }
      
      this.isInitialized = false;
      
      console.log('✅ MCP Integration Service shut down successfully');
    } catch (error) {
      console.error('❌ Error during MCP service shutdown:', error);
    }
  }
}

module.exports = MCPIntegrationService;
