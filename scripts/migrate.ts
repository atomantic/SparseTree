#!/usr/bin/env npx tsx
/** Apply the versioned PostgreSQL baseline and forward migrations. */
import { postgresService } from '../server/src/db/postgres.service.js';

const args = new Set(process.argv.slice(2));
const help = args.has('--help') || args.has('-h');
const status = args.has('--status');
const dryRun = args.has('--dry-run');
const rollback = [...args].find((arg) => arg.startsWith('--rollback='));

function usage(): void {
  console.log(`
PostgreSQL Schema Migrations

Usage: DATABASE_URL=... npx tsx scripts/migrate.ts [options]

Options:
  --status      Show applied and pending PostgreSQL migrations
  --dry-run     List migrations that would be applied
  --help, -h    Show this help message

Schema changes are forward-only. Add a new versioned migration instead of
editing an applied migration; rebuildable query-store data can be rebuilt from JSON.
`);
}

async function main(): Promise<void> {
  if (help) {
    usage();
    return;
  }
  if (rollback) {
    throw new Error('PostgreSQL schema migrations are forward-only; use a database backup for recovery.');
  }
  if (args.size > Number(status) + Number(dryRun)) {
    throw new Error('Unknown migration option. Run scripts/migrate.ts --help.');
  }
  if (!postgresService.isConfigured()) {
    throw new Error('Set DATABASE_URL before running PostgreSQL schema migrations.');
  }

  const before = await postgresService.getSchemaMigrationStatus();
  if (status || dryRun) {
    const pending = before.filter((migration) => !migration.applied);
    if (before.length === 0) console.log('No PostgreSQL migrations are registered.');
    else before.forEach((migration) => {
      console.log(`${migration.applied ? 'Applied' : dryRun ? 'Pending' : 'Not applied'} ${migration.version} ${migration.name}`);
    });
    if (dryRun) console.log(`\n${pending.length} migration(s) would be applied.`);
    if (status && !pending.length) console.log('\nPostgreSQL schema is up to date.');
    return;
  }

  const result = await postgresService.initDb();
  if (result.applied.length === 0) console.log('PostgreSQL schema is up to date.');
  else {
    console.log(`Applied ${result.applied.length} PostgreSQL migration(s):`);
    result.applied.forEach((name) => console.log(`  - ${name}`));
  }
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'PostgreSQL migration failed.');
    process.exitCode = 1;
  })
  .finally(() => postgresService.closeDb());
