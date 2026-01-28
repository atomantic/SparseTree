/**
 * Migration 003: Rebuild FTS5 index
 *
 * The original schema used content='' (external content mode) which doesn't
 * actually store any searchable content. This migration rebuilds the FTS5
 * table with stored content.
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '003_rebuild_fts';

export async function up(): Promise<void> {
  // Check if FTS table exists and has content
  const ftsCount = sqliteService.queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM person_fts"
  );

  const personCount = sqliteService.queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM person"
  );

  // If FTS has significantly fewer records or empty content, rebuild
  if (!ftsCount || !personCount || ftsCount.count < personCount.count * 0.9) {
    logger.db('migration-003', `Rebuilding FTS5 index...`);

    // Drop and recreate
    sqliteService.getDb().exec(`
      DROP TABLE IF EXISTS person_fts;

      CREATE VIRTUAL TABLE person_fts USING fts5(
        person_id UNINDEXED,
        display_name,
        birth_name,
        aliases,
        bio,
        occupations
      );

      INSERT INTO person_fts (person_id, display_name, birth_name, aliases, bio, occupations)
      SELECT
        p.person_id,
        p.display_name,
        COALESCE(p.birth_name, ''),
        '',
        COALESCE(p.bio, ''),
        COALESCE((SELECT GROUP_CONCAT(c.value_text, ' ') FROM claim c WHERE c.person_id = p.person_id AND c.predicate = 'occupation'), '')
      FROM person p;
    `);

    const newCount = sqliteService.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM person_fts"
    );
    logger.db('migration-003', `FTS5 index rebuilt with ${newCount?.count ?? 0} entries`);
  } else {
    logger.skip('migration-003', `FTS5 index already populated, skipping rebuild`);
  }
}

export async function down(): Promise<void> {
  // Can't really undo this - the old contentless table was broken anyway
  logger.skip('migration-003', `No rollback for FTS rebuild`);
}
