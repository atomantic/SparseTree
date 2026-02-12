/**
 * Migration 006: Add place_geocode table
 *
 * Caches geocoded coordinates for place text strings.
 * Used by the migration map visualization to plot ancestors
 * on a world map with migration lines.
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '006_place_geocode';

export async function up(): Promise<void> {
  logger.db('migration-006', 'Creating place_geocode table');
  sqliteService.getDb().exec(`
    CREATE TABLE IF NOT EXISTS place_geocode (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_text TEXT NOT NULL UNIQUE,
      lat REAL,
      lng REAL,
      display_name TEXT,
      geocode_status TEXT NOT NULL DEFAULT 'pending' CHECK(geocode_status IN ('pending', 'resolved', 'not_found', 'error')),
      geocoded_at TEXT,
      source TEXT DEFAULT 'nominatim'
    );

    CREATE INDEX IF NOT EXISTS idx_place_geocode_text ON place_geocode(place_text);
    CREATE INDEX IF NOT EXISTS idx_place_geocode_status ON place_geocode(geocode_status);
  `);
  logger.db('migration-006', 'place_geocode table created');
}

export async function down(): Promise<void> {
  sqliteService.getDb().exec(`
    DROP INDEX IF EXISTS idx_place_geocode_status;
    DROP INDEX IF EXISTS idx_place_geocode_text;
    DROP TABLE IF EXISTS place_geocode;
  `);
}
