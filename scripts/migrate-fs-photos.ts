/**
 * Migration Script: Rename FamilySearch photos to use -familysearch suffix
 *
 * This script migrates legacy FamilySearch photos from the old naming convention
 * ({personId}.jpg) to the new standardized convention ({personId}-familysearch.jpg).
 *
 * This makes FamilySearch photos consistent with other providers:
 * - {personId}-ancestry.jpg
 * - {personId}-wikitree.jpg
 * - {personId}-wiki.jpg
 * - {personId}-familysearch.jpg  <- NEW
 *
 * Run with: npx tsx scripts/migrate-fs-photos.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(import.meta.dirname, '../data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// Suffixes that indicate a photo belongs to a specific provider (not FamilySearch)
const PROVIDER_SUFFIXES = ['-wiki', '-ancestry', '-wikitree', '-linkedin', '-familysearch'];

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

function isLegacyFsPhoto(filename: string): boolean {
  // Check if it's a jpg or png
  if (!filename.endsWith('.jpg') && !filename.endsWith('.png')) {
    return false;
  }

  // Check if it already has a provider suffix
  const baseName = filename.replace(/\.(jpg|png)$/, '');
  for (const suffix of PROVIDER_SUFFIXES) {
    if (baseName.endsWith(suffix)) {
      return false; // Already has a provider suffix
    }
  }

  return true; // No suffix = legacy FamilySearch photo
}

function migratePhotos(dryRun: boolean): MigrationResult {
  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: [],
  };

  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log('📁 Photos directory does not exist, nothing to migrate');
    return result;
  }

  const files = fs.readdirSync(PHOTOS_DIR);

  for (const file of files) {
    if (!isLegacyFsPhoto(file)) {
      continue;
    }

    result.total++;

    const ext = path.extname(file);
    const baseName = file.replace(ext, '');
    const newName = `${baseName}-familysearch${ext}`;

    const oldPath = path.join(PHOTOS_DIR, file);
    const newPath = path.join(PHOTOS_DIR, newName);

    // Check if new file already exists
    if (fs.existsSync(newPath)) {
      console.log(`⏭️  Skipping ${file} - ${newName} already exists`);
      result.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`📸 Would rename: ${file} → ${newName}`);
      result.migrated++;
    } else {
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`✅ Renamed: ${file} → ${newName}`);
        result.migrated++;
      } catch (err) {
        const message = `Failed to rename ${file}: ${(err as Error).message}`;
        console.error(`❌ ${message}`);
        result.errors.push(message);
      }
    }
  }

  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📸 FamilySearch Photo Migration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`Renaming legacy photos from {id}.jpg to {id}-familysearch.jpg`);
  console.log(`Photos directory: ${PHOTOS_DIR}`);
  console.log('');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - no changes will be made');
    console.log('');
  }

  const result = migratePhotos(dryRun);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary:');
  console.log(`  Total legacy photos found: ${result.total}`);
  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${result.migrated}`);
  console.log(`  Skipped (already exists): ${result.skipped}`);
  console.log(`  Errors: ${result.errors.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (dryRun && result.migrated > 0) {
    console.log('ℹ️  Run without --dry-run to perform the migration');
    console.log('');
  }
}

main();
