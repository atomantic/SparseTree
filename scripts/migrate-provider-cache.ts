#!/usr/bin/env npx tsx
/**
 * Migration Script: FamilySearch Data to Unified Provider Cache
 *
 * Migrates FamilySearch person data from:
 *   data/person/{fsId}.json
 * to:
 *   data/provider-cache/familysearch/{fsId}.json
 *
 * This creates a unified cache structure for all providers:
 *   data/provider-cache/{provider}/{externalId}.json
 *
 * Usage:
 *   npx tsx scripts/migrate-provider-cache.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('dry-run', {
    type: 'boolean',
    description: 'Preview changes without actually moving files',
    default: false,
  })
  .parseSync();

const DATA_DIR = path.resolve(import.meta.dirname, '../data');
const OLD_PERSON_DIR = path.join(DATA_DIR, 'person');
const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');
const NEW_FS_DIR = path.join(PROVIDER_CACHE_DIR, 'familysearch');

// Ensure provider cache directories exist
const PROVIDERS = ['familysearch', 'ancestry', 'wikitree', '23andme'];

function ensureDirectories(): void {
  console.log('Creating provider cache directories...');

  if (!fs.existsSync(PROVIDER_CACHE_DIR)) {
    if (argv['dry-run']) {
      console.log(`  [DRY-RUN] Would create: ${PROVIDER_CACHE_DIR}`);
    } else {
      fs.mkdirSync(PROVIDER_CACHE_DIR, { recursive: true });
      console.log(`  Created: ${PROVIDER_CACHE_DIR}`);
    }
  }

  for (const provider of PROVIDERS) {
    const providerDir = path.join(PROVIDER_CACHE_DIR, provider);
    if (!fs.existsSync(providerDir)) {
      if (argv['dry-run']) {
        console.log(`  [DRY-RUN] Would create: ${providerDir}`);
      } else {
        fs.mkdirSync(providerDir, { recursive: true });
        console.log(`  Created: ${providerDir}`);
      }
    }
  }
}

function migratePersonFiles(): { moved: number; skipped: number; errors: string[] } {
  const result = { moved: 0, skipped: 0, errors: [] as string[] };

  if (!fs.existsSync(OLD_PERSON_DIR)) {
    console.log(`\nNo existing person directory found at: ${OLD_PERSON_DIR}`);
    console.log('Migration not needed - starting fresh with unified provider cache structure.');
    return result;
  }

  const files = fs.readdirSync(OLD_PERSON_DIR).filter(f => f.endsWith('.json'));
  console.log(`\nFound ${files.length} JSON files to migrate from ${OLD_PERSON_DIR}`);

  for (const file of files) {
    const oldPath = path.join(OLD_PERSON_DIR, file);
    const newPath = path.join(NEW_FS_DIR, file);

    // Skip if already exists in new location
    if (fs.existsSync(newPath)) {
      console.log(`  Skipping (already exists): ${file}`);
      result.skipped++;
      continue;
    }

    if (argv['dry-run']) {
      console.log(`  [DRY-RUN] Would move: ${file}`);
      result.moved++;
    } else {
      // Copy to new location (safer than move)
      const content = fs.readFileSync(oldPath);
      fs.writeFileSync(newPath, content);
      console.log(`  Moved: ${file}`);
      result.moved++;
    }
  }

  return result;
}

function createSymlinkForBackwardsCompat(): void {
  // Create a symlink from data/person -> data/provider-cache/familysearch
  // for backwards compatibility during transition
  const symlinkPath = path.join(DATA_DIR, 'person-legacy');

  if (fs.existsSync(OLD_PERSON_DIR) && !fs.lstatSync(OLD_PERSON_DIR).isSymbolicLink()) {
    if (argv['dry-run']) {
      console.log(`\n[DRY-RUN] After migration, original files in ${OLD_PERSON_DIR} can be removed once verified.`);
      console.log(`[DRY-RUN] Would rename ${OLD_PERSON_DIR} to ${symlinkPath} for backup.`);
    } else {
      // Rename old directory to person-legacy as backup
      if (!fs.existsSync(symlinkPath)) {
        fs.renameSync(OLD_PERSON_DIR, symlinkPath);
        console.log(`\nRenamed old directory to: ${symlinkPath}`);
      }

      // Create symlink for backwards compatibility
      fs.symlinkSync(NEW_FS_DIR, OLD_PERSON_DIR, 'junction');
      console.log(`Created symlink: ${OLD_PERSON_DIR} -> ${NEW_FS_DIR}`);
    }
  }
}

function main(): void {
  console.log('='.repeat(60));
  console.log('FamilySearch Provider Cache Migration');
  console.log('='.repeat(60));

  if (argv['dry-run']) {
    console.log('\n*** DRY RUN MODE - No files will be modified ***\n');
  }

  // Step 1: Create directory structure
  ensureDirectories();

  // Step 2: Migrate files
  const result = migratePersonFiles();

  // Step 3: Create backwards-compatibility symlink
  if (result.moved > 0 && !argv['dry-run']) {
    createSymlinkForBackwardsCompat();
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary:');
  console.log('='.repeat(60));
  console.log(`  Files moved: ${result.moved}`);
  console.log(`  Files skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`    - ${e}`));
  }

  if (argv['dry-run']) {
    console.log('\nRun without --dry-run to apply changes.');
  } else if (result.moved > 0) {
    console.log('\nMigration complete!');
    console.log('The old data/person directory has been renamed to data/person-legacy.');
    console.log('A symlink has been created at data/person for backwards compatibility.');
    console.log('\nAfter verifying everything works, you can safely delete data/person-legacy.');
  }
}

main();
