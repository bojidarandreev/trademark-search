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

import NodeCache from "node-cache";

class InMemoryCacheService implements ICacheService {
  private cache: NodeCache;
  private lastGlobalFlushIsoWeekDate: string | null = null; // Stores 'YYYY-Www-D' e.g. '2023-W40-5' for Friday

  constructor(ttlSeconds: number = 3600, checkperiodSeconds: number = 600) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds, // Default TTL for new entries
      checkperiod: checkperiodSeconds, // How often to check for expired items
      useClones: false, // For performance, as we're storing JSON-serializable data
    });
    console.log(
      `InMemoryCacheService initialized with stdTTL: ${ttlSeconds}s, checkperiod: ${checkperiodSeconds}s. Checking for initial flush.`
    );
    this.ensureWeeklyFlush(); // Check on initialization
  }

  // Helper to get ISO week date string: YYYY-Www-D (e.g., 2023-W40-5 for Friday)
  // This helps ensure the flush happens only once per designated day in a given week.
  private getIsoWeekDateString(date: Date): string {
    const year = date.getUTCFullYear();
    // Calculate ISO week number
    const d = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7; // Get day number (0=Sunday, 1=Monday,..., 6=Saturday), make Sunday 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Set to nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
    );
    const dayOfWeek = date.getUTCDay() || 7; // 1 (Mon) - 7 (Sun), making Friday 5
    return `${year}-W${String(weekNo).padStart(2, "0")}-${dayOfWeek}`;
  }

  private ensureWeeklyFlush(): void {
    const now = new Date();
    const currentIsoWeekDate = this.getIsoWeekDateString(now); // e.g., "2023-W40-5" for a Friday
    const currentDayOfWeek = now.getUTCDay(); // 0 (Sun) - 6 (Sat), so Friday is 5

    // Target: Flush on Friday (day 5)
    const FLUSH_DAY_OF_WEEK = 5; // 5 for Friday

    if (currentDayOfWeek === FLUSH_DAY_OF_WEEK) {
      if (this.lastGlobalFlushIsoWeekDate !== currentIsoWeekDate) {
        console.log(
          `[CACHE_SERVICE] It's Friday (${currentIsoWeekDate}). Flushing all cache entries.`
        );
        this.cache.flushAll();
        this.lastGlobalFlushIsoWeekDate = currentIsoWeekDate; // Mark that flush for this specific Friday has occurred
        console.log(
          `[CACHE_SERVICE] Cache flushed. Next flush scheduled for next Friday. Last flush marked for: ${this.lastGlobalFlushIsoWeekDate}`
        );
      } else {
        // console.log(`[CACHE_SERVICE] It's Friday, but cache has already been flushed this week on ${this.lastGlobalFlushIsoWeekDate}.`);
      }
    } else {
      // console.log(`[CACHE_SERVICE] Not Friday. Current ISO week date: ${currentIsoWeekDate}. Last flush was on ${this.lastGlobalFlushIsoWeekDate || 'never'}.`);
      // If it's no longer Friday, but the last flush was for a *previous* week's Friday,
      // we should reset lastGlobalFlushIsoWeekDate if the week number has changed,
      // ensuring that if the server restarts on a Thursday, it knows it missed the previous Friday's flush window
      // and is ready for the upcoming one.
      // However, a simpler approach is that it will just correctly flush on the *next* actual Friday it encounters.
      // The current check `this.lastGlobalFlushIsoWeekDate !== currentIsoWeekDate` on Friday itself is sufficient.
    }
  }

  get<T>(key: string): T | undefined {
    this.ensureWeeklyFlush(); // Check before any cache operation
    return this.cache.get<T>(key);
  }

  set<T>(key: string, value: T, ttlSeconds?: number): void {
    this.ensureWeeklyFlush(); // Check before any cache operation
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
    console.log("InMemoryCacheService: All items flushed from cache.");
  }

  // Optional: Method to get cache stats for debugging/monitoring
  getStats() {
    return this.cache.getStats();
  }
}

// --- Singleton Instance ---

// Configure TTLs here (in seconds)
// Set to just under 7 days (6 days, 22 hours) to align with weekly Friday updates.
// 6 days * 24 hours/day * 60 minutes/hour * 60 seconds/minute = 518400 seconds
// 22 hours * 60 minutes/hour * 60 seconds/minute = 79200 seconds
// Total = 518400 + 79200 = 597600 seconds
const DEFAULT_TTL_SECONDS = 597600; // 6 days and 22 hours
const CHECK_PERIOD_SECONDS = 1 * 60 * 60; // Check for expired items every 1 hour (can be less frequent with long TTLs)

let instance: InMemoryCacheService | null = null;

export function getCacheService(): InMemoryCacheService {
  if (!instance) {
    instance = new InMemoryCacheService(
      DEFAULT_TTL_SECONDS,
      CHECK_PERIOD_SECONDS
    );
  }
  return instance;
}

// Example of how to use:
// import { getCacheService } from './cache-service';
// const cache = getCacheService();
// cache.set('myKey', { data: 'some data' }, 60); // Cache for 60 seconds
// const myData = cache.get<{ data: string }>('myKey');
