/**
 * Migration 004: Add composite index on external_identity(person_id, source)
 *
 * The existing idx_external_identity_person index only covers person_id.
 * Integrity check queries that filter by both person_id and source
 * (e.g., "does this parent have a FamilySearch link?") were hitting
 * idx_external_identity_lookup(source, external_id) instead, causing
 * full scans of all records for that provider (~80K+ rows per lookup).
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '004_external_identity_person_source_index';

export async function up(): Promise<void> {
  logger.db('migration-004', 'Creating composite index on external_identity(person_id, source)');
  sqliteService.getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_external_identity_person_source
    ON external_identity(person_id, source);
  `);
  logger.db('migration-004', 'Index created');
}

export async function down(): Promise<void> {
  sqliteService.getDb().exec(`
    DROP INDEX IF EXISTS idx_external_identity_person_source;
  `);
}
