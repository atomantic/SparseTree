/**
 * Migration 009: cause of death support
 *
 * - Adds `is_unusual_death` flag on person (manual user override)
 * - Creates unusual_death_keywords table for auto-classification
 * - Seeds keyword table with a starter list of weird/notable death modes
 *
 * Cause + circumstance text live in the existing `claim` table
 * (predicate='causeOfDeath' / 'deathCircumstance') and `life_event.cause`,
 * so no new columns are needed for those. User edits flow through
 * `local_override` like every other person field.
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '009_cause_of_death';

const SEED_KEYWORDS = [
  // violent
  'slain', 'slew', 'killed in battle', 'murdered', 'assassinated', 'beheaded',
  'decapitated', 'executed', 'hanged', 'guillotin', 'crucified', 'stabbed',
  'shot', 'gunshot', 'poisoned', 'strangled',
  // misadventure
  'drowned', 'devoured', 'eaten by', 'mauled', 'trampled', 'crushed',
  'fell from', 'fell into', 'thrown from', 'gored',
  // disease / unusual medical
  'plague', 'leprosy', 'consumption', 'cholera',
  // elemental
  'struck by lightning', 'lightning', 'froze to death', 'starved',
  'burned to death', 'burnt to death', 'consumed by fire',
  // mythic / legendary
  'dragon', 'serpent', 'wolves', 'bear ', 'shipwreck', 'duel',
  'broken heart', 'died of grief',
  // industrial era
  'mining accident', 'train accident', 'railway accident',
  // labels
  'martyrdom', 'martyred', 'suicide',
];

export function up(): void {
  logger.db('migration-009', 'Adding cause-of-death support');
  sqliteService.run(`
    ALTER TABLE person ADD COLUMN is_unusual_death INTEGER DEFAULT 0
  `);
  sqliteService.run(
    'CREATE INDEX IF NOT EXISTS idx_person_unusual_death ON person(is_unusual_death) WHERE is_unusual_death = 1'
  );

  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS unusual_death_keyword (
      keyword TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  for (const keyword of SEED_KEYWORDS) {
    sqliteService.run(
      'INSERT OR IGNORE INTO unusual_death_keyword (keyword) VALUES (@keyword)',
      { keyword: keyword.toLowerCase() }
    );
  }
  logger.db('migration-009', `Seeded ${SEED_KEYWORDS.length} unusual-death keywords`);
}

export function down(): void {
  sqliteService.run('DROP TABLE IF EXISTS unusual_death_keyword');
  sqliteService.run('DROP INDEX IF EXISTS idx_person_unusual_death');
  // SQLite ALTER DROP COLUMN requires 3.35+; assume modern sqlite
  sqliteService.run('ALTER TABLE person DROP COLUMN is_unusual_death');
}
