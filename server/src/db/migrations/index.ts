/**
 * Migration runner - applies pending migrations in order
 */

import { sqliteService } from '../sqlite.service.js';
import * as migration001 from './001_initial.js';
import * as migration002 from './002_expanded_facts.js';

interface Migration {
  name: string;
  up: () => void;
  down: () => void;
}

// Register all migrations in order
const migrations: Migration[] = [
  migration001,
  migration002,
];

/**
 * Run all pending migrations
 */
export function runMigrations(): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];

  // Ensure migration table exists (schema.sql creates it, but be safe)
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  for (const migration of migrations) {
    if (sqliteService.migrationApplied(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    console.log(`[Migrations] Applying: ${migration.name}`);
    migration.up();
    sqliteService.recordMigration(migration.name);
    applied.push(migration.name);
  }

  return { applied, skipped };
}

/**
 * Rollback the last N migrations
 */
export function rollbackMigrations(count: number = 1): string[] {
  const rolledBack: string[] = [];

  // Get applied migrations in reverse order
  const appliedMigrations = sqliteService.queryAll<{ name: string }>(
    'SELECT name FROM migration ORDER BY id DESC LIMIT @count',
    { count }
  );

  for (const { name } of appliedMigrations) {
    const migration = migrations.find((m) => m.name === name);
    if (!migration) {
      console.warn(`[Migrations] Warning: Migration ${name} not found in code`);
      continue;
    }

    console.log(`[Migrations] Rolling back: ${name}`);
    migration.down();
    sqliteService.run('DELETE FROM migration WHERE name = @name', { name });
    rolledBack.push(name);
  }

  return rolledBack;
}

/**
 * Get migration status
 */
export function getMigrationStatus(): {
  applied: string[];
  pending: string[];
} {
  const applied = sqliteService
    .queryAll<{ name: string }>('SELECT name FROM migration ORDER BY id')
    .map((m) => m.name);

  const pending = migrations
    .filter((m) => !applied.includes(m.name))
    .map((m) => m.name);

  return { applied, pending };
}

export { migrations };
