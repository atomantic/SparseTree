/**
 * Migration 005: Add discovery_dismissed table
 *
 * Tracks candidates that AI discovery suggested but the user marked as
 * "not interesting". This allows:
 * 1. Excluding them from future discoveries
 * 2. Potential future learning/feedback for AI
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '005_discovery_dismissed';

export async function up(): Promise<void> {
  logger.db('migration-005', 'Creating discovery_dismissed table');
  sqliteService.getDb().exec(`
    CREATE TABLE IF NOT EXISTS discovery_dismissed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      db_id TEXT NOT NULL,
      person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
      ai_reason TEXT,
      ai_tags TEXT,
      dismissed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(db_id, person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_discovery_dismissed_db ON discovery_dismissed(db_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_dismissed_person ON discovery_dismissed(person_id);
  `);
  logger.db('migration-005', 'discovery_dismissed table created');
}

export async function down(): Promise<void> {
  sqliteService.getDb().exec(`
    DROP INDEX IF EXISTS idx_discovery_dismissed_person;
    DROP INDEX IF EXISTS idx_discovery_dismissed_db;
    DROP TABLE IF EXISTS discovery_dismissed;
  `);
}
