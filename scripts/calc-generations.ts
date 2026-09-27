#!/usr/bin/env npx tsx
/** Recalculate generation depth for a PostgreSQL query-store root. */
import { databaseService } from '../server/src/services/database.service.js';
import { postgresService } from '../server/src/db/postgres.service.js';

const rootId = process.argv[2] || '01KFKFZG0XKA8DQRW923JEWP4V';

async function main(): Promise<void> {
  if (!postgresService.isConfigured()) {
    throw new Error('Set DATABASE_URL before recalculating generations.');
  }
  await postgresService.initDb();
  const info = await databaseService.calculateMaxGenerations(rootId);
  console.log(`Updated ${info.id}: ${info.maxGenerations ?? 0} generations, ${info.personCount} persons`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Generation recalculation failed.');
    process.exitCode = 1;
  })
  .finally(() => postgresService.closeDb());
