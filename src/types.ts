export interface ProxyConfig {
  ghostUrl: string;
  port: number;
  debug: boolean;
  bunnycdn: {
    apiKey: string;
    pullZoneId: string;
    purgeOldCache: boolean;
    storageZoneName?: string;
    storageZonePassword?: string;
  };
  security: {
    trustProxy: boolean;
  };
}

export interface CacheConfig {
  purgeDebounceMs: number;
} 