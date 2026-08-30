import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database, Person } from '@fsf/shared';
// @ts-ignore - the legacy transformer is JavaScript and has no declarations
import { json2person } from './familysearch/transformer.js';

export interface JsonTreeLoadOptions {
  rootExternalId: string;
  personDir?: string;
  maxGenerations?: number;
}

export interface JsonTreeLoadResult {
  database: Database;
  missingPersonIds: string[];
}

/**
 * Rebuild an ancestor graph directly from the raw FamilySearch JSON cache.
 * Source files are read-only: children are derived on the returned in-memory
 * graph and are never written back into data/person.
 */
export async function loadFamilySearchTreeFromJson({
  rootExternalId,
  personDir = path.resolve('data/person'),
  maxGenerations = Infinity,
}: JsonTreeLoadOptions): Promise<JsonTreeLoadResult> {
  const database: Database = {};
  const missingPersonIds: string[] = [];
  const visited = new Set<string>();
  const queue: Array<{ externalId: string; generation: number }> = [
    { externalId: rootExternalId, generation: 0 },
  ];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { externalId, generation } = queue[cursor];
    if (visited.has(externalId) || generation > maxGenerations) continue;
    visited.add(externalId);

    const sourcePath = path.join(personDir, `${externalId}.json`);
    const source = await readFile(sourcePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (source === undefined) {
      missingPersonIds.push(externalId);
      continue;
    }

    const person = json2person(JSON.parse(source)) as Person | undefined;
    if (!person) continue;
    database[externalId] = person;

    if (generation === maxGenerations) continue;
    for (const parentId of person.parents) {
      if (parentId && !visited.has(parentId)) {
        queue.push({ externalId: parentId, generation: generation + 1 });
      }
    }
  }

  for (const [childId, person] of Object.entries(database)) {
    for (const parentId of person.parents) {
      const parent = parentId ? database[parentId] : undefined;
      if (parent && !parent.children.includes(childId)) parent.children.push(childId);
    }
  }

  return { database, missingPersonIds };
}
