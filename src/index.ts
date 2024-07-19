import express, { Response } from 'express';
import httpProxy from 'http-proxy';
import bodyParser from 'body-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GHOST_URL = process.env.GHOST_URL?.replace(/\/$/, '');
const proxy = httpProxy.createProxyServer({
  target: GHOST_URL,
  secure: false, // Disable SSL certificate verification
  agent: new https.Agent({
    rejectUnauthorized: false, // Add this line to ignore self-signed certificates
  }),
});

// Middleware to handle lowercase URL redirection
app.use((req, res, next) => {
  const path = req.path.split('?')[0];
  if (path !== path.toLowerCase() && !path.match(/\.\w+$/)) {
    const query = req.originalUrl.slice(path.length);
    return res.redirect(301, path.toLowerCase() + query);
  }
  next();
});

// Set up multer for handling multipart/form-data requests
const upload = multer({ storage: multer.memoryStorage() });

// Apply raw body parser only to the Stripe webhook endpoint
app.use(
  '/members/webhooks/stripe',
  bodyParser.raw({ type: 'application/json' })
);

app.post('/members/webhooks/stripe', (req, res) => {
  // Forward these requests directly to Ghost
  proxy.web(req, res, { target: GHOST_URL });
});

// General proxy for all other requests
app.use((req, res, next) => {
  if (!req.url.startsWith('/members/webhooks/stripe')) {
    proxy.web(req, res, {
      target: GHOST_URL,
      changeOrigin: true, // This changes the origin of the host header to the target URL
    });
  } else {
    next();
  }
});

// Error handling for the proxy
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  // Cast res to the Express Response type
  (res as Response).status(500).send('Proxy error');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
