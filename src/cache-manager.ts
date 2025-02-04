import fetch from 'node-fetch';
import { withRetry } from './utils/retry.js';
import { fetchWithPool } from './utils/http-client.js';
import type { ProxyConfig } from './types';
import { getPullZoneName, listStorageZoneFiles, deleteStorageZoneFile, type FileDetail } from './util.js';

export class CacheManager {
  private cachePurgeTimeout: NodeJS.Timeout | null = null;
  private readonly debounceTime = 10000; // 10 seconds

  constructor(private readonly config: ProxyConfig) {}

  async debouncePurgeCache(): Promise<void> {
    if (this.cachePurgeTimeout) {
      clearTimeout(this.cachePurgeTimeout);
    }
    
    this.cachePurgeTimeout = setTimeout(async () => {
      try {
        await this.purgeCache();
      } catch (error) {
        console.error('Failed to purge cache:', error);
      }
    }, this.debounceTime);
  }

  private async purgeCache(): Promise<void> {
    const startTime = performance.now();
    const tasks: Promise<void>[] = [this.purgeCDNCache()];
    
    if (this.config.bunnycdn.purgeOldCache) {
      tasks.push(this.purgeStorageCache());
    }

    try {
      await Promise.all(tasks);
      const endTime = performance.now();
      console.log(`✅ Cache purged successfully in ${(endTime - startTime).toFixed(0)}ms`);
    } catch (error) {
      console.error('❌ Cache purge failed:', error);
      throw error;
    }
  }

  private async purgeCDNCache(): Promise<void> {
    return withRetry(async () => {
      const response = await fetchWithPool(
        `https://api.bunny.net/pullzone/${this.config.bunnycdn.pullZoneId}/purgeCache`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Accept': 'application/json',
            AccessKey: this.config.bunnycdn.apiKey,
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to purge CDN cache: ${response.statusText} - ${error}`);
      }
    });
  }

  private async purgeStorageCache(): Promise<void> {
    const startTime = performance.now();
    console.log('🔍 Starting cache purge operations...');
    
    // Get pull zone name and list files in parallel with retry
    const fetchStartTime = performance.now();
    const [pullZoneName, files] = await Promise.all([
      withRetry(() => getPullZoneName(
        this.config.bunnycdn.pullZoneId,
        this.config.bunnycdn.apiKey
      )),
      withRetry(() => listStorageZoneFiles(
        this.config.bunnycdn.storageZoneName,
        '__bcdn_perma_cache__',
        this.config.bunnycdn.storageZonePassword
      ) as Promise<FileDetail[]>)
    ]);
    console.log(`📡 Fetched zone info and file list in ${(performance.now() - fetchStartTime).toFixed(0)}ms`);

    const matchingFiles = (files as FileDetail[]).filter(file => 
      file.ObjectName.includes(pullZoneName)
    );
    console.log(`🎯 Found ${matchingFiles.length} matching files to delete`);

    // Delete files in parallel with concurrency limit
    const deleteStartTime = performance.now();
    const concurrencyLimit = 10; // Limit concurrent API calls
    const results = [];
    
    for (let i = 0; i < matchingFiles.length; i += concurrencyLimit) {
      const batch = matchingFiles.slice(i, i + concurrencyLimit).map(file => 
        withRetry(() => deleteStorageZoneFile(
          this.config.bunnycdn.storageZoneName,
          '__bcdn_perma_cache__',
          file.ObjectName,
          this.config.bunnycdn.storageZonePassword
        ))
      );
      const batchResults = await Promise.allSettled(batch);
      results.push(...batchResults);
    }

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const deleteTime = performance.now() - deleteStartTime;
    
    console.log(`📂 Deleted ${successCount} out of ${files.length} cache directories in ${(performance.now() - startTime).toFixed(0)}ms`);
    console.log(`⚡ Delete operations took ${deleteTime.toFixed(0)}ms (${(deleteTime/successCount).toFixed(1)}ms per file)`);
  }
} 