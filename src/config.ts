import { z } from 'zod';
import dotenv from 'dotenv';
import type { ProxyConfig } from './types';

// Schema for runtime environment validation
const baseSchema = z.object({
  GHOST_URL: z.string().url().default('http://localhost:2368'),
  PORT: z.string().transform(Number).default('3000'),
  DEBUG: z.string().transform(val => val === 'true').default('false'),
  BUNNYCDN_API_KEY: z.string().min(1),
  BUNNYCDN_PULL_ZONE_ID: z.string().min(1),
  BUNNYCDN_PURGE_OLD_CACHE: z.string().transform(val => val === 'true').default('false'),
});

const configSchema = z.discriminatedUnion('BUNNYCDN_PURGE_OLD_CACHE', [
  baseSchema.extend({
    BUNNYCDN_PURGE_OLD_CACHE: z.literal(true),
    BUNNYCDN_STORAGE_ZONE_NAME: z.string().min(1),
    BUNNYCDN_STORAGE_ZONE_PASSWORD: z.string().min(1),
  }),
  baseSchema.extend({
    BUNNYCDN_PURGE_OLD_CACHE: z.literal(false),
  })
]);

export function loadConfig(): ProxyConfig {
  dotenv.config();
  
  const result = configSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid configuration:', result.error.format());
    process.exit(1);
  }

  const { data } = result;

  return {
    ghostUrl: data.GHOST_URL.replace(/\/$/, ''),
    port: data.PORT,
    debug: data.DEBUG,
    bunnycdn: {
      apiKey: data.BUNNYCDN_API_KEY,
      pullZoneId: data.BUNNYCDN_PULL_ZONE_ID,
      purgeOldCache: data.BUNNYCDN_PURGE_OLD_CACHE,
      ...(data.BUNNYCDN_PURGE_OLD_CACHE ? {
        storageZoneName: data.BUNNYCDN_STORAGE_ZONE_NAME,
        storageZonePassword: data.BUNNYCDN_STORAGE_ZONE_PASSWORD,
      } : {}),
    },
    security: {
      trustProxy: true,
    }
  };
} 