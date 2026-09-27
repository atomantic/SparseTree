/**
 * FamilySearch Refresh Service
 *
 * Handles refreshing person data from FamilySearch API instead of Playwright scraping.
 * Extracts auth token from browser session and uses the existing API-based fetching system.
 */

import { createFamilySearchClient } from '../lib/familysearch/client.js';
import fs from 'fs';
import path from 'path';
import { browserService } from './browser.service.js';
import { providerService } from './provider.service.js';
import { postgresService } from '../db/postgres.service.js';
import { idMappingService } from './id-mapping.service.js';
import { syncPeople } from '../lib/postgres-person-sync.js';
import { sanitizePersonId } from '../utils/validation.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - transformer.js doesn't have type declarations
import { json2person } from '../lib/familysearch/transformer.js';
import type { PersonWithId } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { logger } from '../lib/logger.js';
import { PROVIDER_CACHE_DIR, PERSON_CACHE_DIR, ensureDir } from '../utils/paths.js';

const FS_CACHE_DIR = path.join(PROVIDER_CACHE_DIR, 'familysearch');
ensureDir(FS_CACHE_DIR);
ensureDir(PERSON_CACHE_DIR);

export interface RefreshResult {
  success: boolean;
  wasRedirected?: boolean;
  originalFsId?: string;
  currentFsId?: string;
  newFsId?: string;
  error?: string;
  person?: PersonWithId | null;
  lastRefreshed?: string;
}

/** Fetch using an isolated browser-session token; never mutate the CLI client. */
async function fetchPersonFromApi(
  fsId: string,
  accessToken: string
): Promise<{ data: unknown; currentFsId: string; wasRedirected: boolean }> {
  const client = createFamilySearchClient({ accessToken, maxThrottledRetries: 3 });
  const response = await client.get<{ persons?: Array<{ id?: string }>; errors?: Array<{ message?: string }> }>(
    `/platform/tree/persons/${encodeURIComponent(fsId)}`
  );
  if (response.statusCode === 401) {
    throw new Error('Not authenticated with FamilySearch. Please log in via the browser.');
  }
  if (response.statusCode === 404) throw new Error(`Person ${fsId} not found on FamilySearch`);
  if (response.statusCode >= 400) {
    throw new Error(response.data?.errors?.[0]?.message || `API error: ${response.statusCode}`);
  }
  const returnedFsId = response.data?.persons?.[0]?.id;
  return {
    data: response.data,
    currentFsId: returnedFsId || fsId,
    wasRedirected: !!returnedFsId && returnedFsId !== fsId,
  };
}

