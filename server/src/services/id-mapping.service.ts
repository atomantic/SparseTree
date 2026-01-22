/**
 * ID Mapping Service
 *
 * Handles bidirectional lookups between external provider IDs (FamilySearch, Ancestry, etc.)
 * and canonical ULIDs. Uses in-memory LRU cache for performance.
 */

import { ulid } from 'ulid';
import { sqliteService } from '../db/sqlite.service.js';

// In-memory cache for fast lookups
// Maps: source:externalId -> personId (ULID)
const externalToCanonicalCache = new Map<string, string>();

// Maps: personId (ULID) -> Map<source, externalId>
const canonicalToExternalCache = new Map<string, Map<string, string>>();

// Cache size limit (LRU eviction)
const MAX_CACHE_SIZE = 100000;

/**
 * Generate a cache key for external ID lookups
 */
function cacheKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Evict oldest entries if cache exceeds limit
 */
function evictIfNeeded(): void {
  if (externalToCanonicalCache.size > MAX_CACHE_SIZE) {
    // Simple eviction: remove first 10% of entries
    const toRemove = Math.floor(MAX_CACHE_SIZE * 0.1);
    const keys = externalToCanonicalCache.keys();
    for (let i = 0; i < toRemove; i++) {
      const key = keys.next().value;
      if (key) externalToCanonicalCache.delete(key);
    }
  }
}

/**
 * Get canonical ULID for an external ID
 * Returns undefined if not found
 */
function getCanonicalId(source: string, externalId: string): string | undefined {
  const key = cacheKey(source, externalId);

  // Check cache first
  const cached = externalToCanonicalCache.get(key);
  if (cached) return cached;

  // Query database
  const result = sqliteService.queryOne<{ person_id: string }>(
    'SELECT person_id FROM external_identity WHERE source = @source AND external_id = @externalId',
    { source, externalId }
  );

  if (result) {
    // Cache the result
    externalToCanonicalCache.set(key, result.person_id);
    evictIfNeeded();
    return result.person_id;
  }

  return undefined;
}

/**
 * Get all external IDs for a canonical person ID
 */
function getExternalIds(personId: string): Map<string, string> {
  // Check cache first
  const cached = canonicalToExternalCache.get(personId);
  if (cached) return cached;

  // Query database
  const results = sqliteService.queryAll<{ source: string; external_id: string }>(
    'SELECT source, external_id FROM external_identity WHERE person_id = @personId',
    { personId }
  );

  const externalIds = new Map<string, string>();
  for (const { source, external_id } of results) {
    externalIds.set(source, external_id);
  }

  // Cache the result
  canonicalToExternalCache.set(personId, externalIds);
  return externalIds;
}

/**
 * Get specific external ID for a person and source
 */
function getExternalId(personId: string, source: string): string | undefined {
  return getExternalIds(personId).get(source);
}

/**
 * Create a new canonical person and register external ID
 * Returns the new ULID
 */
function createPerson(
  displayName: string,
  externalSource: string,
  externalId: string,
  options?: {
    birthName?: string;
    gender?: 'male' | 'female' | 'unknown';
    living?: boolean;
    bio?: string;
    url?: string;
  }
): string {
  const personId = ulid();

  sqliteService.transaction(() => {
    // Create person record
    sqliteService.run(
      `INSERT INTO person (person_id, display_name, birth_name, gender, living, bio)
       VALUES (@personId, @displayName, @birthName, @gender, @living, @bio)`,
      {
        personId,
        displayName,
        birthName: options?.birthName ?? null,
        gender: options?.gender ?? 'unknown',
        living: options?.living ? 1 : 0,
        bio: options?.bio ?? null,
      }
    );

    // Register external identity
    sqliteService.run(
      `INSERT INTO external_identity (person_id, source, external_id, url, last_seen_at)
       VALUES (@personId, @source, @externalId, @url, datetime('now'))`,
      {
        personId,
        source: externalSource,
        externalId,
        url: options?.url ?? null,
      }
    );
  });

  // Update cache
  const key = cacheKey(externalSource, externalId);
  externalToCanonicalCache.set(key, personId);
  evictIfNeeded();

  return personId;
}

/**
 * Register an external ID for an existing person
 */
