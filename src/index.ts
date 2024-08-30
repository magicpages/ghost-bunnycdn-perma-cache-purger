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
import pLimit from 'p-limit';

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

      const knownSpamRequests: SpamRequest[] = [
        {
          url: '/members/api/send-magic-link',
          conditions: [{ field: 'body.name', value: 'adwdasddwa' }],
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
  selfHandleResponse: false, // Change to false to allow the proxy to handle responses
});

proxy.on('proxyReq', (proxyReq, req, res, options) => {
  debugLog('Proxying request:', req.method, req.url);
  const originalIp =
    req.headers['x-original-forwarded-for'] || req.connection.remoteAddress;
  proxyReq.setHeader('x-forwarded-for', originalIp as string);
  proxyReq.setHeader('x-real-ip', originalIp as string);

  if ((req as any).rawBody && (req as any).rawBody.length > 0) {
    proxyReq.setHeader(
      'Content-Length',
      (req as any).rawBody.length.toString()
    );
    proxyReq.write((req as any).rawBody);
  }
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  proxyRes.pipe(res); // Stream the response directly to the client
  debugLog('Proxying response:', proxyRes.statusCode, req.method, req.url);

  if (proxyRes.headers['x-cache-invalidate']) {
    debugLog('Detected x-cache-invalidate header, purging cache...');
    purgeCache();
  }
});

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
      debugLog('Cache directories purged:', purgeResult);
    } catch (error) {
      console.error('Error during cache purge:', error);
    }
  }
}

const limit = pLimit(5); // Limit the number of concurrent file operations

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

  const deletePromises = files.map((file) =>
    limit(() => {
      if (file.ObjectName.includes(pullZoneName)) {
        return deleteStorageZoneFile(
          BUNNYCDN_STORAGE_ZONE_NAME,
          '__bcdn_perma_cache__',
          file.ObjectName,
          BUNNYCDN_STORAGE_ZONE_PASSWORD
        );
      }
      return Promise.resolve('Skipped');
    })
  );

  const results = await Promise.allSettled(deletePromises);
  return `Deleted ${
    results.filter((r) => r.status === 'fulfilled').length
  } out of ${files.length} directories.`;
}

function debugLog(message: string, ...data: any[]) {
  if (DEBUG) {
    console.log(message, ...data);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (DEBUG) {
    console.log('Debug mode enabled');
  }
});
