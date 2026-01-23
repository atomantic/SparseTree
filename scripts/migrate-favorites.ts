#!/usr/bin/env npx tsx
/**
 * Migration script for favorites from global augmentation to db-scoped storage
 *
 * This script:
 * 1. Scans data/augment/*.json for files with favorite data
 * 2. For each favorite, finds which databases contain that person
 * 3. Copies the favorite data to data/favorites/{dbId}/{personId}.json for each database
 *
 * Usage:
 *   npx tsx scripts/migrate-favorites.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
const FAVORITES_DIR = path.join(DATA_DIR, 'favorites');

const dryRun = process.argv.includes('--dry-run');

interface Person {
  name: string;
  [key: string]: unknown;
}

interface Database {
  [id: string]: Person;
}

interface Augmentation {
  favorite?: {
    isFavorite: boolean;
    whyInteresting: string;
    tags: string[];
    addedAt?: string;
  };
}

async function loadDatabases(): Promise<Record<string, Database>> {
  const dbFiles = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('db-') && f.endsWith('.json'));

  const databases: Record<string, Database> = {};
  for (const file of dbFiles) {
    // Strip 'db-' prefix to match database service ID format
    const dbId = file.replace(/^db-/, '').replace('.json', '');
    const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
    databases[dbId] = JSON.parse(content);
    console.log(`Loaded database ${dbId} with ${Object.keys(databases[dbId]).length} persons`);
  }
  return databases;
}

function findPersonInDatabases(personId: string, databases: Record<string, Database>): string[] {
  const foundIn: string[] = [];
  for (const [dbId, db] of Object.entries(databases)) {
    if (db[personId]) {
      foundIn.push(dbId);
    }
  }
  return foundIn;
}

async function migrate(): Promise<void> {
  console.log('');
  console.log('=== Favorites Migration Script ===');
  console.log(dryRun ? '(DRY RUN - no changes will be made)' : '');
  console.log('');

  // Check if augment directory exists
  if (!fs.existsSync(AUGMENT_DIR)) {
    console.log('No augment directory found. Nothing to migrate.');
    return;
  }

  // Load all databases
  console.log('Loading databases...');
  const databases = await loadDatabases();
  const dbCount = Object.keys(databases).length;
  console.log(`Loaded ${dbCount} databases`);
  console.log('');

  if (dbCount === 0) {
    console.log('No databases found. Nothing to migrate.');
    return;
  }

  // Ensure favorites directory exists
  if (!dryRun && !fs.existsSync(FAVORITES_DIR)) {
    fs.mkdirSync(FAVORITES_DIR, { recursive: true });
  }

  // Scan augmentation files
  const augFiles = fs.readdirSync(AUGMENT_DIR)
    .filter((f) => f.endsWith('.json') && !fs.statSync(path.join(AUGMENT_DIR, f)).isDirectory());

  console.log(`Found ${augFiles.length} augmentation files to scan`);
  console.log('');

  let migratedCount = 0;
  let skippedCount = 0;
  let alreadyMigratedCount = 0;

  for (const file of augFiles) {
    const personId = file.replace('.json', '');
    const filePath = path.join(AUGMENT_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const augmentation: Augmentation = JSON.parse(content);

    // Check if this has favorite data
    if (!augmentation.favorite?.isFavorite) {
      continue;
    }

    console.log(`\nFound favorite: ${personId}`);
    console.log(`  Why: ${augmentation.favorite.whyInteresting.substring(0, 50)}...`);
    console.log(`  Tags: ${augmentation.favorite.tags.join(', ') || 'none'}`);

    // Find which databases contain this person
    const containingDbs = findPersonInDatabases(personId, databases);

    if (containingDbs.length === 0) {
      console.log('  WARNING: Person not found in any database, skipping');
      skippedCount++;
      continue;
    }

    console.log(`  Found in databases: ${containingDbs.join(', ')}`);

    // Create favorite data (without the augmentation wrapper)
    const favoriteData = {
      isFavorite: true,
      whyInteresting: augmentation.favorite.whyInteresting,
      tags: augmentation.favorite.tags || [],
      addedAt: augmentation.favorite.addedAt || new Date().toISOString(),
    };

    // Copy to each database's favorites directory
    for (const dbId of containingDbs) {
      const dbFavDir = path.join(FAVORITES_DIR, dbId);
      const favPath = path.join(dbFavDir, `${personId}.json`);

      // Check if already migrated
      if (fs.existsSync(favPath)) {
        console.log(`  [${dbId}] Already exists, skipping`);
        alreadyMigratedCount++;
        continue;
      }

      if (dryRun) {
        console.log(`  [${dbId}] Would create: ${favPath}`);
      } else {
        if (!fs.existsSync(dbFavDir)) {
          fs.mkdirSync(dbFavDir, { recursive: true });
        }
        fs.writeFileSync(favPath, JSON.stringify(favoriteData, null, 2));
        console.log(`  [${dbId}] Created: ${favPath}`);
      }
      migratedCount++;
    }
  }

  console.log('');
  console.log('=== Migration Summary ===');
  console.log(`Migrated: ${migratedCount} favorite entries`);
  console.log(`Skipped (not in any db): ${skippedCount}`);
  console.log(`Already migrated: ${alreadyMigratedCount}`);

  if (dryRun) {
    console.log('');
    console.log('This was a dry run. Run without --dry-run to apply changes.');
  } else {
    console.log('');
    console.log('Migration complete!');
    console.log('Note: Original augmentation files have been preserved.');
    console.log('The favorites.service now reads from both locations.');
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
