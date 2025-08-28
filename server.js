const express = require('express');
const app = express();

// Get all possible port configurations
const PORT = process.env.PORT || process.env.RAILWAY_PORT || process.env.SERVER_PORT || 3000;

console.log('=== RAILWAY DIAGNOSTIC SERVER ===');
console.log('Environment Variables:');
console.log('PORT:', process.env.PORT);
console.log('RAILWAY_PORT:', process.env.RAILWAY_PORT);
console.log('SERVER_PORT:', process.env.SERVER_PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT);
console.log('Final PORT:', PORT);
console.log('Process PID:', process.pid);
console.log('Node Version:', process.version);

// Basic middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('Root endpoint hit!');
  res.json({
    message: 'Railway Diagnostic Server',
    status: 'RESPONDING',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: {
      PORT: process.env.PORT,
      RAILWAY_PORT: process.env.RAILWAY_PORT,
      NODE_ENV: process.env.NODE_ENV,
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      version: process.version
    },
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      ip: req.ip
    }
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  console.log('Health endpoint hit!');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    uptime: process.uptime()
  });
});

// Catch all other routes
app.get('*', (req, res) => {
  console.log(`Catch-all hit: ${req.path}`);
  res.json({
    message: 'Diagnostic server responding',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error occurred:', err);
  res.status(500).json({
    error: 'Server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Start server with multiple binding attempts
function startServer() {
  console.log(`Attempting to start server on port ${PORT}...`);
  
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`SUCCESS: Server listening on 0.0.0.0:${PORT}`);
    console.log(`Server address:`, server.address());
    console.log(`Ready to receive traffic!`);
    
    // Log every 30 seconds to show we're alive
    setInterval(() => {
      console.log(`${new Date().toISOString()} - Server alive, uptime: ${process.uptime()}s`);
    }, 30000);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use`);
    }
  });

  server.on('connection', (socket) => {
    console.log('New connection established from:', socket.remoteAddress);
  });

  return server;
}

// Start the server
const server = startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
