/**
 * Migration Script: Move legacy person cache to provider-cache structure
 *
 * Moves FamilySearch JSON cache from the legacy location:
 *   data/person/{fsId}.json
 * To the standardized provider-cache location:
 *   data/provider-cache/familysearch/{fsId}.json
 *
 * This migration eliminates the need for legacy fallback code in services.
 *
 * Run with: npx tsx scripts/migrate-legacy-cache.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(import.meta.dirname, '../data');
const LEGACY_DIR = path.join(DATA_DIR, 'person');
const TARGET_DIR = path.join(DATA_DIR, 'provider-cache', 'familysearch');

interface MigrationResult {
  total: number;
  moved: number;
  skipped: number;
  errors: string[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function migrateFiles(dryRun: boolean): MigrationResult {
  const result: MigrationResult = {
    total: 0,
    moved: 0,
    skipped: 0,
    errors: [],
  };

  if (!fs.existsSync(LEGACY_DIR)) {
    console.log('📁 Legacy directory does not exist, nothing to migrate');
    return result;
  }

  ensureDir(TARGET_DIR);

  const files = fs.readdirSync(LEGACY_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  console.log(`Found ${jsonFiles.length} JSON files to migrate\n`);

  for (const file of jsonFiles) {
    result.total++;

    const sourcePath = path.join(LEGACY_DIR, file);
    const targetPath = path.join(TARGET_DIR, file);

    // Check if target already exists
    if (fs.existsSync(targetPath)) {
      // Compare file sizes to determine which is newer/better
      const sourceStats = fs.statSync(sourcePath);
      const targetStats = fs.statSync(targetPath);

      if (targetStats.mtime > sourceStats.mtime) {
        // Target is newer, skip
        result.skipped++;
        continue;
      }
    }

    if (dryRun) {
      console.log(`📦 Would move: ${file}`);
      result.moved++;
    } else {
      try {
        // Move file (copy then delete to handle cross-device moves)
        fs.copyFileSync(sourcePath, targetPath);
        fs.unlinkSync(sourcePath);
        result.moved++;

        // Progress indicator every 1000 files
        if (result.moved % 1000 === 0) {
          console.log(`✅ Moved ${result.moved} files...`);
        }
      } catch (err) {
        const message = `Failed to move ${file}: ${(err as Error).message}`;
        console.error(`❌ ${message}`);
        result.errors.push(message);
      }
    }
  }

  // Clean up empty legacy directory
  if (!dryRun && result.moved > 0) {
    const remaining = fs.readdirSync(LEGACY_DIR);
    if (remaining.length === 0) {
      fs.rmdirSync(LEGACY_DIR);
      console.log('\n🗑️  Removed empty legacy directory');
    } else {
      console.log(`\n⚠️  ${remaining.length} files remain in legacy directory`);
    }
  }

  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 Legacy Cache Migration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`Moving: data/person/*.json`);
  console.log(`    To: data/provider-cache/familysearch/`);
  console.log('');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - no changes will be made');
    console.log('');
  }

  const result = migrateFiles(dryRun);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary:');
  console.log(`  Total files found: ${result.total}`);
  console.log(`  ${dryRun ? 'Would move' : 'Moved'}: ${result.moved}`);
  console.log(`  Skipped (target newer): ${result.skipped}`);
  console.log(`  Errors: ${result.errors.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (dryRun && result.moved > 0) {
    console.log('ℹ️  Run without --dry-run to perform the migration');
    console.log('');
  }

  if (!dryRun && result.moved > 0) {
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart the server: pm2 restart ecosystem.config.cjs');
    console.log('2. Verify data loads correctly in the UI');
    console.log('');
  }
}

main();
