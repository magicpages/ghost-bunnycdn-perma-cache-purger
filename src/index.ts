import express from 'express';
import { loadConfig } from './config.js';
import { ProxyManager } from './proxy-manager.js';

async function bootstrap() {
  try {
    const config = loadConfig();
    const app = express();
    
    // Basic security
    app.set('trust proxy', config.security.trustProxy);
    
    // Normalize paths
    app.use((req, res, next) => {
      req.url = req.url.replace(/\/+/g, '/');
      next();
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Setup proxy
    const proxyManager = new ProxyManager(config);
    app.use(proxyManager.handleRequest);

    // Start server
    app.listen(config.port, () => {
      console.log(`🚀 Server running on port ${config.port}`);
      config.debug && console.log('🐛 Debug mode enabled');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap().catch(console.error);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