export const familySearchRefreshService = {
  /**
   * Refresh a single person's data from FamilySearch API
   *
   * Flow:
   * 1. Resolve canonical ID → FamilySearch ID
   * 2. Extract auth token from browser session
   * 3. Fetch fresh data from FamilySearch API
   * 4. Transform via json2person()
   * 5. Write to JSON cache and PostgreSQL
   * 6. Handle redirects/merges (update ID mappings)
   */
  async refreshPerson(dbId: string, personId: string): Promise<RefreshResult> {
    // Resolve to canonical ID
    const canonical = await idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get the FamilySearch ID
    const fsId = await idMappingService.getExternalId(canonical, 'familysearch');
    if (!fsId) {
      return {
        success: false,
        error: 'Person has no linked FamilySearch ID',
      };
    }

    // Verify browser connection is truly active (not stale) and reconnect if needed
    const browserReady = await browserService.verifyAndReconnect();
    if (!browserReady) {
      return {
        success: false,
        error: 'Browser not connected. Please connect browser in Settings.',
      };
    }

    // Extract auth token from browser session
    let { token } = await browserService.getFamilySearchToken();

    // If no token, attempt auto-login and retry
    if (!token) {
      logger.auth('fs-refresh', 'No auth token found, attempting auto-login...');
      const authResult = await providerService.ensureAuthenticated('familysearch');

      if (authResult.authenticated) {
        // Retry getting the token after successful login
        const retryResult = await browserService.getFamilySearchToken();
        token = retryResult.token;
      }

      if (!token) {
        const errorMsg = authResult.error || 'No FamilySearch authentication found. Please log in to FamilySearch via the browser.';
        return {
          success: false,
          error: errorMsg,
        };
      }
    }

    // Fetch fresh data from FamilySearch API
    logger.api('fs-refresh', `Fetching FS data for ${fsId}...`);
    logger.time('fs-refresh', `fetch-${fsId}`);
    let apiData: unknown;
    let currentFsId: string;
    let wasRedirected: boolean;

    const fetchResult = await fetchPersonFromApi(fsId, token).catch(err => ({
      error: err.message as string,
    }));

    if ('error' in fetchResult) {
      logger.timeEnd('fs-refresh', `fetch-${fsId}`);
      logger.error('fs-refresh', `Failed to fetch ${fsId}: ${fetchResult.error}`);
      return {
        success: false,
        originalFsId: fsId,
        error: fetchResult.error,
      };
    }

    apiData = fetchResult.data;
    currentFsId = fetchResult.currentFsId;
    wasRedirected = fetchResult.wasRedirected;
    logger.timeEnd('fs-refresh', `fetch-${fsId}`);

    // Transform the API data
    const person = json2person(apiData);
    if (!person) {
      return {
        success: false,
        originalFsId: fsId,
        currentFsId,
        wasRedirected,
        error: 'Failed to parse person data from FamilySearch',
      };
    }

    logger.data('fs-refresh', `Got: ${person.name || 'unknown'}, birth: ${person.birth?.date || 'n/a'}`);

    // Keep the raw JSON cache authoritative for future rebuilds.
    const safeCurrentId = sanitizePersonId(currentFsId);
    const safeOriginalId = sanitizePersonId(fsId);
    const rawJson = JSON.stringify(apiData, null, 2);
    fs.writeFileSync(path.join(FS_CACHE_DIR, `${safeCurrentId}.json`), rawJson);
    fs.writeFileSync(path.join(PERSON_CACHE_DIR, `${safeCurrentId}.json`), rawJson);

    // Mapping changes and normalized writes share a transaction with the same
    // rebuild lock. No partial redirect can strand the local overrides/media.
    await postgresService.transaction(async tx => {
      await tx.run('SELECT pg_advisory_xact_lock(hashtext(@key))', { key: 'sparsetree:json-rebuild' });
      if (wasRedirected && currentFsId !== fsId) {
        await idMappingService.registerExternalId(canonical, 'familysearch', currentFsId, {
          url: `https://www.familysearch.org/tree/person/details/${currentFsId}`,
          confidence: 1.0,
        }, tx);
        await idMappingService.removeExternalId('familysearch', fsId, tx);
      }
      await syncPeople(tx, [currentFsId], { [currentFsId]: person }, new Map([[currentFsId, canonical]]));
    });

    if (wasRedirected && currentFsId !== fsId) {
      // Retain data/person's old raw record: other JSON graphs may still reference
      // that provider ID. Only the expendable refresh cache follows the redirect.
      const oldJsonPath = path.join(FS_CACHE_DIR, `${safeOriginalId}.json`);
      if (fs.existsSync(oldJsonPath)) fs.unlinkSync(oldJsonPath);
    }

    // Get the updated person data from the database
    const updatedPerson = await databaseService.getPerson(dbId, canonical);

    logger.ok('fs-refresh', `Refreshed ${currentFsId} successfully`);

    return {
      success: true,
      wasRedirected,
      originalFsId: fsId,
      currentFsId,
      newFsId: wasRedirected ? currentFsId : undefined,
      person: updatedPerson,
      lastRefreshed: new Date().toISOString(),
    };
  },

  /**
   * Get cached FamilySearch data for a person from JSON cache
   * Returns null if not cached
   */
  getCachedPersonData(fsId: string): unknown | null {
    const jsonPath = path.join(FS_CACHE_DIR, `${fsId}.json`);
    if (!fs.existsSync(jsonPath)) return null;

    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
  },

  /**
   * Get parsed person data from cache
   */
  getParsedCachedData(fsId: string): ReturnType<typeof json2person> | null {
    const rawData = this.getCachedPersonData(fsId);
    if (!rawData) return null;
    return json2person(rawData);
  },

  /**
   * Fetch just the display name for a FamilySearch person ID.
   * Checks local cache first, then falls back to API call.
   * Caches the API response for future use.
   */
  async fetchPersonDisplayName(fsId: string): Promise<string | null> {
    // Check cache first
    const cached = this.getParsedCachedData(fsId);
    if (cached?.name) return cached.name;

    // Verify browser connection and reconnect if needed
    const browserReady = await browserService.verifyAndReconnect();
    if (!browserReady) return null;

    let { token } = await browserService.getFamilySearchToken().catch(() => ({ token: null }));

    // If no token, attempt auto-login and retry
    if (!token) {
      const authResult = await providerService.ensureAuthenticated('familysearch').catch(() => ({ authenticated: false }));
      if (authResult.authenticated) {
        const retryResult = await browserService.getFamilySearchToken().catch(() => ({ token: null }));
        token = retryResult.token;
      }
    }

    if (!token) return null;

    const fetchResult = await fetchPersonFromApi(fsId, token).catch(() => null);
    if (!fetchResult || 'error' in fetchResult) return null;

    // Cache the response for future use
    const jsonPath = path.join(FS_CACHE_DIR, `${fetchResult.currentFsId}.json`);
    if (!fs.existsSync(jsonPath)) {
      fs.writeFileSync(jsonPath, JSON.stringify(fetchResult.data, null, 2));
      logger.cache('fs-refresh', `Cached parent data for ${fetchResult.currentFsId}`);
    }

    const person = json2person(fetchResult.data);
    return person?.name || null;
  },

  /**
   * Check when person data was last refreshed (based on file modification time)
   */
  getLastRefreshed(fsId: string): Date | null {
    const jsonPath = path.join(FS_CACHE_DIR, `${fsId}.json`);
    if (!fs.existsSync(jsonPath)) return null;

    const stats = fs.statSync(jsonPath);
    return stats.mtime;
  },
};
