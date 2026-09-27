#!/usr/bin/env npx tsx
/** Move cached person files absent from the PostgreSQL query store to data/pruned. */

import fs from 'node:fs';
import path from 'node:path';
import { postgresService } from '../server/src/db/postgres.service.js';

async function main(): Promise<void> {
  if (!postgresService.isConfigured()) {
    throw new Error('Set DATABASE_URL before pruning cached person files.');
  }
  await postgresService.initDb();
  const populated = await postgresService.queryOne<{ populated: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM external_identity WHERE source = 'familysearch') AS populated",
  );
  if (!populated?.populated) {
    throw new Error('The PostgreSQL query store has no FamilySearch identities; refusing to move cached files.');
  }

  const externalIds = await postgresService.queryAll<{ external_id: string }>(
    "SELECT external_id FROM external_identity WHERE source = 'familysearch'",
  );
  const knownIds = new Set(externalIds.map((row) => row.external_id));
  console.log(`PostgreSQL has ${knownIds.size} FamilySearch identities`);

  const personDir = 'data/person';
  if (!fs.existsSync(personDir)) {
    console.log('No data/person directory found');
    return;
  }

  const prunedDir = 'data/pruned';
  fs.mkdirSync(prunedDir, { recursive: true });
  let pruneCount = 0;
  let keepCount = 0;
  for (const filename of fs.readdirSync(personDir)) {
    if (!filename.endsWith('.json')) continue;
    const id = filename.slice(0, -'.json'.length);
    if (knownIds.has(id)) {
      keepCount++;
      continue;
    }
    fs.renameSync(path.join(personDir, filename), path.join(prunedDir, filename));
    pruneCount++;
    if (pruneCount <= 10) console.log(`Pruned: ${id}`);
    else if (pruneCount === 11) console.log('...');
  }
  console.log(`\nKept: ${keepCount}, Pruned: ${pruneCount}`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pruning failed.');
    process.exitCode = 1;
  })
  .finally(() => postgresService.closeDb());
