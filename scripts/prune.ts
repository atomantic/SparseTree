#!/usr/bin/env npx tsx
/**
 * Move all person cache files (data/person/*.json) that are not in SQLite
 * to the data/pruned folder
 *
 * Usage:
 *   npx tsx scripts/prune.ts
 */

import fs from 'fs';
import path from 'path';
import { sqliteService } from '../server/src/db/sqlite.service.js';

// Initialize SQLite
sqliteService.initDb();

// Get all FamilySearch IDs from SQLite
const externalIds = sqliteService.queryAll<{ external_id: string }>(
  `SELECT external_id FROM external_identity WHERE source = 'familysearch'`
);
const knownIds = new Set(externalIds.map((row) => row.external_id));

console.log(`SQLite has ${knownIds.size} FamilySearch IDs`);

// Ensure pruned directory exists
const prunedDir = 'data/pruned';
if (!fs.existsSync(prunedDir)) {
  fs.mkdirSync(prunedDir, { recursive: true });
}

// Check each person file
const personDir = 'data/person';
if (!fs.existsSync(personDir)) {
  console.log('No data/person directory found');
  process.exit(0);
}

const files = fs.readdirSync(personDir);
let pruneCount = 0;
let keepCount = 0;

for (const f of files) {
  if (!f.endsWith('.json')) continue;

  const id = f.replace('.json', '');

  if (knownIds.has(id)) {
    keepCount++;
  } else {
    pruneCount++;
    const srcPath = path.join(personDir, f);
    const destPath = path.join(prunedDir, f);
    fs.renameSync(srcPath, destPath);
    if (pruneCount <= 10) {
      console.log(`Pruned: ${id}`);
    } else if (pruneCount === 11) {
      console.log('...');
    }
  }
}

console.log(`\nKept: ${keepCount}, Pruned: ${pruneCount}`);
sqliteService.closeDb();
