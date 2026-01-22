/**
 * Initial migration - creates base schema
 * The schema is defined in schema.sql and applied automatically on DB init
 * This migration just marks the initial state
 */

import { sqliteService } from '../sqlite.service.js';

export const name = '001_initial';

export function up(): void {
  // Schema is applied via schema.sql on db init
  // This migration just records that initial state was applied
  console.log('[Migration 001] Initial schema applied');
}

export function down(): void {
  // Drop all tables in reverse dependency order
  const tables = [
    'person_fts',
    'provider_mapping',
    'description',
    'media',
    'blob',
    'favorite',
    'database_info',
    'database_membership',
    'claim',
    'vital_event',
    'spouse_edge',
    'parent_edge',
    'external_identity',
    'person',
  ];

  for (const table of tables) {
    sqliteService.run(`DROP TABLE IF EXISTS ${table}`);
  }

  console.log('[Migration 001] All tables dropped');
}
