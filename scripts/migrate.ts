#!/usr/bin/env npx tsx
/**
 * Data Migration Runner
 *
 * Handles both SQLite schema migrations and data format migrations.
 * Run with: npx tsx scripts/migrate.ts [options]
 *
 * Options:
 *   --status      Show migration status
 *   --dry-run     Preview migrations without applying
 *   --rollback=N  Rollback last N migrations
 */

import * as fs from 'fs';
import * as path from 'path';

const __dirname = import.meta.dirname;
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const VERSION_FILE = path.join(DATA_DIR, '.data-version');

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  status: args.includes('--status'),
  dryRun: args.includes('--dry-run'),
  rollback: args.find((a) => a.startsWith('--rollback='))?.split('=')[1],
  help: args.includes('--help') || args.includes('-h'),
};

if (flags.help) {
  console.log(`
Data Migration Runner

Usage: npx tsx scripts/migrate.ts [options]

Options:
  --status      Show migration status (applied and pending)
  --dry-run     Preview migrations without applying
  --rollback=N  Rollback last N migrations
  --help, -h    Show this help message

Examples:
  npx tsx scripts/migrate.ts              # Run all pending migrations
  npx tsx scripts/migrate.ts --status     # Check migration status
  npx tsx scripts/migrate.ts --dry-run    # Preview what would be applied
  npx tsx scripts/migrate.ts --rollback=1 # Rollback last migration
`);
  process.exit(0);
}

interface DataVersion {
  version: string;
  appliedMigrations: string[];
  lastMigratedAt: string;
}

function readDataVersion(): DataVersion {
  if (!fs.existsSync(VERSION_FILE)) {
    return {
      version: '0.0.0',
      appliedMigrations: [],
      lastMigratedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
}

function writeDataVersion(version: DataVersion): void {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(version, null, 2));
}

// Data migrations are defined here
// Each migration has:
// - name: unique identifier
// - description: what it does
// - up: function to apply the migration
// - down: function to rollback (if possible)
interface DataMigration {
  name: string;
  description: string;
  up: (dryRun: boolean) => Promise<{ changed: number; skipped: number }>;
  down?: (dryRun: boolean) => Promise<void>;
}

const dataMigrations: DataMigration[] = [
  {
    name: '001_ensure_data_dirs',
    description: 'Ensure required data directories exist',
    up: async (dryRun) => {
      const dirs = [
        path.join(DATA_DIR, 'person'),
        path.join(DATA_DIR, 'augment'),
        path.join(DATA_DIR, 'favorites'),
        path.join(DATA_DIR, 'photos'),
        path.join(DATA_DIR, 'blobs'),
        path.join(DATA_DIR, 'ai'),
      ];

      let changed = 0;
      let skipped = 0;

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          if (!dryRun) {
            fs.mkdirSync(dir, { recursive: true });
          }
          console.log(`  ${dryRun ? '[DRY-RUN] Would create' : 'Created'}: ${dir}`);
          changed++;
        } else {
          skipped++;
        }
      }

      return { changed, skipped };
    },
  },
  {
    name: '002_init_sqlite',
    description: 'Initialize SQLite database and run schema migrations',
    up: async (dryRun) => {
      if (dryRun) {
        console.log('  [DRY-RUN] Would initialize SQLite database and apply schema');
        return { changed: 1, skipped: 0 };
      }

      // Dynamically import to avoid loading SQLite when not needed
      const { sqliteService } = await import('../server/src/db/sqlite.service.js');
      const { runMigrations } = await import('../server/src/db/migrations/index.js');

      // Initialize database (creates file and applies schema)
      sqliteService.initDb();

      // Run any pending schema migrations
      const result = runMigrations();
      console.log(`  Applied ${result.applied.length} schema migrations`);
      if (result.applied.length > 0) {
        result.applied.forEach((m) => console.log(`    - ${m}`));
      }

      return { changed: result.applied.length, skipped: result.skipped.length };
    },
    down: async (dryRun) => {
      if (dryRun) {
        console.log('  [DRY-RUN] Would remove SQLite database');
        return;
      }
      const dbPath = path.join(DATA_DIR, 'sparsetree.db');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('  Removed SQLite database');
      }
      // Also remove WAL files
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    },
  },
];

