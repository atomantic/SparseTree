/**
 * In-memory LRU cache for SQL query results
 *
 * Reduces database load by caching frequently accessed query results.
 * Uses LRU eviction to manage memory.
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
}

interface CacheOptions {
  maxSize?: number;      // Max number of entries
  ttlMs?: number;        // Time-to-live in milliseconds
  name?: string;         // Cache name for logging
}

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;
  private name: string;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.name = options.name ?? 'cache';
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Update LRU order by re-inserting
    this.cache.delete(key);
    entry.hits++;
    this.cache.set(key, entry);
    this.hits++;

    return entry.value;
  }

  set(key: string, value: T): void {
    // Remove if already exists (to update LRU order)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Invalidate all entries matching a prefix
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats() {
    return {
      name: this.name,
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }
}

// Create named caches for different query types
const queryCache = new LRUCache<unknown>({
  maxSize: 2000,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  name: 'query'
});

const personCache = new LRUCache<unknown>({
  maxSize: 5000,
  ttlMs: 10 * 60 * 1000, // 10 minutes
  name: 'person'
});

const listCache = new LRUCache<unknown>({
  maxSize: 100,
  ttlMs: 60 * 1000, // 1 minute - lists change more frequently
  name: 'list'
});

/**
 * Generate a cache key from query and params
 */
function makeCacheKey(query: string, params?: Record<string, unknown>): string {
  const paramsStr = params ? JSON.stringify(params) : '';
  return `${query}:${paramsStr}`;
}

export const cacheService = {
  /**
   * Get or set a cached query result
   */
  query<T>(
    key: string,
    fetcher: () => T
  ): T {
    const cached = queryCache.get(key);
    if (cached !== undefined) {
      return cached as T;
    }

    const result = fetcher();
    queryCache.set(key, result);
    return result;
  },

  /**
   * Get or set a cached person record
   */
  person<T>(
    personId: string,
    fetcher: () => T
  ): T {
    const cached = personCache.get(personId);
    if (cached !== undefined) {
      return cached as T;
    }

    const result = fetcher();
    personCache.set(personId, result);
    return result;
  },

  /**
   * Get or set a cached list result
   */
  list<T>(
    key: string,
    fetcher: () => T
  ): T {
    const cached = listCache.get(key);
    if (cached !== undefined) {
      return cached as T;
    }

    const result = fetcher();
    listCache.set(key, result);
    return result;
  },

  /**
   * Invalidate person cache entries
   */
  invalidatePerson(personId: string): void {
    personCache.delete(personId);
  },

  /**
   * Invalidate all entries for a database
   */
  invalidateDatabase(dbId: string): void {
    queryCache.invalidatePrefix(`db:${dbId}:`);
    listCache.invalidatePrefix(`db:${dbId}:`);
  },

  /**
   * Clear all caches
   */
  clearAll(): void {
    queryCache.clear();
    personCache.clear();
    listCache.clear();
  },

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      query: queryCache.getStats(),
      person: personCache.getStats(),
      list: listCache.getStats()
    };
  },

  /**
   * Helper to make cache keys
   */
  makeKey: makeCacheKey
};
