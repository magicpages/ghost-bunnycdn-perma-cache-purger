import express from 'express';
import fetch, { Headers, Response as FetchResponse } from 'node-fetch';
import FormData from 'form-data'; 
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import http from 'http';
import https from 'https';
import path from 'path';
import { deleteStorageZoneFile, getPullZoneName, listStorageZoneFiles } from './util.js';
import multer from 'multer';

dotenv.config();

const app = express();

// Set up multer for handling multipart/form-data requests
const upload = multer({ storage: multer.memoryStorage() });

// Set up body-parser for handling JSON requests
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const PORT = process.env.PORT || 3000;
const GHOST_URL = process.env.GHOST_URL?.replace(/\/$/, '');
const BUNNYCDN_API_KEY = process.env.BUNNYCDN_API_KEY;
const BUNNYCDN_PULL_ZONE_ID = process.env.BUNNYCDN_PULL_ZONE_ID;
const BUNNYCDN_PURGE_OLD_CACHE = process.env.BUNNYCDN_PURGE_OLD_CACHE === 'true';
const BUNNYCDN_STORAGE_ZONE_NAME = process.env.BUNNYCDN_STORAGE_ZONE_NAME;
const BUNNYCDN_STORAGE_ZONE_PASSWORD = process.env.BUNNYCDN_STORAGE_ZONE_PASSWORD;

if (!GHOST_URL || GHOST_URL === '' || GHOST_URL === 'undefined') {
  console.error('❌ GHOST_URL is required in the environment variables.');
  process.exit(1);
}

if (!BUNNYCDN_API_KEY || BUNNYCDN_API_KEY === '' || BUNNYCDN_API_KEY === 'undefined') {
  console.error('❌ BUNNYCDN_API_KEY is required in the environment variables.');
  process.exit(1);
}

if (!BUNNYCDN_PULL_ZONE_ID || BUNNYCDN_PULL_ZONE_ID === '' || BUNNYCDN_PULL_ZONE_ID === 'undefined') {
  console.error('❌ BUNNYCDN_PULL_ZONE_ID is required in the environment variables.');
  process.exit(1);
}

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  servername: new URL(GHOST_URL).hostname,
});

// BunnyCDN retains the old cache in the storage zone indefinitely, even after purging
// a pull zone's cache. While this does not impact the user experience, it can lead to
// unnecessary storage costs. To avoid this, you can purge the old cache in the storage
// zone by setting the BUNNYCDN_PURGE_OLD_CACHE environment variable to true and providing
// the storage zone ID in the BUNNYCDN_STORAGE_ZONE_NAME, as well as the zone's API password.
// Note: This feature is optional and should only be used if you are aware of the implications.
const deleteOldCacheDirectories = async (): Promise<void> => {
  if (
    !BUNNYCDN_STORAGE_ZONE_NAME ||
    BUNNYCDN_STORAGE_ZONE_NAME === '' ||
    BUNNYCDN_STORAGE_ZONE_NAME === 'undefined'
  ) {
    console.error(
      '❌ BUNNYCDN_STORAGE_ZONE_NAME is required in the environment variables, cannot purge old cache.'
    );
    process.exit(1);
  }

  if (
    !BUNNYCDN_STORAGE_ZONE_PASSWORD ||
    BUNNYCDN_STORAGE_ZONE_PASSWORD === '' ||
    BUNNYCDN_STORAGE_ZONE_PASSWORD === 'undefined'
  ) {
    console.error(
      '❌ BUNNYCDN_STORAGE_ZONE_PASSWORD is required in the environment variables, cannot purge old cache.'
    );
    process.exit(1);
  }

  const pullZoneName = await getPullZoneName(
    BUNNYCDN_PULL_ZONE_ID,
    BUNNYCDN_API_KEY
  );

  const permaCacheDirectoryName = '__bcdn_perma_cache__';
  const permaCacheFolderList = await listStorageZoneFiles(
    BUNNYCDN_STORAGE_ZONE_NAME,
    permaCacheDirectoryName,
    BUNNYCDN_STORAGE_ZONE_PASSWORD
  );

  if (!Array.isArray(permaCacheFolderList)) {
    console.error(
      'Received non-array response from listStorageZoneFiles',
      permaCacheFolderList
    );
    return;
  }

  const deletePromises = permaCacheFolderList.map((folder) => {
    if (folder.ObjectName.includes(pullZoneName)) {
      console.info(`🗑️ Deleting old cache directory: ${folder.ObjectName}`);
      return deleteStorageZoneFile(
        BUNNYCDN_STORAGE_ZONE_NAME,
        permaCacheDirectoryName,
        folder.ObjectName,
        BUNNYCDN_STORAGE_ZONE_PASSWORD
      );
    }
    return Promise.resolve();
  });

  const results = await Promise.allSettled(deletePromises);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to delete file: ${permaCacheFolderList[index].ObjectName}`,
        result.reason
      );
    }
  });
};

// Function to purge cache on BunnyCDN
const purgeCache = async (): Promise<void> => {
  if (BUNNYCDN_PURGE_OLD_CACHE) {
    try {
      await deleteOldCacheDirectories();
    } catch (error) {
      console.error(`❌ ${new Date().toISOString()} - Failed to delete old cache directories`, error);
    }
  }

  try {
    const url = `https://api.bunny.net/pullzone/${BUNNYCDN_PULL_ZONE_ID}/purgeCache`;
    const options = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        AccessKey: BUNNYCDN_API_KEY,
      },
    };

    const response: FetchResponse = await fetch(url, options);

    if (!response.ok) {
      console.error(`❌ ${new Date().toISOString()} - Failed to purge cache:`, response.statusText);
    } else {
      console.info(`✅ ${new Date().toISOString()} - Cache purged successfully`);
    }
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

  // Define paths that should not have a trailing slash appended.
  const excludedPaths = ['/r/', '/ghost/api/'];

  // Check if the path ends with a slash or has a file extension or is an excluded path
  if (
    reqPath.endsWith('/') ||
    path.extname(reqPath) ||
    excludedPaths.some((excludedPath) => reqPath.startsWith(excludedPath))
  ) {
    return next();
  }

  // If the path does not end with a slash, append one but exclude specific paths
  if (!reqPath.endsWith('/') && !excludedPaths.some(ep => reqPath.startsWith(ep))) {
    const query = req.url.slice(reqPath.length);
    res.redirect(301, `${reqPath}/${query}`);
  } else {
    next();
  }
});


app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    upload.any()(req, res, (err) => {
      if (err) {
        return res
          .status(500)
          .json({ error: 'Failed to parse multipart/form-data.' });
      }
      next();
    });
  } else {
    next();
  }
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

  let body;
  if (req.is('multipart/form-data') && req.files) {
    const formData = new FormData();
    const files = req.files as Express.Multer.File[];

    files.forEach((file) => {
      formData.append(file.fieldname, file.buffer, file.originalname);
    });

    Object.keys(req.body).forEach((key) => {
      formData.append(key, req.body[key]);
    });

    body = formData;
    const formHeaders = formData.getHeaders();
    Object.entries(formHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  } else {
    body = req.method !== 'GET' ? JSON.stringify(req.body) : undefined;
    if (body) headers.set('Content-Type', 'application/json');
  }

  console.info(`Proxying request to ${currentUrl} with method ${req.method}`);

  try {
    const response = await fetch(currentUrl, {
      method: req.method,
      headers: Object.fromEntries(headers),
      body,
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
    console.error(`Error proxying request to ${currentUrl}: ${error}`);
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
