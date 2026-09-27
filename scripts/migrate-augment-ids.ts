#!/usr/bin/env npx tsx
/** Rename augmentation JSON files from FamilySearch IDs to PostgreSQL canonical ULIDs. */

import fs from 'node:fs';
import path from 'node:path';
import { postgresService } from '../server/src/db/postgres.service.js';

const AUGMENT_DIR = path.resolve(import.meta.dirname, '../data/augment');

function isULID(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id);
}

async function main(): Promise<void> {
  if (!postgresService.isConfigured()) {
    throw new Error('Set DATABASE_URL before migrating augmentation filenames.');
  }
  await postgresService.initDb();
  const mappings = await postgresService.queryAll<{ external_id: string; person_id: string }>(
    "SELECT external_id, person_id FROM external_identity WHERE source = 'familysearch'",
  );
  const canonicalIds = new Map(mappings.map((row) => [row.external_id, row.person_id]));

  if (!fs.existsSync(AUGMENT_DIR)) {
    console.log('No augmentation directory found.');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let notFound = 0;
  for (const filename of fs.readdirSync(AUGMENT_DIR).filter(name => name.endsWith('.json'))) {
    const currentId = filename.slice(0, -'.json'.length);
    if (isULID(currentId)) {
      console.log(`✓ ${currentId} - already canonical`);
      skipped++;
      continue;
    }

    const canonicalId = canonicalIds.get(currentId);
    if (!canonicalId) {
      console.log(`✗ ${currentId} - no canonical ID found`);
      notFound++;
      continue;
    }

    const currentPath = path.join(AUGMENT_DIR, filename);
    const canonicalPath = path.join(AUGMENT_DIR, `${canonicalId}.json`);
    if (fs.existsSync(canonicalPath)) {
      console.log(`⚠ ${currentId} → ${canonicalId} - target already exists, merging is required`);
      skipped++;
      continue;
    }

    const content = JSON.parse(fs.readFileSync(currentPath, 'utf8')) as Record<string, unknown>;
    content.id = canonicalId;
    fs.writeFileSync(canonicalPath, JSON.stringify(content, null, 2));
    fs.unlinkSync(currentPath);
    console.log(`→ ${currentId} → ${canonicalId}`);
    migrated++;
  }

  console.log(`\nMigration complete:\n  Migrated: ${migrated}\n  Skipped:  ${skipped}\n  Not found: ${notFound}`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Augmentation migration failed.');
    process.exitCode = 1;
  })
  .finally(() => postgresService.closeDb());
