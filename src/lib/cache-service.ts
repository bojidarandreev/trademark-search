// src/lib/cache-service.ts

/**
 * Interface for a generic cache service.
 * This allows for different cache implementations (e.g., in-memory, Redis)
 * to be used interchangeably.
 */
export interface ICacheService {
  /**
   * Retrieves an item from the cache.
   * @param key The cache key.
   * @returns The cached item, or undefined if the item does not exist or is expired.
   */
  get<T>(key: string): T | undefined;

  /**
   * Adds or updates an item in the cache with a specific Time To Live (TTL).
   * @param key The cache key.
   * @param value The value to cache.
   * @param ttlSeconds The TTL for this item in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds: number): void;

  /**
   * Deletes an item from the cache.
   * @param key The cache key.
   */
  del(key: string): void;

  /**
   * Checks if an item exists in the cache (and is not expired).
   * @param key The cache key.
   * @returns True if the item exists, false otherwise.
   */
  has(key: string): boolean;

  /**
   * Flushes all items from the cache.
   */
  flushAll(): void;
}

// --- In-Memory Cache Implementation using node-cache ---

import NodeCache from 'node-cache';

class InMemoryCacheService implements ICacheService {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 3600, checkperiodSeconds: number = 600) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds, // Default TTL for new entries
      checkperiod: checkperiodSeconds, // How often to check for expired items
      useClones: false, // For performance, as we're storing JSON-serializable data
    });
    console.log(`InMemoryCacheService initialized with stdTTL: ${ttlSeconds}s, checkperiod: ${checkperiodSeconds}s`);
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set<T>(key: string, value: T, ttlSeconds?: number): void {
    if (ttlSeconds !== undefined) {
      this.cache.set(key, value, ttlSeconds);
    } else {
      this.cache.set(key, value); // Uses stdTTL
    }
  }

  del(key: string): void {
    this.cache.del(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  flushAll(): void {
    this.cache.flushAll();
    console.log('InMemoryCacheService: All items flushed from cache.');
  }

  // Optional: Method to get cache stats for debugging/monitoring
  getStats() {
    return this.cache.getStats();
  }
}

// --- Singleton Instance ---

// Configure TTLs here (in seconds)
const DEFAULT_TTL_SECONDS = 1 * 60 * 60; // 1 hour
const CHECK_PERIOD_SECONDS = 10 * 60; // 10 minutes

let instance: InMemoryCacheService | null = null;

export function getCacheService(): InMemoryCacheService {
  if (!instance) {
    instance = new InMemoryCacheService(DEFAULT_TTL_SECONDS, CHECK_PERIOD_SECONDS);
  }
  return instance;
}

// Example of how to use:
// import { getCacheService } from './cache-service';
// const cache = getCacheService();
// cache.set('myKey', { data: 'some data' }, 60); // Cache for 60 seconds
// const myData = cache.get<{ data: string }>('myKey');
