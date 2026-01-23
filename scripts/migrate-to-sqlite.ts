#!/usr/bin/env npx tsx
/**
 * Migration Script: Populate SQLite from existing JSON data
 *
 * This script:
 * 1. Reads all db-*.json files
 * 2. Creates canonical ULID for each unique person
 * 3. Maps FamilySearch IDs to ULIDs
 * 4. Imports relationships, events, claims
 * 5. Imports favorites and augmentation data
 *
 * Usage:
 *   npx tsx scripts/migrate-to-sqlite.ts [--dry-run] [--verbose] [--resume]
 *
 * Options:
 *   --dry-run   Preview changes without writing to database
 *   --verbose   Show detailed progress
 *   --resume    Resume from checkpoint (skip already imported persons)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const SAMPLES_DIR = path.resolve(__dirname, '../samples');
const SERVER_DIR = path.resolve(__dirname, '../server');

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const resume = args.includes('--resume');

// Dynamically import the services to avoid module initialization issues
async function importServices() {
  // We need to import from the compiled server code
  const { sqliteService } = await import('../server/src/db/sqlite.service.js');
  const { runMigrations } = await import('../server/src/db/migrations/index.js');
  return { sqliteService, runMigrations };
}

interface VitalEvent {
  date?: string;
  dateFormal?: string;
  place?: string;
  placeId?: string;
}

interface Person {
  name: string;
  birthName?: string;
  marriedNames?: string[];
  aliases?: string[];
  alternateNames?: string[];
  gender?: 'male' | 'female' | 'unknown';
  living: boolean;
  birth?: VitalEvent;
  death?: VitalEvent;
  burial?: VitalEvent;
  occupations?: string[];
  religion?: string;
  bio?: string;
  parents: string[];
  children: string[];
  spouses?: string[];
  lastModified?: string;
  lifespan: string;
  location?: string;
  occupation?: string;
}

interface Database {
  [personId: string]: Person;
}

interface FavoriteData {
  isFavorite: boolean;
  whyInteresting: string;
  addedAt: string;
  tags: string[];
}

interface PlatformReference {
  platform: string;
  url: string;
  externalId?: string;
  linkedAt: string;
  verified?: boolean;
  photoUrl?: string;
}

interface PersonPhoto {
  url: string;
  source: string;
  localPath?: string;
  isPrimary?: boolean;
  downloadedAt?: string;
}

interface PersonDescription {
  text: string;
  source: string;
  language?: string;
}

interface PersonAugmentation {
  id: string;
  platforms: PlatformReference[];
  photos: PersonPhoto[];
  descriptions: PersonDescription[];
  customBio?: string;
  customPhotoUrl?: string;
  notes?: string;
  providerMappings?: Array<{
    platform: string;
    url: string;
    externalId?: string;
    linkedAt: string;
    verified?: boolean;
    providerId: string;
    confidence?: string;
    matchedBy?: string;
    lastSynced?: string;
  }>;
  favorite?: FavoriteData;
  updatedAt: string;
}

// Progress tracking
interface MigrationProgress {
  totalDatabases: number;
  processedDatabases: number;
  totalPersons: number;
  processedPersons: number;
  totalFavorites: number;
  processedFavorites: number;
  totalAugmentations: number;
  processedAugmentations: number;
  errors: string[];
  startTime: number;
}

const progress: MigrationProgress = {
  totalDatabases: 0,
  processedDatabases: 0,
  totalPersons: 0,
  processedPersons: 0,
  totalFavorites: 0,
  processedFavorites: 0,
  totalAugmentations: 0,
  processedAugmentations: 0,
  errors: [],
  startTime: Date.now(),
};

// FS ID to ULID mapping (populated during migration)
const fsIdToUlid = new Map<string, string>();

/**
 * Parse year from various date formats
 */