function registerExternalId(
  personId: string,
  source: string,
  externalId: string,
  options?: {
    url?: string;
    confidence?: number;
  }
): void {
  sqliteService.run(
    `INSERT OR REPLACE INTO external_identity (person_id, source, external_id, url, confidence, last_seen_at)
     VALUES (@personId, @source, @externalId, @url, @confidence, datetime('now'))`,
    {
      personId,
      source,
      externalId,
      url: options?.url ?? null,
      confidence: options?.confidence ?? 1.0,
    }
  );

  // Update caches
  const key = cacheKey(source, externalId);
  externalToCanonicalCache.set(key, personId);
  evictIfNeeded();

  // Invalidate reverse cache for this person
  canonicalToExternalCache.delete(personId);
}

/**
 * Remove an external ID mapping
 */
function removeExternalId(source: string, externalId: string): boolean {
  const result = sqliteService.run(
    'DELETE FROM external_identity WHERE source = @source AND external_id = @externalId',
    { source, externalId }
  );

  // Clear from cache
  const key = cacheKey(source, externalId);
  externalToCanonicalCache.delete(key);

  return result.changes > 0;
}

/**
 * Get or create a canonical ID for an external ID
 * If the external ID is not registered, creates a new person
 */
function getOrCreateCanonicalId(
  source: string,
  externalId: string,
  displayName: string,
  options?: {
    birthName?: string;
    gender?: 'male' | 'female' | 'unknown';
    living?: boolean;
    bio?: string;
    url?: string;
  }
): string {
  const existing = getCanonicalId(source, externalId);
  if (existing) return existing;

  return createPerson(displayName, source, externalId, options);
}

/**
 * Resolve an ID that could be either a ULID or an external ID
 * Returns the canonical ULID
 */
function resolveId(id: string, source?: string): string | undefined {
  // Check if it looks like a ULID (26 chars, alphanumeric)
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) {
    // Verify it exists in the database
    const exists = sqliteService.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @id',
      { id }
    );
    if (exists) return id;
  }

  // Try to resolve as external ID
  if (source) {
    return getCanonicalId(source, id);
  }

  // Try common sources in order
  const sources = ['familysearch', 'ancestry', 'wikitree', 'geni', '23andme'];
  for (const s of sources) {
    const canonical = getCanonicalId(s, id);
    if (canonical) return canonical;
  }

  return undefined;
}

/**
 * Batch lookup: get canonical IDs for multiple external IDs
 */
function batchGetCanonicalIds(
  source: string,
  externalIds: string[]
): Map<string, string> {
  const results = new Map<string, string>();
  const uncached: string[] = [];

  // Check cache first
  for (const externalId of externalIds) {
    const key = cacheKey(source, externalId);
    const cached = externalToCanonicalCache.get(key);
    if (cached) {
      results.set(externalId, cached);
    } else {
      uncached.push(externalId);
    }
  }

  // Batch query uncached IDs
  if (uncached.length > 0) {
    // SQLite doesn't support array parameters directly, use placeholders
    const placeholders = uncached.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, string> = { source };
    uncached.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const rows = sqliteService.queryAll<{ external_id: string; person_id: string }>(
      `SELECT external_id, person_id FROM external_identity
       WHERE source = @source AND external_id IN (${placeholders})`,
      params
    );

    for (const { external_id, person_id } of rows) {
      results.set(external_id, person_id);
      // Update cache
      const key = cacheKey(source, external_id);
      externalToCanonicalCache.set(key, person_id);
    }
    evictIfNeeded();
  }

  return results;
}

/**
 * Get all external IDs for a given source
 */
function getAllExternalIds(source: string): { externalId: string; personId: string }[] {
  return sqliteService
    .queryAll<{ external_id: string; person_id: string }>(
      'SELECT external_id, person_id FROM external_identity WHERE source = @source',
      { source }
    )
    .map(({ external_id, person_id }) => ({
      externalId: external_id,
      personId: person_id,
    }));
}

/**
 * Clear all caches
 */
function clearCache(): void {
  externalToCanonicalCache.clear();
  canonicalToExternalCache.clear();
}

/**
 * Get cache statistics
 */
function getCacheStats(): {
  externalToCanonicalSize: number;
  canonicalToExternalSize: number;
} {
  return {
    externalToCanonicalSize: externalToCanonicalCache.size,
    canonicalToExternalSize: canonicalToExternalCache.size,
  };
}

export const idMappingService = {
  getCanonicalId,
  getExternalIds,
  getExternalId,
  createPerson,
  registerExternalId,
  removeExternalId,
  getOrCreateCanonicalId,
  resolveId,
  batchGetCanonicalIds,
  getAllExternalIds,
  clearCache,
  getCacheStats,
};
