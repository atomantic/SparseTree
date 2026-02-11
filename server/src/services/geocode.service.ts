/**
 * Geocoding service - resolves place text to coordinates using Nominatim
 *
 * Caches results in the place_geocode SQLite table so places are only
 * geocoded once. Not-found places are permanently marked to avoid
 * re-querying Nominatim.
 */

import { sqliteService } from '../db/sqlite.service.js';
import { logger } from '../lib/logger.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SparseTree/0.7.0 (genealogy toolkit)';
const REQUEST_DELAY_MS = 1100; // Nominatim requires 1 req/sec max
const RATE_LIMIT_PAUSE_MS = 60_000;

interface GeocodeRow {
  place_text: string;
  lat: number | null;
  lng: number | null;
  display_name: string | null;
  geocode_status: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

function normalizePlaceText(text: string): string {
  return text.toLowerCase().trim();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Look up a place in the cache, optionally geocoding if not found
 */
function lookupPlace(placeText: string): GeocodeRow | undefined {
  const normalized = normalizePlaceText(placeText);
  return sqliteService.queryOne<GeocodeRow>(
    'SELECT place_text, lat, lng, display_name, geocode_status FROM place_geocode WHERE place_text = @text',
    { text: normalized }
  );
}

/**
 * Insert or update a place geocode record
 */
function upsertPlace(
  placeText: string,
  lat: number | null,
  lng: number | null,
  displayName: string | null,
  status: 'resolved' | 'not_found' | 'error'
): void {
  const normalized = normalizePlaceText(placeText);
  sqliteService.run(
    `INSERT INTO place_geocode (place_text, lat, lng, display_name, geocode_status, geocoded_at)
     VALUES (@text, @lat, @lng, @displayName, @status, datetime('now'))
     ON CONFLICT(place_text) DO UPDATE SET
       lat = @lat, lng = @lng, display_name = @displayName,
       geocode_status = @status, geocoded_at = datetime('now')`,
    { text: normalized, lat, lng, displayName, status }
  );
}

/**
 * Ensure a place_text is inserted as pending (for tracking before geocoding)
 */
function ensurePending(placeText: string): void {
  const normalized = normalizePlaceText(placeText);
  sqliteService.run(
    `INSERT OR IGNORE INTO place_geocode (place_text, geocode_status) VALUES (@text, 'pending')`,
    { text: normalized }
  );
}

/**
 * Single Nominatim request with rate-limit handling
 */
async function fetchNominatim(query: string): Promise<NominatimResult | null> {
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ q: query, format: 'json', limit: '1' })}`;

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (response.status === 429) {
    logger.warn('geocode', `⏳ Rate limited by Nominatim, pausing ${RATE_LIMIT_PAUSE_MS / 1000}s`);
    await delay(RATE_LIMIT_PAUSE_MS);
    const retry = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!retry.ok) return null;
    const retryData: NominatimResult[] = await retry.json();
    return retryData[0] || null;
  }

  if (!response.ok) return null;

  const data: NominatimResult[] = await response.json();
  return data[0] || null;
}

/**
 * Query Nominatim with progressive broadening.
 * For comma-separated places like "Cornouaile, Visseiche, Ille-et-Vilaine, Brittany, France",
 * if the full query returns no results, progressively strip the leftmost (most specific)
 * segment and retry with broader locations. Stops at 2 remaining segments minimum.
 */
async function queryNominatim(placeText: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const parts = placeText.split(',').map(s => s.trim()).filter(Boolean);

  // Try full query first, then progressively broader
  for (let skip = 0; skip <= parts.length - 2; skip++) {
    const query = parts.slice(skip).join(', ');
    const result = await fetchNominatim(query);

    if (result) {
      if (skip > 0) {
        logger.ok('geocode', `🔍 Broadened "${placeText}" → "${query}"`);
      }
      return { lat: parseFloat(result.lat), lng: parseFloat(result.lon), displayName: result.display_name };
    }

    // Rate limit delay before next broadening attempt
    if (skip < parts.length - 2) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  return null;
}

export interface GeocodeProgress {
  type: 'progress' | 'complete';
  current: number;
  total: number;
  place?: string;
  status?: 'resolved' | 'not_found' | 'error' | 'cached';
}

/**
 * Batch geocode a list of places, yielding progress events.
 * Skips places already resolved or marked not_found.
 */
async function* batchGeocode(places: string[]): AsyncGenerator<GeocodeProgress> {
  const total = places.length;

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const normalized = normalizePlaceText(place);

    // Check cache first
    const cached = lookupPlace(normalized);
    if (cached && (cached.geocode_status === 'resolved' || cached.geocode_status === 'not_found')) {
      yield { type: 'progress', current: i + 1, total, place, status: 'cached' };
      continue;
    }

    // Ensure pending record exists
    ensurePending(normalized);

    // Query Nominatim
    const result = await queryNominatim(normalized);

    if (result) {
      upsertPlace(normalized, result.lat, result.lng, result.displayName, 'resolved');
      logger.ok('geocode', `📍 Resolved: "${place}" → ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
      yield { type: 'progress', current: i + 1, total, place, status: 'resolved' };
    } else {
      upsertPlace(normalized, null, null, null, 'not_found');
      logger.warn('geocode', `❓ Not found: "${place}"`);
      yield { type: 'progress', current: i + 1, total, place, status: 'not_found' };
    }

    // Rate limit delay (skip on last item)
    if (i < places.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  yield { type: 'complete', current: total, total };
}

/**
 * Get geocoding statistics
 */
function getGeocodeStats(): { resolved: number; pending: number; notFound: number; error: number; total: number } {
  const rows = sqliteService.queryAll<{ geocode_status: string; count: number }>(
    'SELECT geocode_status, COUNT(*) as count FROM place_geocode GROUP BY geocode_status'
  );
  const stats = { resolved: 0, pending: 0, notFound: 0, error: 0, total: 0 };
  for (const row of rows) {
    if (row.geocode_status === 'resolved') stats.resolved = row.count;
    else if (row.geocode_status === 'pending') stats.pending = row.count;
    else if (row.geocode_status === 'not_found') stats.notFound = row.count;
    else if (row.geocode_status === 'error') stats.error = row.count;
    stats.total += row.count;
  }
  return stats;
}

/**
 * Get all resolved geocode entries as a lookup map
 */
function getResolvedCoords(): Map<string, { lat: number; lng: number; displayName: string }> {
  const rows = sqliteService.queryAll<GeocodeRow>(
    "SELECT place_text, lat, lng, display_name FROM place_geocode WHERE geocode_status = 'resolved'"
  );
  const map = new Map<string, { lat: number; lng: number; displayName: string }>();
  for (const row of rows) {
    if (row.lat !== null && row.lng !== null) {
      map.set(row.place_text, { lat: row.lat, lng: row.lng, displayName: row.display_name || row.place_text });
    }
  }
  return map;
}

/**
 * Reset all not_found entries to pending so they get retried with broadening
 */
function resetNotFound(): number {
  const result = sqliteService.run(
    "UPDATE place_geocode SET geocode_status = 'pending', geocoded_at = NULL WHERE geocode_status = 'not_found'"
  );
  return result.changes;
}

export const geocodeService = {
  lookupPlace,
  batchGeocode,
  getGeocodeStats,
  getResolvedCoords,
  normalizePlaceText,
  resetNotFound,
};
