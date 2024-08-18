import express, { Response, Request, NextFunction } from 'express';
import httpProxy from 'http-proxy';
import dotenv from 'dotenv';
import fetch, { Headers as FetchHeaders, RequestInit } from 'node-fetch';
import {
  deleteStorageZoneFile,
  getPullZoneName,
  listStorageZoneFiles,
  FileDetail,
  errorHtml,
  SpamRequestCondition,
} from './util.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.DEBUG === 'true';
const GHOST_URL = process.env.GHOST_URL?.replace(/\/$/, '') ?? 'http://localhost:2368';
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY ?? '';
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID ?? '';
const BUNNYCDN_PURGE_OLD_CACHE = process.env.BUNNYCDN_PURGE_OLD_CACHE === 'true';
const BUNNYCDN_STORAGE_ZONE_NAME = process.env.BUNNYCDN_STORAGE_ZONE_NAME ?? '';
const BUNNYCDN_STORAGE_ZONE_PASSWORD = process.env.BUNNYCDN_STORAGE_ZONE_PASSWORD ?? '';
const BLOCK_KNOWN_SPAM_REQUESTS = process.env.BLOCK_KNOWN_SPAM_REQUESTS !== 'false';

app.set('trust proxy', true);

const proxy = httpProxy.createProxyServer({
  target: GHOST_URL,
  secure: false,
  changeOrigin: true,
  selfHandleResponse: true,
});

proxy.on('proxyReq', function (proxyReq, req, res, options) {
  if (DEBUG) {
    console.log('Proxying request:', req.method, req.url);
    console.log('Headers:', req.headers);
  }

  const originalIp =
    req.headers['x-original-forwarded-for'] || req.connection.remoteAddress;
  proxyReq.setHeader('x-forwarded-for', originalIp as string);
  proxyReq.setHeader('x-real-ip', originalIp as string);
});

proxy.on('proxyRes', async (proxyRes, req, res) => {
  if (DEBUG) {
    console.log('Proxying response:', proxyRes.statusCode, req.method, req.url);
    console.log('Headers:', proxyRes.headers);
  }

  let body = Buffer.alloc(0);

  proxyRes.on('data', (data) => {
    body = Buffer.concat([body, data]);
  });

  proxyRes.on('end', () => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    res.end(body);

    if (proxyRes.headers['x-cache-invalidate']) {
      console.log('Detected x-cache-invalidate header, purging cache...');
      purgeCache();
    }
  });
});

// This error handler replicates the error page from Ghost
proxy.on('error', (err, req, res) => {
  console.error('Error during proxy operation:', err);
  (res as Response).status(503).send(errorHtml);
});

if (BLOCK_KNOWN_SPAM_REQUESTS) {

  const knownSpamRequests: SpamRequestCondition[] = [
    /**
     * Spam requests from 2024-08-18
     * @See: https://www.reddit.com/r/Ghost/comments/1eths4f/someone_registers_multiple_users_on_my_selfhosted/
     */
    {
      url: '//members/api/send-magic-link',
      condition: (req: Request) => {
        return req.body && req.body.name === 'adwdasddwa';
      },
    },
    {
      url: '/members/api/send-magic-link',
      condition: (req: Request) => {
        return req.body && req.body.name === 'adwdasddwa';
      },
    },
    // Additional spam conditions should be added here as necessary. PRs very welcome!
  ];

  app.use((req: Request, res: Response, next: NextFunction) => {
    // check method and if the url is in the known spam requests
    if (req.method === 'POST' && knownSpamRequests.some((r) => req.url.startsWith(r.url))) {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        try {
          req.body = JSON.parse(body);

          for (const spamRequest of knownSpamRequests) {
            if (
              req.url.startsWith(spamRequest.url) &&
              spamRequest.condition(req)
            ) {
              console.log('Blocked known spam request:', req.url, req.body);
              return res.status(403).send('Forbidden');
            }
          }

          next();
        } catch (error) {
          console.error('Error parsing request body:', error);
          next();
        }
      });
    } else {
      next();
    }
  });
}


app.use((req, res) => {
  proxy.web(req, res, { target: GHOST_URL });
});

async function purgeCache(): Promise<void> {
  if (BUNNYCDN_PURGE_OLD_CACHE) {
    try {
      const purgeResult = await deleteOldCacheDirectories();
      console.log('Cache directories purged:', purgeResult);
    } catch (error) {
      console.error('Error during cache purge:', error);
    }
  }

  const url = `https://api.bunny.net/pullzone/${BUNNYCDN_PULL_ZONE_ID}/purgeCache`;
  const options: RequestInit = {
    method: 'POST',
    headers: new FetchHeaders({
      'content-type': 'application/json',
      AccessKey: BUNNYCDN_API_KEY,
    }),
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to purge cache: ${response.statusText}`);
    }
    console.log('Cache purged successfully');
  } catch (error) {
    console.error('Failed to purge cache:', error);
  }
}

async function deleteOldCacheDirectories(): Promise<string> {
  const pullZoneName = await getPullZoneName(
    BUNNYCDN_PULL_ZONE_ID,
    BUNNYCDN_API_KEY
  );
  const files = (await listStorageZoneFiles(
    BUNNYCDN_STORAGE_ZONE_NAME,
    '__bcdn_perma_cache__',
    BUNNYCDN_STORAGE_ZONE_PASSWORD
  )) as FileDetail[];

  const deletePromises = files.map((file) => {
    if (file.ObjectName.includes(pullZoneName)) {
      return deleteStorageZoneFile(
        BUNNYCDN_STORAGE_ZONE_NAME,
        '__bcdn_perma_cache__',
        file.ObjectName,
        BUNNYCDN_STORAGE_ZONE_PASSWORD
      );
    }
    return Promise.resolve();
  });

  const results = await Promise.allSettled(deletePromises);
  return `Deleted ${
    results.filter((r) => r.status === 'fulfilled').length
  } out of ${files.length} directories.`;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  if (DEBUG) {
    console.log('Debug mode enabled');
  }
});
