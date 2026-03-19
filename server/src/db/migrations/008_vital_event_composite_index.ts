/**
 * Migration 008: Add composite index on vital_event(person_id, event_type)
 *
 * The common query pattern "get birth/death/burial for person X" filters on
 * both person_id and event_type. A composite index eliminates the need for
 * SQLite to scan all events for a person and then filter by type.
 */

import { sqliteService } from '../sqlite.service.js';

export const name = '008_vital_event_composite_index';

export function up(): void {
  sqliteService.run(
    'CREATE INDEX IF NOT EXISTS idx_vital_event_person_type ON vital_event(person_id, event_type)'
  );
}

export function down(): void {
  sqliteService.run('DROP INDEX IF EXISTS idx_vital_event_person_type');
}