function parseYear(date: string | undefined): number | null {
  if (!date) return null;

  // Handle BC dates
  const bcMatch = date.match(/(\d+)\s*BC/i);
  if (bcMatch) {
    return -parseInt(bcMatch[1], 10);
  }

  // Handle formal dates like +1523 or -0500
  const formalMatch = date.match(/^([+-]?)(\d+)/);
  if (formalMatch) {
    const sign = formalMatch[1] === '-' ? -1 : 1;
    return sign * parseInt(formalMatch[2], 10);
  }

  // Try to extract year from various formats
  const yearMatch = date.match(/\b(\d{4})\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Handle partial years like "abt 1523"
  const partialMatch = date.match(/\b(\d{3,4})\b/);
  if (partialMatch) {
    return parseInt(partialMatch[1], 10);
  }

  return null;
}

/**
 * Get or create ULID for a FamilySearch ID
 */
function getUlidForFsId(fsId: string): string {
  let ulidId = fsIdToUlid.get(fsId);
  if (!ulidId) {
    ulidId = ulid();
    fsIdToUlid.set(fsId, ulidId);
  }
  return ulidId;
}

function log(message: string) {
  console.log(`[migrate] ${message}`);
}

function logVerbose(message: string) {
  if (verbose) {
    console.log(`[migrate] ${message}`);
  }
}

function logError(message: string) {
  console.error(`[migrate ERROR] ${message}`);
  progress.errors.push(message);
}

function printProgress() {
  const elapsed = (Date.now() - progress.startTime) / 1000;
  const rate = progress.processedPersons / elapsed;
  console.log(
    `  Databases: ${progress.processedDatabases}/${progress.totalDatabases} | ` +
      `Persons: ${progress.processedPersons}/${progress.totalPersons} | ` +
      `Favorites: ${progress.processedFavorites}/${progress.totalFavorites} | ` +
      `Rate: ${rate.toFixed(0)}/s | ` +
      `Errors: ${progress.errors.length}`
  );
}

/**
 * Find all database files
 */
function findDatabaseFiles(): { path: string; isSample: boolean }[] {
  const files: { path: string; isSample: boolean }[] = [];

  // User databases
  if (fs.existsSync(DATA_DIR)) {
    const dataFiles = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('db-') && f.endsWith('.json'));
    for (const f of dataFiles) {
      files.push({ path: path.join(DATA_DIR, f), isSample: false });
    }
  }

  // Sample databases
  if (fs.existsSync(SAMPLES_DIR)) {
    const sampleFiles = fs.readdirSync(SAMPLES_DIR).filter((f) => f.startsWith('db-') && f.endsWith('.json'));
    for (const f of sampleFiles) {
      files.push({ path: path.join(SAMPLES_DIR, f), isSample: true });
    }
  }

  return files;
}

/**
 * Find all favorite files (db-scoped)
 */
function findDbFavoriteFiles(): { dbId: string; personId: string; path: string }[] {
  const files: { dbId: string; personId: string; path: string }[] = [];
  const favoritesDir = path.join(DATA_DIR, 'favorites');

  if (!fs.existsSync(favoritesDir)) return files;

  for (const dbDir of fs.readdirSync(favoritesDir)) {
    const dbPath = path.join(favoritesDir, dbDir);
    if (!fs.statSync(dbPath).isDirectory()) continue;

    for (const file of fs.readdirSync(dbPath)) {
      if (!file.endsWith('.json')) continue;
      const personId = file.replace('.json', '');
      files.push({
        dbId: dbDir,
        personId,
        path: path.join(dbPath, file),
      });
    }
  }

  return files;
}

/**
 * Find all augmentation files
 */
function findAugmentationFiles(): { personId: string; path: string }[] {
  const files: { personId: string; path: string }[] = [];
  const augmentDir = path.join(DATA_DIR, 'augment');

  if (!fs.existsSync(augmentDir)) return files;

  for (const file of fs.readdirSync(augmentDir)) {
    if (!file.endsWith('.json')) continue;
    const personId = file.replace('.json', '');
    files.push({
      personId,
      path: path.join(augmentDir, file),
    });
  }

  return files;
}

