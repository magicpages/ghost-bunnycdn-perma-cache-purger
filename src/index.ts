import express from 'express';
import fetch, { Headers, Response as FetchResponse } from 'node-fetch';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import http from 'http';
import https from 'https';
import path from 'path';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GHOST_URL = process.env.GHOST_URL;
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY;
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID;

if (!GHOST_URL || !BUNNYCDN_API_KEY || !BUNNYCDN_PULL_ZONE_ID) {
  console.error(`🚨 You are missing one or more required environment variables.`);
  process.exit(1);
}

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  servername: new URL(GHOST_URL).hostname,
});

// Function to purge cache on BunnyCDN
const purgeCache = async (): Promise<void> => {
  try {
    await fetch(
      `https://api.bunny.net/pullzone/${BUNNYCDN_PULL_ZONE_ID}/purgeCache`,
      {
        method: 'POST',
        headers: {
          AccessKey: BUNNYCDN_API_KEY,
        },
      }
    );
    console.info(`✅ ${new Date().toISOString()} - Cache purged successfully`);
  } catch (error) {
    console.error(`❌ ${new Date().toISOString()} - Failed to purge cache`, error);
  }
};

// Ghost has a middleware implemented that redirects URLs without trailing slashes
// to URLs with trailing slashes. This middleware replicates that behavior. Otherwise
// the URL in the browser will be redirected to Bunny's origin URL.
// @See: https://github.com/magicpages/ghost-bunnycdn-perma-cache-purger/issues/2
app.use((req, res, next) => {
  const reqPath = req.path;

  // Check if the path does not end with a slash, does not have a file extension, and does not include API endpoints
  if (
    reqPath !== '/' &&
    !reqPath.endsWith('/') &&
    !path.extname(reqPath) &&
    !reqPath.includes('/api/')
  ) {
    const query = req.url.slice(reqPath.length);
    res.redirect(301, `${reqPath}/${query}`);
    return;
  }
  next();
});

app.use(async (req, res) => {
  const currentUrl = `${GHOST_URL}${req.originalUrl}`;
  const headers = new Headers({
    ...(req.headers as Record<string, string>),
    host: new URL(GHOST_URL).host,
  });

  if (req.headers.cookie) {
    headers.set('Cookie', req.headers.cookie);
  }

  console.info(
    `${new Date().toISOString()} - Proxying request to ${currentUrl} with method ${
      req.method
    }`
  );

  try {
    const response = await fetch(currentUrl, {
      method: req.method,
      headers: Object.fromEntries(headers),
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      redirect: 'manual',
      agent: currentUrl.startsWith('https') ? httpsAgent : httpAgent,
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get('location')
    ) {
      const locationHeader = response.headers.get('location')!;
      const redirectUrl = new URL(locationHeader, currentUrl).href.replace(
        GHOST_URL,
        `http://${req.headers.host}`
      );
      res.redirect(response.status, redirectUrl);
      return;
    }

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (
        !['content-encoding', 'transfer-encoding', 'content-length'].includes(
          key
        )
      ) {
        res.setHeader(key, value);
      }
    });

    if (response.headers.has('x-cache-invalidate')) {
      purgeCache();
    }

    if (response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error(
      `${new Date().toISOString()} - Error proxying request to ${currentUrl}:`,
      error
    );
    res.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: `Request to ${currentUrl} failed.`,
    });
  }
});

app.listen(PORT, () => {
  console.info(
    `🚀 ${new Date().toISOString()} - Middleware is running on port ${PORT}. Waiting for requests...`
  );
});
