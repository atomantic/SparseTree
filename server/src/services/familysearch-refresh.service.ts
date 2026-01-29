/**
 * FamilySearch Refresh Service
 *
 * Handles refreshing person data from FamilySearch API instead of Playwright scraping.
 * Extracts auth token from browser session and uses the existing API-based fetching system.
 */

import FamilySearch from 'fs-js-lite';
import fs from 'fs';
import path from 'path';
import { browserService } from './browser.service.js';
import { providerService } from './provider.service.js';
import { idMappingService } from './id-mapping.service.js';
import { sqliteWriter } from '../lib/sqlite-writer.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - transformer.js doesn't have type declarations
import { json2person } from '../lib/familysearch/transformer.js';
import type { PersonWithId } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');
const FS_CACHE_DIR = path.join(PROVIDER_CACHE_DIR, 'familysearch');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROVIDER_CACHE_DIR)) fs.mkdirSync(PROVIDER_CACHE_DIR, { recursive: true });
if (!fs.existsSync(FS_CACHE_DIR)) fs.mkdirSync(FS_CACHE_DIR, { recursive: true });

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

/**
 * Create a FamilySearch API client with a specific access token
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createFsClient(accessToken: string): any {
  return new FamilySearch({
    environment: 'production',
    appKey: '',
    accessToken,
    saveAccessToken: false,
    tokenCookie: 'FS_AUTH_TOKEN',
    tokenCookiePath: '/',
    maxThrottledRetries: 3,
  });
}

/**
 * Fetch person data from FamilySearch API using the browser session token
 */
async function fetchPersonFromApi(
  fsId: string,
  accessToken: string
): Promise<{ data: unknown; currentFsId: string; wasRedirected: boolean }> {
  return new Promise((resolve, reject) => {
    const client = createFsClient(accessToken);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.get(`/platform/tree/persons/${fsId}`, (error: Error | null, response: any) => {
      if (error) {
        return reject(new Error(`Network error: ${error.message}`));
      }

      if (response.statusCode === 401) {
        return reject(new Error('Not authenticated with FamilySearch. Please log in via the browser.'));
      }

      if (response.statusCode === 404) {
        return reject(new Error(`Person ${fsId} not found on FamilySearch`));
      }

      if (response.statusCode >= 400) {
        const errorMsg = response.data?.errors?.[0]?.message || `API error: ${response.statusCode}`;
        return reject(new Error(errorMsg));
      }

      // Check if person was redirected (merged)
      const returnedFsId = response.data?.persons?.[0]?.id;
      const wasRedirected = returnedFsId !== fsId;

      resolve({
        data: response.data,
        currentFsId: returnedFsId || fsId,
        wasRedirected,
      });
    });
  });
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
   * 5. Write to JSON cache and SQLite
   * 6. Handle redirects/merges (update ID mappings)
   */
  async refreshPerson(dbId: string, personId: string): Promise<RefreshResult> {
    // Resolve to canonical ID
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get the FamilySearch ID
    const fsId = idMappingService.getExternalId(canonical, 'familysearch');
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

    logger.data('fs-refresh', `Got: ${person.name || 'unknown'}, birth: ${person.birthDate || 'n/a'}`);

    // Write to JSON cache (use the current/actual FS ID)
    const jsonPath = path.join(FS_CACHE_DIR, `${currentFsId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(apiData, null, 2));
    logger.cache('fs-refresh', `Cached FS data for ${currentFsId}`);

    // If redirected, also remove old cache file and update ID mapping
    if (wasRedirected && currentFsId !== fsId) {
      logger.sync('fs-refresh', `Person merged: ${fsId} → ${currentFsId}`);
      const oldJsonPath = path.join(FS_CACHE_DIR, `${fsId}.json`);
      if (fs.existsSync(oldJsonPath)) {
        fs.unlinkSync(oldJsonPath);
      }

      // Update the external ID mapping
      idMappingService.registerExternalId(canonical, 'familysearch', currentFsId, {
        url: `https://www.familysearch.org/tree/person/details/${currentFsId}`,
        confidence: 1.0,
      });

      // Remove the old external ID mapping
      idMappingService.removeExternalId('familysearch', fsId);
    }

    // Write to SQLite (use generation 0 since we don't know the actual generation)
    // The writePerson function will update the existing record
    sqliteWriter.writePerson(currentFsId, person, 0);

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