async function main() {
  log('Starting SQLite migration...');
  if (dryRun) log('DRY RUN MODE - No changes will be made');

  const { sqliteService, runMigrations } = await importServices();

  // Initialize database and run migrations
  if (!dryRun) {
    log('Initializing SQLite database...');
    sqliteService.initDb();

    log('Running migrations...');
    const { applied, skipped } = runMigrations();
    if (applied.length > 0) {
      log(`Applied migrations: ${applied.join(', ')}`);
    }
    if (skipped.length > 0) {
      logVerbose(`Skipped migrations (already applied): ${skipped.join(', ')}`);
    }
  }

  // Find all files to migrate
  const dbFiles = findDatabaseFiles();
  const favoriteFiles = findDbFavoriteFiles();
  const augmentFiles = findAugmentationFiles();

  progress.totalDatabases = dbFiles.length;
  progress.totalFavorites = favoriteFiles.length;
  progress.totalAugmentations = augmentFiles.length;

  log(`Found ${dbFiles.length} database files`);
  log(`Found ${favoriteFiles.length} favorite files`);
  log(`Found ${augmentFiles.length} augmentation files`);

  // Phase 1: Import all persons from databases
  log('\n=== Phase 1: Importing persons from databases ===');

  for (const { path: dbPath, isSample } of dbFiles) {
    const filename = path.basename(dbPath);
    const dbId = filename.replace('db-', '').replace('.json', '');

    logVerbose(`Processing database: ${filename}`);

    const content = fs.readFileSync(dbPath, 'utf-8');
    const db: Database = JSON.parse(content);
    const personIds = Object.keys(db);

    progress.totalPersons += personIds.length;

    // Find root person (person with no parents in database, or first person)
    let rootId = personIds[0];
    for (const personId of personIds) {
      const person = db[personId];
      const hasParentsInDb = person.parents.some((pid) => db[pid]);
      if (!hasParentsInDb) {
        rootId = personId;
        break;
      }
    }

    // First pass: Create all person records
    for (const fsId of personIds) {
      const person = db[fsId];
      const ulidId = getUlidForFsId(fsId);

      if (!dryRun) {
        // Check if already exists (for resume)
        if (resume) {
          const existing = sqliteService.queryOne('SELECT person_id FROM person WHERE person_id = @ulidId', {
            ulidId,
          });
          if (existing) {
            progress.processedPersons++;
            continue;
          }
        }

        // Insert person
        sqliteService.run(
          `INSERT OR REPLACE INTO person (person_id, display_name, birth_name, gender, living, bio)
           VALUES (@personId, @displayName, @birthName, @gender, @living, @bio)`,
          {
            personId: ulidId,
            displayName: person.name,
            birthName: person.birthName ?? null,
            gender: person.gender ?? 'unknown',
            living: person.living ? 1 : 0,
            bio: person.bio ?? null,
          }
        );

        // Register FamilySearch external ID
        sqliteService.run(
          `INSERT OR REPLACE INTO external_identity (person_id, source, external_id, last_seen_at)
           VALUES (@personId, 'familysearch', @externalId, datetime('now'))`,
          {
            personId: ulidId,
            externalId: fsId,
          }
        );

        // Add database membership
        sqliteService.run(
          `INSERT OR REPLACE INTO database_membership (db_id, person_id, is_root)
           VALUES (@dbId, @personId, @isRoot)`,
          {
            dbId,
            personId: ulidId,
            isRoot: fsId === rootId ? 1 : 0,
          }
        );

        // Add vital events
        if (person.birth) {
          sqliteService.run(
            `INSERT OR REPLACE INTO vital_event (person_id, event_type, date_original, date_formal, date_year, place, source)
             VALUES (@personId, 'birth', @dateOriginal, @dateFormal, @dateYear, @place, 'familysearch')`,
            {
              personId: ulidId,
              dateOriginal: person.birth.date ?? null,
              dateFormal: person.birth.dateFormal ?? null,
              dateYear: parseYear(person.birth.dateFormal ?? person.birth.date),
              place: person.birth.place ?? null,
            }
          );
        }

        if (person.death) {
          sqliteService.run(
            `INSERT OR REPLACE INTO vital_event (person_id, event_type, date_original, date_formal, date_year, place, source)
             VALUES (@personId, 'death', @dateOriginal, @dateFormal, @dateYear, @place, 'familysearch')`,
            {
              personId: ulidId,
              dateOriginal: person.death.date ?? null,
              dateFormal: person.death.dateFormal ?? null,
              dateYear: parseYear(person.death.dateFormal ?? person.death.date),
              place: person.death.place ?? null,
            }
          );
        }

        if (person.burial) {
          sqliteService.run(
            `INSERT OR REPLACE INTO vital_event (person_id, event_type, date_original, date_formal, date_year, place, source)
             VALUES (@personId, 'burial', @dateOriginal, @dateFormal, @dateYear, @place, 'familysearch')`,
            {
              personId: ulidId,
              dateOriginal: person.burial.date ?? null,
              dateFormal: person.burial.dateFormal ?? null,
              dateYear: parseYear(person.burial.dateFormal ?? person.burial.date),
              place: person.burial.place ?? null,
            }
          );
        }

        // Add claims for occupations
        if (person.occupations) {
          for (const occ of person.occupations) {
            const claimId = ulid();
            sqliteService.run(
              `INSERT OR REPLACE INTO claim (claim_id, person_id, predicate, value_text, source)
               VALUES (@claimId, @personId, 'occupation', @value, 'familysearch')`,
              {
                claimId,
                personId: ulidId,
                value: occ,
              }
            );
          }
        }

        // Add claims for aliases
        if (person.aliases) {
          for (const alias of person.aliases) {
            const claimId = ulid();
            sqliteService.run(
              `INSERT OR REPLACE INTO claim (claim_id, person_id, predicate, value_text, source)
               VALUES (@claimId, @personId, 'alias', @value, 'familysearch')`,
              {
                claimId,
                personId: ulidId,
                value: alias,
              }
            );
          }
        }

        // Add claim for religion
        if (person.religion) {
          const claimId = ulid();
          sqliteService.run(
            `INSERT OR REPLACE INTO claim (claim_id, person_id, predicate, value_text, source)
             VALUES (@claimId, @personId, 'religion', @value, 'familysearch')`,
            {
              claimId,
              personId: ulidId,
              value: person.religion,
            }
          );
        }

        // Update FTS index
        sqliteService.updatePersonFts(
          ulidId,
          person.name,
          person.birthName,
          person.aliases,
          person.bio,
          person.occupations
        );
      }

      progress.processedPersons++;

      if (progress.processedPersons % 1000 === 0) {
        printProgress();
      }
    }

    // Second pass: Create relationships (now all persons exist)
    logVerbose(`Creating relationships for ${filename}...`);

    for (const fsId of personIds) {
      const person = db[fsId];
      const childUlidId = getUlidForFsId(fsId);

      if (!dryRun) {
        // Parent relationships
        for (let i = 0; i < person.parents.length; i++) {
          const parentFsId = person.parents[i];
          // Only create edge if parent is in our mapping (exists in some database)
          if (fsIdToUlid.has(parentFsId)) {
            const parentUlidId = fsIdToUlid.get(parentFsId)!;
            const parentRole = i === 0 ? 'father' : i === 1 ? 'mother' : 'parent';

            sqliteService.run(
              `INSERT OR IGNORE INTO parent_edge (child_id, parent_id, parent_role, source)
               VALUES (@childId, @parentId, @parentRole, 'familysearch')`,
              {
                childId: childUlidId,
                parentId: parentUlidId,
                parentRole,
              }
            );
          }
        }

        // Spouse relationships
        if (person.spouses) {
          for (const spouseFsId of person.spouses) {
            if (fsIdToUlid.has(spouseFsId)) {
              const spouseUlidId = fsIdToUlid.get(spouseFsId)!;
              // Ensure consistent ordering to avoid duplicates
              const [p1, p2] =
                childUlidId < spouseUlidId ? [childUlidId, spouseUlidId] : [spouseUlidId, childUlidId];

              sqliteService.run(
                `INSERT OR IGNORE INTO spouse_edge (person1_id, person2_id, source)
                 VALUES (@p1, @p2, 'familysearch')`,
                { p1, p2 }
              );
            }
          }
        }
      }
    }

    // Create database info record (after all persons exist)
    if (!dryRun) {
      const rootPerson = db[rootId];
      sqliteService.run(
        `INSERT OR REPLACE INTO database_info (db_id, root_id, root_name, source_provider, is_sample)
         VALUES (@dbId, @rootId, @rootName, 'familysearch', @isSample)`,
        {
          dbId,
          rootId: getUlidForFsId(rootId),
          rootName: rootPerson?.name ?? 'Unknown',
          isSample: isSample ? 1 : 0,
        }
      );
    }

    progress.processedDatabases++;
    log(`Completed database: ${filename} (${personIds.length} persons)`);
  }

  printProgress();

  // Phase 2: Import favorites
  log('\n=== Phase 2: Importing favorites ===');

  for (const { dbId, personId: fsId, path: favPath } of favoriteFiles) {
    logVerbose(`Processing favorite: ${dbId}/${fsId}`);

    const content = fs.readFileSync(favPath, 'utf-8');
    const favorite: FavoriteData = JSON.parse(content);

    if (!dryRun && favorite.isFavorite) {
      const ulidId = fsIdToUlid.get(fsId);
      if (ulidId) {
        sqliteService.run(
          `INSERT OR REPLACE INTO favorite (db_id, person_id, why_interesting, tags, added_at)
           VALUES (@dbId, @personId, @why, @tags, @addedAt)`,
          {
            dbId,
            personId: ulidId,
            why: favorite.whyInteresting ?? null,
            tags: JSON.stringify(favorite.tags ?? []),
            addedAt: favorite.addedAt ?? new Date().toISOString(),
          }
        );
      } else {
        logError(`Favorite person ${fsId} not found in any database`);
      }
    }

    progress.processedFavorites++;
  }

  // Phase 3: Import augmentations
  log('\n=== Phase 3: Importing augmentations ===');

  for (const { personId: fsId, path: augPath } of augmentFiles) {
    logVerbose(`Processing augmentation: ${fsId}`);

    const content = fs.readFileSync(augPath, 'utf-8');
    const aug: PersonAugmentation = JSON.parse(content);

    const ulidId = fsIdToUlid.get(fsId);
    if (!ulidId) {
      logVerbose(`Augmentation person ${fsId} not found in any database, skipping`);
      progress.processedAugmentations++;
      continue;
    }

    if (!dryRun) {
      // Import platform references as external identities
      for (const platform of aug.platforms) {
        if (platform.externalId) {
          sqliteService.run(
            `INSERT OR IGNORE INTO external_identity (person_id, source, external_id, url, last_seen_at)
             VALUES (@personId, @source, @externalId, @url, datetime('now'))`,
            {
              personId: ulidId,
              source: platform.platform,
              externalId: platform.externalId,
              url: platform.url,
            }
          );
        }
      }

      // Import descriptions
      for (const desc of aug.descriptions) {
        sqliteService.run(
          `INSERT OR REPLACE INTO description (person_id, text, source, language)
           VALUES (@personId, @text, @source, @language)`,
          {
            personId: ulidId,
            text: desc.text,
            source: desc.source,
            language: desc.language ?? 'en',
          }
        );
      }

      // Import provider mappings
      if (aug.providerMappings) {
        for (const mapping of aug.providerMappings) {
          sqliteService.run(
            `INSERT OR REPLACE INTO provider_mapping (person_id, provider, account_id, match_method, match_confidence)
             VALUES (@personId, @provider, @accountId, @matchMethod, @confidence)`,
            {
              personId: ulidId,
              provider: mapping.platform,
              accountId: mapping.externalId ?? null,
              matchMethod: mapping.matchedBy ?? 'manual',
              confidence: mapping.confidence === 'high' ? 1.0 : mapping.confidence === 'low' ? 0.5 : 0.75,
            }
          );
        }
      }

      // Note: Photos would need blob migration separately
      // For now, just record the metadata in descriptions as a fallback
      if (aug.customBio) {
        sqliteService.run(
          `INSERT OR REPLACE INTO description (person_id, text, source, language)
           VALUES (@personId, @text, 'custom', 'en')`,
          {
            personId: ulidId,
            text: aug.customBio,
          }
        );
      }
    }

    progress.processedAugmentations++;

    if (progress.processedAugmentations % 100 === 0) {
      printProgress();
    }
  }

  // Final report
  const elapsed = (Date.now() - progress.startTime) / 1000;
  log('\n=== Migration Complete ===');
  log(`Total time: ${elapsed.toFixed(1)} seconds`);
  log(`Databases: ${progress.processedDatabases}/${progress.totalDatabases}`);
  log(`Persons: ${progress.processedPersons}/${progress.totalPersons}`);
  log(`Favorites: ${progress.processedFavorites}/${progress.totalFavorites}`);
  log(`Augmentations: ${progress.processedAugmentations}/${progress.totalAugmentations}`);
  log(`Unique persons (ULIDs created): ${fsIdToUlid.size}`);
  log(`Errors: ${progress.errors.length}`);

  if (progress.errors.length > 0) {
    log('\nErrors encountered:');
    for (const err of progress.errors.slice(0, 10)) {
      log(`  - ${err}`);
    }
    if (progress.errors.length > 10) {
      log(`  ... and ${progress.errors.length - 10} more`);
    }
  }

  if (!dryRun) {
    const stats = sqliteService.getStats();
    log('\nDatabase statistics:');
    log(`  Persons: ${stats.personCount}`);
    log(`  External IDs: ${stats.externalIdCount}`);
    log(`  Parent edges: ${stats.parentEdgeCount}`);
    log(`  Favorites: ${stats.favoriteCount}`);
    log(`  Databases: ${stats.databaseCount}`);
  }

  // Close database
  if (!dryRun) {
    sqliteService.closeDb();
  }

  log('\nMigration finished successfully!');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
