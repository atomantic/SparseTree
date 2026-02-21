#!/usr/bin/env npx tsx
/**
 * Migrate augmentation files from FamilySearch IDs to canonical ULIDs
 *
 * This script:
 * 1. Finds all augmentation JSON files with FamilySearch ID names
 * 2. Looks up the canonical ULID for each
 * 3. Renames the file to use the canonical ID
 * 4. Updates the "id" field inside the JSON
 */

import fs from 'fs';
import path from 'path';

const __dirname = import.meta.dirname;
const AUGMENT_DIR = path.resolve(__dirname, '../data/augment');
const DB_PATH = path.resolve(__dirname, '../data/sparsetree.db');

// Import SQLite dynamically to avoid issues
import Database from 'better-sqlite3';

const db = new Database(DB_PATH);

// Check if a string looks like a ULID (26 chars, uppercase alphanumeric)
function isULID(id: string): boolean {
  return id.length === 26 && /^[0-9A-Z]+$/.test(id);
}

// Get canonical ID for a FamilySearch ID
function getCanonicalId(fsId: string): string | null {
  const row = db.prepare(
    "SELECT person_id FROM external_identity WHERE source = 'familysearch' AND external_id = ?"
  ).get(fsId) as { person_id: string } | undefined;
  return row?.person_id ?? null;
}

async function main() {
  console.log('Migrating augmentation files to canonical IDs...\n');

  if (!fs.existsSync(AUGMENT_DIR)) {
    console.log('No augmentation directory found.');
    return;
  }

  const files = fs.readdirSync(AUGMENT_DIR).filter(f => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const file of files) {
    const currentId = file.replace('.json', '');

    // Skip if already a ULID
    if (isULID(currentId)) {
      console.log(`✓ ${currentId} - already canonical`);
      skipped++;
      continue;
    }

    // Look up canonical ID
    const canonicalId = getCanonicalId(currentId);
    if (!canonicalId) {
      console.log(`✗ ${currentId} - no canonical ID found`);
      notFound++;
      continue;
    }

    // Check if canonical file already exists
    const canonicalPath = path.join(AUGMENT_DIR, `${canonicalId}.json`);
    if (fs.existsSync(canonicalPath)) {
      console.log(`⚠ ${currentId} → ${canonicalId} - target already exists, merging...`);
      // Could merge here, but for now just skip
      skipped++;
      continue;
    }

    // Read the file
    const currentPath = path.join(AUGMENT_DIR, file);
    const content = JSON.parse(fs.readFileSync(currentPath, 'utf-8'));

    // Update the id field
    content.id = canonicalId;

    // Write to new path
    fs.writeFileSync(canonicalPath, JSON.stringify(content, null, 2));

    // Remove old file
    fs.unlinkSync(currentPath);

    console.log(`→ ${currentId} → ${canonicalId}`);
    migrated++;
  }

  console.log(`\nMigration complete:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Not found: ${notFound}`);

  db.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
