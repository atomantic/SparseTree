#!/usr/bin/env npx tsx
/** Build the sample pedigree from a local JSON graph in PostgreSQL. */

import fs from 'node:fs';
import path from 'node:path';
import { ulid } from 'ulid';
import type { Database, Person } from '@fsf/shared';
import { postgresService } from '../server/src/db/postgres.service.js';
import { postgresWriter } from '../server/src/lib/postgres-writer.js';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');
const SAMPLE_ROOT_FS_ID = '9CNK-KN3';
const MAX_GENERATIONS = 5;

interface SampleIdMapping {
  [canonicalId: string]: { ulid: string; fsId: string; name: string; generation: number };
}

function collectSample(source: Database): Database {
  const included = new Set<string>();
  const visitAncestors = (fsId: string, generation: number): void => {
    if (generation > MAX_GENERATIONS || included.has(fsId) || !source[fsId]) return;
    included.add(fsId);
    for (const parentId of source[fsId].parents ?? []) {
      if (parentId) visitAncestors(parentId, generation + 1);
    }
    for (const spouseId of source[fsId].spouses ?? []) {
      if (spouseId && source[spouseId]) included.add(spouseId);
    }
  };
  visitAncestors(SAMPLE_ROOT_FS_ID, 0);

  const result: Database = {};
  for (const fsId of included) result[fsId] = { ...source[fsId], parents: [...(source[fsId].parents ?? [])], children: [] };
  for (const [childId, person] of Object.entries(result)) {
    for (const parentId of person.parents) {
      if (!parentId || !result[parentId]) continue;
      result[parentId].children ??= [];
      if (!result[parentId].children.includes(childId)) result[parentId].children.push(childId);
    }
  }
  return result;
}

function calculateGenerations(rootId: string, database: Database): Map<string, number> {
  const generations = new Map<string, number>();
  const queue: Array<{ id: string; generation: number }> = [{ id: rootId, generation: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { id, generation } = queue[cursor];
    if (generations.has(id) || !database[id]) continue;
    generations.set(id, generation);
    for (const parentId of database[id].parents ?? []) {
      if (parentId && database[parentId] && !generations.has(parentId)) {
        queue.push({ id: parentId, generation: generation + 1 });
      }
    }
  }
  return generations;
}

async function main(): Promise<void> {
  if (!postgresService.isConfigured()) throw new Error('Set DATABASE_URL before creating the sample database.');
  const sourcePath = path.join(DATA_DIR, `db-${SAMPLE_ROOT_FS_ID}.json`);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source database not found: ${sourcePath}. Run the FamilySearch indexer first.`);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Database;
  const database = collectSample(source);
  const generations = calculateGenerations(SAMPLE_ROOT_FS_ID, database);
  if (!database[SAMPLE_ROOT_FS_ID]) throw new Error(`Sample root ${SAMPLE_ROOT_FS_ID} is missing from the source JSON.`);

  const previous = path.join(SAMPLES_DIR, 'id-mapping.json');
  const priorMapping = fs.existsSync(previous) ? JSON.parse(fs.readFileSync(previous, 'utf8')) as SampleIdMapping : {};
  const canonicalIds = new Map<string, string>();
  for (const [canonicalId, entry] of Object.entries(priorMapping)) canonicalIds.set(entry.fsId, canonicalId);
  for (const fsId of Object.keys(database)) {
    if (!canonicalIds.has(fsId)) canonicalIds.set(fsId, ulid());
  }

  const result = await postgresWriter.rebuildDatabase({
    rootExternalId: SAMPLE_ROOT_FS_ID,
    database,
    databaseId: `sample-${SAMPLE_ROOT_FS_ID}`,
    canonicalIds,
    isSample: true,
  });
  const mapping: SampleIdMapping = {};
  for (const [fsId, canonicalId] of result.personIds) {
    const person = database[fsId] as Person;
    mapping[canonicalId] = {
      ulid: canonicalId,
      fsId,
      name: person.name,
      generation: generations.get(fsId) ?? 0,
    };
  }
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.writeFileSync(previous, JSON.stringify(mapping, null, 2));

  console.log(`Sample database ${result.databaseId} rebuilt in PostgreSQL.`);
  console.log(`Persons: ${result.personCount}; parent edges: ${result.parentEdgeCount}; spouse edges: ${result.spouseEdgeCount}`);
  console.log(`ID mapping: ${previous}`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Sample database creation failed.');
    process.exitCode = 1;
  })
  .finally(() => postgresWriter.close());
