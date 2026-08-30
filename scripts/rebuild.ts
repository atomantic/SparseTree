#!/usr/bin/env npx tsx
/**
 * Rebuild database files from existing person JSON files
 * Uses the updated json2person extraction logic
 *
 * Usage:
 *   npx tsx scripts/rebuild.ts DB_ID           # Rebuild specific database
 *   npx tsx scripts/rebuild.ts --all           # Rebuild all databases
 */

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { json2person } from '../server/src/lib/familysearch/transformer.js';
import { loadFamilySearchTreeFromJson } from '../server/src/lib/json-tree-loader.js';
import { postgresWriter } from '../server/src/lib/postgres-writer.js';
import type { Person, Database } from '@fsf/shared';

const argv = yargs(hideBin(process.argv)).argv as {
  _: (string | number)[];
  all?: boolean;
  max?: number;
};

const [dbId] = argv._ as string[];
const rebuildAll = argv.all;
const requestedMaxGenerations = argv.max === undefined ? undefined : Number(argv.max);

const DATA_DIR = './data';
const PERSON_DIR = `${DATA_DIR}/person`;

/**
 * Get list of all database files
 */
const getDatabaseFiles = (): { filename: string; rootId: string }[] => {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
    .map((f) => ({
      filename: f,
      rootId: f.replace(/^db-/, '').replace(/-\d+\.json$/, '').replace(/\.json$/, ''),
    }));
};

/**
 * Read existing database to get list of person IDs
 */
const getPersonIdsFromDb = (dbPath: string): string[] => {
  const db: Database = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  return Object.keys(db);
};

/**
 * Read and process a person JSON file
 */
const processPerson = (personId: string): Person | null => {
  const file = path.join(PERSON_DIR, `${personId}.json`);
  if (!fs.existsSync(file)) {
    console.log(`  Warning: Missing person file for ${personId}`);
    return null;
  }

  const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return json2person(json);
};

/**
 * Rebuild a single database
 */
const rebuildDatabase = (dbPath: string): Database => {
  console.log(`\nRebuilding ${dbPath}...`);

  // Get person IDs from existing database
  const personIds = getPersonIdsFromDb(dbPath);
  console.log(`  Found ${personIds.length} persons in database`);

  // Re-process each person
  const db: Database = {};
  let processed = 0;
  let skipped = 0;

  for (const id of personIds) {
    const person = processPerson(id);
    if (person) {
      db[id] = person;
      processed++;
    } else {
      skipped++;
    }
  }

  // Add children relationships
  Object.keys(db).forEach((id) => {
    const person = db[id];
    if (!person.parents || !person.parents.length) return;
    person.parents.forEach((parentId) => {
      if (!parentId || !db[parentId]) return;
      if (!db[parentId].children) db[parentId].children = [];
      if (db[parentId].children.includes(id)) return;
      db[parentId].children.push(id);
    });
  });

  // Write updated database
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  console.log(`  Processed: ${processed}, Skipped: ${skipped}`);
  console.log(`  Database saved to ${dbPath}`);

  // Show sample of new fields
  const sampleId = personIds[0];
  const sample = db[sampleId];
  if (sample) {
    console.log(`\n  Sample person (${sampleId}):`);
    console.log(`    Name: ${sample.name}`);
    console.log(`    Gender: ${sample.gender}`);
    console.log(`    Living: ${sample.living}`);
    if (sample.alternateNames?.length) {
      console.log(`    Alternate names: ${sample.alternateNames.join(', ')}`);
    }
    if (sample.birth) {
      console.log(`    Birth: ${sample.birth.date} at ${sample.birth.place}`);
    }
    if (sample.death) {
      console.log(`    Death: ${sample.death.date} at ${sample.death.place}`);
    }
    if (sample.occupations?.length) {
      console.log(`    Occupations: ${sample.occupations.join(', ')}`);
    }
    if (sample.spouses?.length) {
      console.log(`    Spouses: ${sample.spouses.join(', ')}`);
    }
    console.log(`    Lifespan: ${sample.lifespan}`);
    console.log(`    Location: ${sample.location}`);
  }

  return db;
};

const maxGenerationsFromFilename = (filename: string): number => {
  const match = filename.match(/-(\d+)\.json$/);
  return match ? Number(match[1]) : Infinity;
};

/**
 * Populate PostgreSQL directly from the read-only raw person cache. This path
 * deliberately does not consult the legacy SQLite database.
 */
const rebuildPostgresDatabase = async (
  rootExternalId: string,
  maxGenerations: number
): Promise<void> => {
  const { database, missingPersonIds } = await loadFamilySearchTreeFromJson({
    rootExternalId,
    personDir: PERSON_DIR,
    maxGenerations,
  });
  if (!database[rootExternalId]) {
    throw new Error(`Root source file not found: ${path.join(PERSON_DIR, `${rootExternalId}.json`)}`);
  }
  if (missingPersonIds.length > 0) {
    console.warn(`  Warning: ${missingPersonIds.length} referenced person file(s) were missing`);
  }

  const result = await postgresWriter.rebuildDatabase({
    rootExternalId,
    database,
  });
  console.log(
    `  PostgreSQL query store rebuilt as ${result.databaseId}: ` +
    `${result.personCount} persons, ${result.parentEdgeCount} parent edges, ` +
    `${result.spouseEdgeCount} spouse edges`
  );
};

/**
 * Main entry point
 */
const main = async (): Promise<void> => {
  if (!rebuildAll && !dbId) {
    console.error('Usage: npx tsx scripts/rebuild.ts DB_ID [--max=N]  or  npx tsx scripts/rebuild.ts --all');
    process.exit(1);
  }

  const databases = getDatabaseFiles();

  if (rebuildAll) {
    console.log(`Found ${databases.length} databases to rebuild`);
    for (const { filename, rootId } of databases) {
      rebuildDatabase(path.join(DATA_DIR, filename));
      if (postgresWriter.isConfigured()) {
        await rebuildPostgresDatabase(
          rootId,
          requestedMaxGenerations ?? maxGenerationsFromFilename(filename)
        );
      }
    }
  } else {
    // Find matching database
    const match = databases.find(
      (d) => d.rootId === dbId || d.filename === `db-${dbId}.json`
    );

    if (!match && !postgresWriter.isConfigured()) {
      console.error(`Database not found for ID: ${dbId}`);
      console.log('Available databases:');
      databases.forEach((d) => console.log(`  - ${d.rootId} (${d.filename})`));
      process.exit(1);
    }

    if (match) rebuildDatabase(path.join(DATA_DIR, match.filename));
    if (postgresWriter.isConfigured()) {
      await rebuildPostgresDatabase(
        match?.rootId ?? dbId,
        requestedMaxGenerations ?? (match ? maxGenerationsFromFilename(match.filename) : Infinity)
      );
    }
  }

  console.log('\nRebuild complete!');
};

void main().finally(() => postgresWriter.close());