async function runDataMigrations(dryRun: boolean): Promise<void> {
  const version = readDataVersion();
  const pending = dataMigrations.filter((m) => !version.appliedMigrations.includes(m.name));

  if (pending.length === 0) {
    console.log('No pending data migrations.');
    return;
  }

  console.log(`\nRunning ${pending.length} data migration(s)${dryRun ? ' (DRY RUN)' : ''}...\n`);

  for (const migration of pending) {
    console.log(`[${migration.name}] ${migration.description}`);

    const result = await migration.up(dryRun);
    console.log(`  Result: ${result.changed} changed, ${result.skipped} skipped\n`);

    if (!dryRun) {
      version.appliedMigrations.push(migration.name);
      version.lastMigratedAt = new Date().toISOString();
      writeDataVersion(version);
    }
  }

  console.log(dryRun ? 'Dry run complete.' : 'All migrations applied successfully.');
}

async function rollbackDataMigrations(count: number, dryRun: boolean): Promise<void> {
  const version = readDataVersion();

  if (version.appliedMigrations.length === 0) {
    console.log('No migrations to rollback.');
    return;
  }

  const toRollback = version.appliedMigrations.slice(-count).reverse();
  console.log(
    `\nRolling back ${toRollback.length} migration(s)${dryRun ? ' (DRY RUN)' : ''}...\n`
  );

  for (const name of toRollback) {
    const migration = dataMigrations.find((m) => m.name === name);

    if (!migration) {
      console.warn(`Warning: Migration ${name} not found in code, skipping rollback`);
      continue;
    }

    if (!migration.down) {
      console.warn(`Warning: Migration ${name} has no rollback function`);
      continue;
    }

    console.log(`[${migration.name}] Rolling back: ${migration.description}`);
    await migration.down(dryRun);

    if (!dryRun) {
      version.appliedMigrations = version.appliedMigrations.filter((m) => m !== name);
      version.lastMigratedAt = new Date().toISOString();
      writeDataVersion(version);
    }
  }

  console.log(dryRun ? 'Dry run complete.' : 'Rollback complete.');
}

function showStatus(): void {
  const version = readDataVersion();
  const pending = dataMigrations.filter((m) => !version.appliedMigrations.includes(m.name));

  console.log('\n=== Data Migration Status ===\n');
  console.log(`Data version file: ${VERSION_FILE}`);
  console.log(`Last migrated: ${version.lastMigratedAt}\n`);

  console.log('Applied migrations:');
  if (version.appliedMigrations.length === 0) {
    console.log('  (none)');
  } else {
    for (const name of version.appliedMigrations) {
      const migration = dataMigrations.find((m) => m.name === name);
      console.log(`  - ${name}: ${migration?.description ?? '(unknown)'}`);
    }
  }

  console.log('\nPending migrations:');
  if (pending.length === 0) {
    console.log('  (none)');
  } else {
    for (const migration of pending) {
      console.log(`  - ${migration.name}: ${migration.description}`);
    }
  }
  console.log('');
}

// Main execution
async function main(): Promise<void> {
  console.log('SparseTree Data Migration Runner\n');

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (flags.status) {
    showStatus();
    return;
  }

  if (flags.rollback) {
    const count = parseInt(flags.rollback, 10);
    if (isNaN(count) || count < 1) {
      console.error('Error: --rollback requires a positive integer');
      process.exit(1);
    }
    await rollbackDataMigrations(count, flags.dryRun);
    return;
  }

  await runDataMigrations(flags.dryRun);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
