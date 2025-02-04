import fetch, { RequestInit } from 'node-fetch';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

export async function fetchWithPool(url: string, options: RequestInit) {
  return fetch(url, {
    ...options,
    agent: url.startsWith('https') ? httpsAgent : httpAgent,
  });
} 