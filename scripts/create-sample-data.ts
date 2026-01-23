#!/usr/bin/env npx tsx
/**
 * Create Sample Data for SparseTree
 *
 * Extracts John le Strange (9CNK-KN3) with 5 generations of ancestors
 * and creates a standalone sample SQLite database.
 *
 * Usage:
 *   npx tsx scripts/create-sample-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { ulid } from 'ulid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');

// John le Strange's FamilySearch ID
const SAMPLE_ROOT_FS_ID = '9CNK-KN3';
const MAX_GENERATIONS = 5;

// Ensure samples directory exists
if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
}

interface Person {
  name: string;
  birthName?: string;
  alternateNames?: string[];
  gender?: 'male' | 'female' | 'unknown';
  living?: boolean;
  birth?: { date?: string; dateFormal?: string; place?: string };
  death?: { date?: string; dateFormal?: string; place?: string };
  burial?: { date?: string; place?: string };
  occupations?: string[];
  bio?: string;
  parents: string[];
  children: string[];
  spouses?: string[];
  lifespan?: string;
  location?: string;
  occupation?: string;
}

interface Database {
  [id: string]: Person;
}

// Load the source database
const sourceDbPath = path.join(DATA_DIR, `db-${SAMPLE_ROOT_FS_ID}.json`);
if (!fs.existsSync(sourceDbPath)) {
  console.error(`Source database not found: ${sourceDbPath}`);
  console.error('Please run the indexer first: FS_ACCESS_TOKEN=xxx node index 9CNK-KN3 --max=5');
  process.exit(1);
}

console.log(`Loading source database: ${sourceDbPath}`);
const sourceDb: Database = JSON.parse(fs.readFileSync(sourceDbPath, 'utf-8'));
console.log(`Loaded ${Object.keys(sourceDb).length} persons from source`);

// Collect persons within MAX_GENERATIONS
const includedPersons = new Set<string>();
const fsIdToUlid = new Map<string, string>();

function collectAncestors(fsId: string, generation: number): void {
  if (generation > MAX_GENERATIONS) return;
  if (includedPersons.has(fsId)) return;
  if (!sourceDb[fsId]) return;

  includedPersons.add(fsId);

  // Generate ULID for this person
  if (!fsIdToUlid.has(fsId)) {
    fsIdToUlid.set(fsId, ulid());
  }

  const person = sourceDb[fsId];

  // Collect parents
  for (const parentId of person.parents) {
    if (parentId && sourceDb[parentId]) {
      collectAncestors(parentId, generation + 1);
    }
  }

  // Also include spouses (at same generation level, don't recurse their ancestors)
  if (person.spouses) {
    for (const spouseId of person.spouses) {
      if (spouseId && sourceDb[spouseId] && !includedPersons.has(spouseId)) {
        includedPersons.add(spouseId);
        if (!fsIdToUlid.has(spouseId)) {
          fsIdToUlid.set(spouseId, ulid());
        }
      }
    }
  }
}

// Start collection from root
console.log(`\nCollecting ancestors of ${SAMPLE_ROOT_FS_ID} up to ${MAX_GENERATIONS} generations...`);
collectAncestors(SAMPLE_ROOT_FS_ID, 0);
console.log(`Collected ${includedPersons.size} persons`);

// Create sample SQLite database
const sampleDbPath = path.join(SAMPLES_DIR, 'sample.db');
if (fs.existsSync(sampleDbPath)) {
  fs.unlinkSync(sampleDbPath);
}

console.log(`\nCreating sample database: ${sampleDbPath}`);
const db = new Database(sampleDbPath);

// Apply schema
const schemaPath = path.join(ROOT_DIR, 'server/src/db/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Performance optimizations
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Helper to parse year from date string
function parseYear(date: string | undefined): number | null {
  if (!date) return null;
  const bcMatch = date.match(/(\d+)\s*BC/i);
  if (bcMatch) return -parseInt(bcMatch[1], 10);
  const formalMatch = date.match(/^([+-]?)(\d+)/);
  if (formalMatch) {
    const sign = formalMatch[1] === '-' ? -1 : 1;
    return sign * parseInt(formalMatch[2], 10);
  }
  const yearMatch = date.match(/\b(\d{4})\b/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  return null;
}

// Prepared statements
const insertPerson = db.prepare(`
  INSERT INTO person (person_id, display_name, birth_name, gender, living, bio)
  VALUES (@personId, @displayName, @birthName, @gender, @living, @bio)
`);

const insertExternalId = db.prepare(`
  INSERT INTO external_identity (person_id, source, external_id, last_seen_at)
  VALUES (@personId, 'familysearch', @externalId, datetime('now'))
`);

const insertDbMembership = db.prepare(`
  INSERT INTO database_membership (db_id, person_id, is_root, generation)
  VALUES (@dbId, @personId, @isRoot, @generation)
`);

const insertVitalEvent = db.prepare(`
  INSERT INTO vital_event (person_id, event_type, date_original, date_formal, date_year, place, source)
  VALUES (@personId, @eventType, @dateOriginal, @dateFormal, @dateYear, @place, 'familysearch')
`);

const insertClaim = db.prepare(`
  INSERT INTO claim (claim_id, person_id, predicate, value_text, source)
  VALUES (@claimId, @personId, @predicate, @value, 'familysearch')
`);

const insertParentEdge = db.prepare(`
  INSERT OR IGNORE INTO parent_edge (child_id, parent_id, parent_role, source)
  VALUES (@childId, @parentId, @parentRole, 'familysearch')
`);

const insertSpouseEdge = db.prepare(`
  INSERT OR IGNORE INTO spouse_edge (person1_id, person2_id, source)
  VALUES (@p1, @p2, 'familysearch')
`);

const insertDbInfo = db.prepare(`
  INSERT INTO database_info (db_id, root_id, root_name, source_provider, is_sample)
  VALUES (@dbId, @rootId, @rootName, 'familysearch', 1)
`);

const updateFts = db.prepare(`
  INSERT INTO person_fts (person_id, display_name, birth_name, aliases, bio, occupations)
  VALUES (@personId, @displayName, @birthName, @aliases, @bio, @occupations)
`);

// Calculate generation for each person (BFS from root)
const generations = new Map<string, number>();
const queue: { id: string; gen: number }[] = [{ id: SAMPLE_ROOT_FS_ID, gen: 0 }];
const visited = new Set<string>();

while (queue.length > 0) {
  const { id, gen } = queue.shift()!;
  if (visited.has(id)) continue;
  visited.add(id);
  generations.set(id, gen);

  const person = sourceDb[id];
  if (person) {
    for (const parentId of person.parents) {
      if (parentId && includedPersons.has(parentId) && !visited.has(parentId)) {
        queue.push({ id: parentId, gen: gen + 1 });
      }
    }
  }
}

// Insert all data in a transaction
console.log('\nInserting data...');
const insertAll = db.transaction(() => {
  const dbId = `sample-${SAMPLE_ROOT_FS_ID}`;
  const rootUlid = fsIdToUlid.get(SAMPLE_ROOT_FS_ID)!;
  const rootPerson = sourceDb[SAMPLE_ROOT_FS_ID];

  // Insert persons first (database_info has FK to person)
  for (const fsId of includedPersons) {
    const person = sourceDb[fsId];
    const ulidId = fsIdToUlid.get(fsId)!;
    const generation = generations.get(fsId) ?? 0;

    // Person record
    insertPerson.run({
      personId: ulidId,
      displayName: person.name,
      birthName: person.birthName ?? null,
      gender: person.gender ?? 'unknown',
      living: person.living ? 1 : 0,
      bio: person.bio ?? null,
    });

    // External identity
    insertExternalId.run({
      personId: ulidId,
      externalId: fsId,
    });

    // Database membership
    insertDbMembership.run({
      dbId,
      personId: ulidId,
      isRoot: fsId === SAMPLE_ROOT_FS_ID ? 1 : 0,
      generation,
    });

    // Vital events
    if (person.birth) {
      insertVitalEvent.run({
        personId: ulidId,
        eventType: 'birth',
        dateOriginal: person.birth.date ?? null,
        dateFormal: person.birth.dateFormal ?? null,
        dateYear: parseYear(person.birth.dateFormal ?? person.birth.date),
        place: person.birth.place ?? null,
      });
    }

    if (person.death) {
      insertVitalEvent.run({
        personId: ulidId,
        eventType: 'death',
        dateOriginal: person.death.date ?? null,
        dateFormal: person.death.dateFormal ?? null,
        dateYear: parseYear(person.death.dateFormal ?? person.death.date),
        place: person.death.place ?? null,
      });
    }

    if (person.burial) {
      insertVitalEvent.run({
        personId: ulidId,
        eventType: 'burial',
        dateOriginal: person.burial.date ?? null,
        dateFormal: null,
        dateYear: parseYear(person.burial.date),
        place: person.burial.place ?? null,
      });
    }

    // Claims for occupations
    if (person.occupations) {
      for (const occ of person.occupations) {
        insertClaim.run({
          claimId: ulid(),
          personId: ulidId,
          predicate: 'occupation',
          value: occ,
        });
      }
    }

    // Claims for aliases
    if (person.alternateNames) {
      for (const alias of person.alternateNames) {
        insertClaim.run({
          claimId: ulid(),
          personId: ulidId,
          predicate: 'alias',
          value: alias,
        });
      }
    }

    // FTS index
    updateFts.run({
      personId: ulidId,
      displayName: person.name,
      birthName: person.birthName ?? '',
      aliases: person.alternateNames?.join(' ') ?? '',
      bio: person.bio ?? '',
      occupations: person.occupations?.join(' ') ?? '',
    });
  }

  // Insert relationships
  for (const fsId of includedPersons) {
    const person = sourceDb[fsId];
    const childUlidId = fsIdToUlid.get(fsId)!;

    // Parent relationships
    for (let i = 0; i < person.parents.length; i++) {
      const parentFsId = person.parents[i];
      if (parentFsId && fsIdToUlid.has(parentFsId)) {
        const parentUlidId = fsIdToUlid.get(parentFsId)!;
        const parentRole = i === 0 ? 'father' : i === 1 ? 'mother' : 'parent';
        insertParentEdge.run({
          childId: childUlidId,
          parentId: parentUlidId,
          parentRole,
        });
      }
    }

    // Spouse relationships
    if (person.spouses) {
      for (const spouseFsId of person.spouses) {
        if (spouseFsId && fsIdToUlid.has(spouseFsId)) {
          const spouseUlidId = fsIdToUlid.get(spouseFsId)!;
          const [p1, p2] = childUlidId < spouseUlidId
            ? [childUlidId, spouseUlidId]
            : [spouseUlidId, childUlidId];
          insertSpouseEdge.run({ p1, p2 });
        }
      }
    }
  }

  // Insert database info (after all persons exist due to FK constraint)
  insertDbInfo.run({
    dbId,
    rootId: rootUlid,
    rootName: rootPerson.name,
  });
});

insertAll();

// Record migration
db.prepare(`INSERT INTO migration (name) VALUES ('001_initial')`).run();

// Checkpoint WAL to main database file
db.pragma('wal_checkpoint(TRUNCATE)');

// Get stats
const stats = {
  persons: db.prepare('SELECT COUNT(*) as count FROM person').get() as { count: number },
  externalIds: db.prepare('SELECT COUNT(*) as count FROM external_identity').get() as { count: number },
  parentEdges: db.prepare('SELECT COUNT(*) as count FROM parent_edge').get() as { count: number },
  spouseEdges: db.prepare('SELECT COUNT(*) as count FROM spouse_edge').get() as { count: number },
  vitalEvents: db.prepare('SELECT COUNT(*) as count FROM vital_event').get() as { count: number },
  claims: db.prepare('SELECT COUNT(*) as count FROM claim').get() as { count: number },
};

db.close();

// Remove WAL files (they're checkpointed)
const walPath = sampleDbPath + '-wal';
const shmPath = sampleDbPath + '-shm';
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

// Create ID mapping file for reference
const mappingPath = path.join(SAMPLES_DIR, 'id-mapping.json');
const mapping: Record<string, { ulid: string; fsId: string; name: string; generation: number }> = {};
for (const fsId of includedPersons) {
  const ulidId = fsIdToUlid.get(fsId)!;
  mapping[ulidId] = {
    ulid: ulidId,
    fsId,
    name: sourceDb[fsId].name,
    generation: generations.get(fsId) ?? 0,
  };
}
fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));

// Create README for samples
const readmePath = path.join(SAMPLES_DIR, 'README.md');
fs.writeFileSync(readmePath, `# SparseTree Sample Data

This directory contains sample genealogy data for testing and demonstration.

## Sample Person: John le Strange

- **FamilySearch ID**: 9CNK-KN3
- **Generations**: ${MAX_GENERATIONS} (ancestors only)
- **Total Persons**: ${stats.persons.count}

## Files

- \`sample.db\` - SQLite database with canonical IDs
- \`id-mapping.json\` - Mapping between canonical ULIDs and FamilySearch IDs

## Database Statistics

| Table | Count |
|-------|-------|
| Persons | ${stats.persons.count} |
| External IDs | ${stats.externalIds.count} |
| Parent Edges | ${stats.parentEdges.count} |
| Spouse Edges | ${stats.spouseEdges.count} |
| Vital Events | ${stats.vitalEvents.count} |
| Claims | ${stats.claims.count} |

## Usage

The sample database is automatically detected by SparseTree when present.
It uses canonical ULID identifiers with FamilySearch IDs mapped in the
\`external_identity\` table.

To regenerate this sample data:
\`\`\`bash
npx tsx scripts/create-sample-data.ts
\`\`\`
`);

console.log('\n=== Sample Data Created ===');
console.log(`Database: ${sampleDbPath}`);
console.log(`ID Mapping: ${mappingPath}`);
console.log(`README: ${readmePath}`);
console.log('\nStatistics:');
console.log(`  Persons: ${stats.persons.count}`);
console.log(`  External IDs: ${stats.externalIds.count}`);
console.log(`  Parent Edges: ${stats.parentEdges.count}`);
console.log(`  Spouse Edges: ${stats.spouseEdges.count}`);
console.log(`  Vital Events: ${stats.vitalEvents.count}`);
console.log(`  Claims: ${stats.claims.count}`);
console.log('\nDone!');
