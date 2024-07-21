import express, { Response } from 'express';
import httpProxy from 'http-proxy';
import dotenv from 'dotenv';
import fetch, { Headers as FetchHeaders, RequestInit } from 'node-fetch';
import { deleteStorageZoneFile, getPullZoneName, listStorageZoneFiles, FileDetail, errorHtml } from './util.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const GHOST_URL = process.env.GHOST_URL?.replace(/\/$/, '') ?? 'http://localhost:2368';
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY ?? '';
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID ?? '';
const BUNNYCDN_PURGE_OLD_CACHE = process.env.BUNNYCDN_PURGE_OLD_CACHE === 'true';
const BUNNYCDN_STORAGE_ZONE_NAME = process.env.BUNNYCDN_STORAGE_ZONE_NAME ?? '';
const BUNNYCDN_STORAGE_ZONE_PASSWORD = process.env.BUNNYCDN_STORAGE_ZONE_PASSWORD ?? '';

const proxy = httpProxy.createProxyServer({
  target: GHOST_URL,
  secure: false,
  changeOrigin: true,
  selfHandleResponse: true,
});

proxy.on('proxyRes', async (proxyRes, req, res) => {
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
  console.error("Error during proxy operation:", err);
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
      'AccessKey': BUNNYCDN_API_KEY,
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
  const pullZoneName = await getPullZoneName(BUNNYCDN_PULL_ZONE_ID, BUNNYCDN_API_KEY);
  const files = await listStorageZoneFiles(BUNNYCDN_STORAGE_ZONE_NAME, '__bcdn_perma_cache__', BUNNYCDN_STORAGE_ZONE_PASSWORD) as FileDetail[];
  
  const deletePromises = files.map(file => {
    if (file.ObjectName.includes(pullZoneName)) {
      return deleteStorageZoneFile(BUNNYCDN_STORAGE_ZONE_NAME, '__bcdn_perma_cache__', file.ObjectName, BUNNYCDN_STORAGE_ZONE_PASSWORD);
    }
    return Promise.resolve();
  });

  const results = await Promise.allSettled(deletePromises);
  return `Deleted ${results.filter(r => r.status === 'fulfilled').length} out of ${files.length} directories.`;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
