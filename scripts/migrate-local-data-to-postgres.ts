#!/usr/bin/env npx tsx
/**
 * Import local SQLite metadata after rebuilding PostgreSQL provider identities.
 * Stop local writes first. The source and media files are never modified.
 * Existing PostgreSQL rows win; unmapped or ambiguous edits abort the import.
 *
 * DATABASE_URL=... npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite <snapshot.db> --dry-run
 * DATABASE_URL=... npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite <snapshot.db>
 */
import { postgresService } from '../server/src/db/postgres.service.js';
import { importPostgresLocalData, LocalDataImportError } from '../server/src/lib/postgres-local-data-import.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: migrate-local-data-to-postgres.ts --sqlite <snapshot.db> [--dry-run]');
    console.log('Set DATABASE_URL, rebuild all provider identities, and stop local writes before importing.');
    console.log('SQLite is read-only; dry runs roll back target rows. Existing PostgreSQL rows are retained.');
    console.log('Ambiguous person/database mappings or manual death flags abort without committing any rows.');
    return;
  }
  let filename: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--sqlite' && args[i + 1] && !args[i + 1].startsWith('--')) filename = args[++i];
    else throw new LocalDataImportError('Usage: migrate-local-data-to-postgres.ts --sqlite <snapshot.db> [--dry-run]');
  }
  if (!filename) throw new LocalDataImportError('An explicit --sqlite snapshot path is required.');
  if (!postgresService.isConfigured()) throw new LocalDataImportError('Set DATABASE_URL before importing local data.');
  // The provider rebuild owns schema setup. Missing tables fail without changing it.
  const result = await importPostgresLocalData(filename, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

void main().catch(error => {
  // Do not print connection URLs or raw database errors containing user values.
  console.error(error instanceof LocalDataImportError ? error.message : 'Local-data import failed; no PostgreSQL rows were committed. Check snapshot access, target availability, and schema compatibility.');
  process.exitCode = 1;
}).finally(() => postgresService.closeDb());
