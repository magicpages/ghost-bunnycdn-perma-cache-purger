import express from 'express';
import fetch, { Headers } from 'node-fetch';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import http from 'http';
import https from 'https';

dotenv.config();

const app = express();

// Middleware to parse JSON bodies
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GHOST_URL = process.env.GHOST_URL;
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY;
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID;

if (!GHOST_URL) {
  console.error('GHOST_URL is required');
  process.exit(1);
}

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  servername: new URL(GHOST_URL).hostname,
});

const purgeCache = async () => {
  try {
    await fetch(`https://api.bunny.net/pullzone/${BUNNYCDN_PULL_ZONE_ID}/purgeCache`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNYCDN_API_KEY || '',
      },
    });
    console.info('Cache purged successfully');
  } catch (error) {
    console.error('Failed to purge cache', error);
  }
};

app.use(async (req, res) => {
  let currentUrl = `${GHOST_URL}${req.originalUrl}`;
  const headers = new Headers(req.headers as Record<string, string>);

  // Ensure cookies are forwarded properly
  if (req.headers.cookie) {
    headers.set('Cookie', req.headers.cookie);
  }

  // Log incoming request
  console.info(`Proxying request to ${currentUrl}`);
  console.info(`Method: ${req.method}`);
  console.info(`Headers: ${JSON.stringify(Object.fromEntries(headers), null, 2)}`);

  try {
    while (true) {
      const response = await fetch(currentUrl, {
        method: req.method,
        headers: {
          ...Object.fromEntries(headers),
          host: new URL(GHOST_URL).host, // Override the host header
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
        redirect: 'manual', // Handle redirects manually
        agent: currentUrl.startsWith('https') ? httpsAgent : httpAgent,
      });

      console.info(`Response status: ${response.status}`);
      console.info(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);

      if (response.status === 304) {
        // Explicitly handle 304 Not Modified responses
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.status(304).end();
        return;
      } else if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        // Follow redirect manually
        currentUrl = new URL(response.headers.get('location') as string, currentUrl).href;
        console.info(`Following redirect to ${currentUrl}`);
      } else {
        // Remove encoding-related headers to avoid content decoding errors
        response.headers.delete('content-encoding');
        response.headers.delete('transfer-encoding');
        response.headers.delete('content-length');

        res.status(response.status);
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        if (response.headers.has('x-cache-invalidate')) {
          purgeCache();
        }

        if (response.body === null) {
          res.end();
          return;
        }

        response.body.pipe(res);
        return;
      }
    }
  } catch (error: any) {
    // Enhanced error logging
    if (error instanceof Response) {
      console.error(`Error proxying request to ${currentUrl}:`);
      console.error(`Status: ${error.status}`);
      console.error(`Headers: ${JSON.stringify(Object.fromEntries(error.headers), null, 2)}`);
      console.error(`Data: ${await error.text()}`);
    } else {
      console.error(`Error proxying request to ${currentUrl}: ${error.message}`);
    }

    if (error instanceof Response && error.status >= 300 && error.status < 400 && error.headers.get('location')) {
      const redirectUrl = new URL(error.headers.get('location') as string, currentUrl).href;
      console.info(`Following redirect to ${redirectUrl}`);
      res.redirect(error.status, redirectUrl);
    } else {
      res.status(500).send({
        statusCode: 500,
        code: error.code,
        error: 'Internal Server Error',
        message: `Request to ${currentUrl} failed, reason: ${error.message}`,
      });
    }
  }
});

app.listen(PORT, () => {
  console.info(`Middleware is running on port ${PORT}. Waiting for requests...`);
});
