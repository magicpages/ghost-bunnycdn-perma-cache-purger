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
  SpamRequest,
} from './util.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.DEBUG === 'true';
const GHOST_URL =
  process.env.GHOST_URL?.replace(/\/$/, '') ?? 'http://localhost:2368';
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY ?? '';
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID ?? '';
const BUNNYCDN_PURGE_OLD_CACHE =
  process.env.BUNNYCDN_PURGE_OLD_CACHE === 'true';
const BUNNYCDN_STORAGE_ZONE_NAME = process.env.BUNNYCDN_STORAGE_ZONE_NAME ?? '';
const BUNNYCDN_STORAGE_ZONE_PASSWORD =
  process.env.BUNNYCDN_STORAGE_ZONE_PASSWORD ?? '';
const BLOCK_KNOWN_SPAM_REQUESTS =
  process.env.BLOCK_KNOWN_SPAM_REQUESTS !== 'false';

let cachePurgeTimeout: NodeJS.Timeout | null = null;

async function debouncePurgeCache() {
  if (cachePurgeTimeout) {
    clearTimeout(cachePurgeTimeout);
  }
  cachePurgeTimeout = setTimeout(async () => {
    await purgeCache();
  }, 10000);
  }

app.set('trust proxy', true);

// Normalize URL paths to avoid issues with double slashes
app.use((req: Request, res: Response, next: NextFunction) => {
  req.url = req.url.replace(/\/+/g, '/');
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (BLOCK_KNOWN_SPAM_REQUESTS && req.method === 'POST') {
    let rawBody: Buffer = Buffer.alloc(0);

    req.on('data', (chunk) => {
      rawBody = Buffer.concat([rawBody, chunk]);
    });

    req.on('end', () => {
      try {
        req.body = JSON.parse(rawBody.toString());
      } catch (e) {
        console.error('Failed to parse JSON:', e);
        req.body = {};
      }

      // List of known spam requests to block
      const knownSpamRequests: SpamRequest[] = [
        {
          url: '/members/api/send-magic-link',
          conditions: [
            {
              field: 'body.name',
              value: 'adwdasddwa',
            },
          ],
        },
      ];

      if (DEBUG) {
        console.log('Incoming request URL:', req.url);
        console.log('Incoming request body:', req.body);
      }

      const isSpamRequest = knownSpamRequests.some((spamRequest) => {
        if (!req.url.startsWith(spamRequest.url)) return false;

        return spamRequest.conditions.every((condition) => {
          const fieldParts = condition.field.split('.');
          let fieldValue: any = req;

          for (const part of fieldParts) {
            fieldValue = fieldValue[part];
            if (fieldValue === undefined) {
              if (DEBUG) {
                console.log(`Field ${condition.field} not found in request.`);
              }
              return false;
            }
          }

          return String(fieldValue) === String(condition.value);
        });
      });

      if (isSpamRequest) {
        console.log('Blocked known spam request:', req.url, req.body);
        return res.status(403).send('Forbidden');
      }

      (req as any).rawBody = rawBody;
      next();
    });
  } else {
    next();
  }
});

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

  // Send the raw body to Ghost for legitimate requests
  if ((req as any).rawBody && (req as any).rawBody.length > 0) {
    proxyReq.setHeader(
      'Content-Length',
      (req as any).rawBody.length.toString()
    );
    proxyReq.write((req as any).rawBody);
  }
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  if (DEBUG) {
    console.log('Proxying response:', proxyRes.statusCode, req.method, req.url);
    console.log('Headers:', proxyRes.headers);
  }

  // Ensure that we set the headers before streaming the response
  res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

  // Stream the response data directly to the client to avoid buffering large files in memory
  proxyRes.pipe(res);

  proxyRes.on('end', () => {
    if (proxyRes.headers['x-cache-invalidate']) {
      console.log(
        'Detected x-cache-invalidate header, scheduling cache purge...'
      );
      debouncePurgeCache();
    }
  });
});

// Error handler replicates the error page from Ghost
proxy.on('error', (err, req, res) => {
  console.error('Error during proxy operation:', err);
  (res as Response).status(503).send(errorHtml);
});

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
