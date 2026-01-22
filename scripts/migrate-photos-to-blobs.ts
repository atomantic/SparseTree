#!/usr/bin/env npx tsx
/**
 * Migrate Photos to Content-Addressed Blob Storage
 *
 * Moves photos from data/photos/ to data/blobs/ using SHA-256 hashing
 * for deduplication, and creates blob + media records in SQLite.
 *
 * Usage:
 *   npx tsx scripts/migrate-photos-to-blobs.ts [--dry-run] [--keep-originals]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { blobService } from '../server/src/services/blob.service.js';
import { idMappingService } from '../server/src/services/id-mapping.service.js';
import { sqliteService } from '../server/src/db/sqlite.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PHOTOS_DIR = path.join(ROOT_DIR, 'data/photos');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepOriginals = args.includes('--keep-originals');

console.log('Photo Migration to Blob Storage');
console.log('================================');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Keep originals: ${keepOriginals ? 'YES' : 'NO'}`);
console.log();

// Initialize SQLite
sqliteService.initDb();

// Track statistics
const stats = {
  found: 0,
  migrated: 0,
  skipped: 0,
  errors: 0,
  duplicates: 0,
  totalBytes: 0,
};

/**
 * Parse photo filename to extract person ID and source
 *
 * Filename patterns:
 * - {fsId}.jpg -> FamilySearch primary photo
 * - {fsId}-wiki.jpg -> Wikipedia photo
 * - {fsId}-ancestry.jpg -> Ancestry photo
 * - {fsId}-{source}.jpg -> Other source
 *
 * FamilySearch IDs are typically: XXXX-XXX (4 alphanum, dash, 3 alphanum)
 */
function parseFilename(filename: string): { fsId: string; source: string } | null {
  // Match FamilySearch ID pattern (e.g., 9S8X-B4M) optionally followed by -source
  const match = filename.match(/^([A-Z0-9]{4}-[A-Z0-9]{3})(?:-([a-z]+))?\.(?:jpg|jpeg|png|gif|webp)$/i);
  if (!match) return null;

  const fsId = match[1];
  const sourceSuffix = match[2];

  let source = 'familysearch';
  if (sourceSuffix === 'wiki') source = 'wikipedia';
  else if (sourceSuffix === 'ancestry') source = 'ancestry';
  else if (sourceSuffix === 'wikitree') source = 'wikitree';
  else if (sourceSuffix === 'findagrave') source = 'findagrave';
  else if (sourceSuffix) source = sourceSuffix;

  return { fsId, source };
}

/**
 * Get source URL for a photo
 */
function getSourceUrl(fsId: string, source: string): string | undefined {
  const urls: Record<string, (id: string) => string> = {
    familysearch: (id) => `https://www.familysearch.org/tree/person/details/${id}`,
    ancestry: (id) => `https://www.ancestry.com/family-tree/person/${id}`,
    wikipedia: () => '', // Would need Wikipedia page URL
    wikitree: (id) => `https://www.wikitree.com/wiki/${id}`,
    findagrave: (id) => `https://www.findagrave.com/memorial/${id}`,
  };
  return urls[source]?.(fsId) || undefined;
}

// Main migration
async function migrate() {
  // Check if photos directory exists
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log('No photos directory found. Nothing to migrate.');
    return;
  }

  // Get all photo files
  const files = fs.readdirSync(PHOTOS_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
  });

  stats.found = files.length;
  console.log(`Found ${stats.found} photos to migrate\n`);

  if (stats.found === 0) {
    console.log('No photos to migrate.');
    return;
  }

  // Process each photo
  for (const filename of files) {
    const parsed = parseFilename(filename);
    if (!parsed) {
      console.log(`  SKIP: ${filename} (unrecognized filename pattern)`);
      stats.skipped++;
      continue;
    }

    const { fsId, source } = parsed;
    const filePath = path.join(PHOTOS_DIR, filename);
    const fileStats = fs.statSync(filePath);

    // Resolve FamilySearch ID to canonical ULID
    const canonicalId = idMappingService.getCanonicalId('familysearch', fsId);
    if (!canonicalId) {
      console.log(`  SKIP: ${filename} (no canonical ID for ${fsId})`);
      stats.skipped++;
      continue;
    }

    // Check if media already exists for this person+source
    const existingMedia = sqliteService.queryOne<{ media_id: string }>(
      `SELECT media_id FROM media WHERE person_id = @personId AND source = @source`,
      { personId: canonicalId, source }
    );

    if (existingMedia) {
      console.log(`  DUP:  ${filename} (already has ${source} photo)`);
      stats.duplicates++;
      continue;
    }

    stats.totalBytes += fileStats.size;

    if (dryRun) {
      console.log(
        `  WOULD: ${filename} -> ${canonicalId} (${source}, ${(fileStats.size / 1024).toFixed(1)}KB)`
      );
      stats.migrated++;
      continue;
    }

    // Store in blob storage
    const blob = blobService.storeBlobFromFile(filePath);

    // Determine if this should be primary (FamilySearch photos are primary by default)
    const isPrimary = source === 'familysearch';

    // Create media record
    const mediaId = blobService.createMedia(canonicalId, blob.hash, source, {
      sourceUrl: getSourceUrl(fsId, source),
      isPrimary,
    });

    console.log(
      `  OK:   ${filename} -> ${blob.hash.substring(0, 12)}... (${source}, ${
        blob.isNew ? 'new' : 'dup'
      })`
    );
    stats.migrated++;

    // Delete original if not keeping
    if (!keepOriginals) {
      fs.unlinkSync(filePath);
    }
  }

  // Summary
  console.log('\n================================');
  console.log('Migration Summary');
  console.log('================================');
  console.log(`Photos found:    ${stats.found}`);
  console.log(`Photos migrated: ${stats.migrated}`);
  console.log(`Photos skipped:  ${stats.skipped}`);
  console.log(`Duplicates:      ${stats.duplicates}`);
  console.log(`Errors:          ${stats.errors}`);
  console.log(`Total size:      ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (dryRun) {
    console.log('\n(DRY RUN - no changes made)');
  } else {
    // Show storage stats
    const storageStats = blobService.getStorageStats();
    console.log('\nBlob Storage Stats:');
    console.log(`  Blobs: ${storageStats.blobCount}`);
    console.log(`  Media: ${storageStats.mediaCount}`);
    console.log(`  Total: ${(storageStats.totalSize / 1024 / 1024).toFixed(2)} MB`);
  }
}

migrate()
  .catch(console.error)
  .finally(() => {
    sqliteService.closeDb();
  });
