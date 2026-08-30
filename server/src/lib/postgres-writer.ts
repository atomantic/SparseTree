/**
 * PostgreSQL writer for the rebuildable Layer 2 query store.
 *
 * A complete person graph is synchronized in one transaction. JSON remains
 * authoritative; provider-owned rows are upserted/pruned while local rows such
 * as overrides and media keep their foreign keys because canonical person IDs
 * are reused from external_identity on every rebuild.
 */

import type { QueryResultRow } from 'pg';
import { postgresService } from '../db/postgres.service.js';
import {
  resolvePersonIds,
  syncPeople,
  type ExistingIdentityRow,
} from './postgres-person-sync.js';
import type {
  PostgresRebuildOptions,
  PostgresRebuildResult,
  PostgresTransaction,
  PostgresWriterService,
  WritableDatabase,
  WritablePerson,
} from './postgres-writer.types.js';

export type {
  PostgresRebuildOptions,
  PostgresRebuildResult,
} from './postgres-writer.types.js';

const SOURCE = 'familysearch';

interface ExistingParentEdgeRow extends QueryResultRow {
  id: string;
  child_id: string;
  parent_id: string;
}

interface ExistingSpouseEdgeRow extends QueryResultRow {
  id: string;
  person1_id: string;
  person2_id: string;
}

function calculateGenerations(rootExternalId: string, database: WritableDatabase): Map<string, number> {
  const generations = new Map<string, number>();
  const queue: Array<{ externalId: string; generation: number }> = [
    { externalId: rootExternalId, generation: 0 },
  ];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { externalId, generation } = queue[cursor];
    if (generations.has(externalId) || !database[externalId]) continue;
    generations.set(externalId, generation);
    for (const parentId of database[externalId].parents) {
      if (parentId && database[parentId] && !generations.has(parentId)) {
        queue.push({ externalId: parentId, generation: generation + 1 });
      }
    }
  }

  return generations;
}

async function syncRelationships(
  tx: PostgresTransaction,
  database: WritableDatabase,
  personIds: Map<string, string>
): Promise<{ parentEdgeCount: number; spouseEdgeCount: number }> {
  const canonicalIds = [...personIds.values()];
  const parentEdges = new Map<string, { childId: string; parentId: string; parentRole: string }>();
  const spouseEdges = new Map<string, { person1Id: string; person2Id: string }>();

  for (const [externalId, person] of Object.entries(database)) {
    const childId = personIds.get(externalId)!;
    for (const [index, parentExternalId] of person.parents.entries()) {
      const parentId = parentExternalId ? personIds.get(parentExternalId) : undefined;
      if (!parentId) continue;
      const parentRole = index === 0 ? 'father' : index === 1 ? 'mother' : 'parent';
      parentEdges.set(`${childId}:${parentId}`, { childId, parentId, parentRole });
    }

    for (const spouseExternalId of person.spouses ?? []) {
      const spouseId = personIds.get(spouseExternalId);
      if (!spouseId || spouseId === childId) continue;
      const [person1Id, person2Id] = childId < spouseId
        ? [childId, spouseId]
        : [spouseId, childId];
      spouseEdges.set(`${person1Id}:${person2Id}`, { person1Id, person2Id });
    }
  }

  // Reconcile only relationships fully represented by this graph. An edge to
  // a person outside a shallow rebuild may belong to another database view.
  const existingParents = await tx.queryAll<ExistingParentEdgeRow>(
    `SELECT id::text, child_id, parent_id
     FROM parent_edge
     WHERE source = @source
       AND child_id = ANY(@personIds::text[])
       AND parent_id = ANY(@personIds::text[])`,
    { source: SOURCE, personIds: canonicalIds }
  );
  for (const edge of parentEdges.values()) {
    await tx.run(
      `INSERT INTO parent_edge (child_id, parent_id, parent_role, confidence, source)
       VALUES (@childId, @parentId, @parentRole, 1.0, @source)
       ON CONFLICT (child_id, parent_id) DO UPDATE SET
         parent_role = EXCLUDED.parent_role,
         confidence = EXCLUDED.confidence,
         source = EXCLUDED.source
       WHERE parent_edge.source IS NULL OR parent_edge.source = EXCLUDED.source`,
      { ...edge, source: SOURCE }
    );
  }
  const staleParentIds = existingParents
    .filter((row) => !parentEdges.has(`${row.child_id}:${row.parent_id}`))
    .map((row) => row.id);
  if (staleParentIds.length > 0) {
    await tx.run('DELETE FROM parent_edge WHERE id = ANY(@ids::bigint[])', { ids: staleParentIds });
  }

  const existingSpouses = await tx.queryAll<ExistingSpouseEdgeRow>(
    `SELECT id::text, person1_id, person2_id
     FROM spouse_edge
     WHERE source = @source
       AND person1_id = ANY(@personIds::text[])
       AND person2_id = ANY(@personIds::text[])`,
    { source: SOURCE, personIds: canonicalIds }
  );
  for (const edge of spouseEdges.values()) {
    await tx.run(
      `INSERT INTO spouse_edge (person1_id, person2_id, confidence, source)
       VALUES (@person1Id, @person2Id, 1.0, @source)
       ON CONFLICT (person1_id, person2_id) DO UPDATE SET
         confidence = EXCLUDED.confidence,
         source = EXCLUDED.source
       WHERE spouse_edge.source IS NULL OR spouse_edge.source = EXCLUDED.source`,
      { ...edge, source: SOURCE }
    );
  }
  const staleSpouseIds = existingSpouses
    .filter((row) => !spouseEdges.has(`${row.person1_id}:${row.person2_id}`))
    .map((row) => row.id);
  if (staleSpouseIds.length > 0) {
    await tx.run('DELETE FROM spouse_edge WHERE id = ANY(@ids::bigint[])', { ids: staleSpouseIds });
  }

  return {
    parentEdgeCount: parentEdges.size,
    spouseEdgeCount: spouseEdges.size,
  };
}

async function syncDatabaseMembership(
  tx: PostgresTransaction,
  databaseId: string,
  rootExternalId: string,
  rootPersonId: string,
  rootPerson: WritablePerson,
  personIds: Map<string, string>,
  generations: Map<string, number>,
  isSample: boolean
): Promise<void> {
  let actualMaxGeneration = 0;
  for (const generation of generations.values()) {
    actualMaxGeneration = Math.max(actualMaxGeneration, generation);
  }
  await tx.run(
    `INSERT INTO database_info (
       db_id, root_id, root_name, source_provider, max_generations,
       person_count, is_sample, updated_at
     ) VALUES (
       @databaseId, @rootPersonId, @rootName, @source,
       @maxGenerations, @personCount, @isSample, CURRENT_TIMESTAMP
     )
     ON CONFLICT (db_id) DO UPDATE SET
       root_id = EXCLUDED.root_id,
       root_name = EXCLUDED.root_name,
       source_provider = EXCLUDED.source_provider,
       max_generations = EXCLUDED.max_generations,
       person_count = EXCLUDED.person_count,
       is_sample = EXCLUDED.is_sample,
       updated_at = CURRENT_TIMESTAMP`,
    {
      databaseId,
      rootPersonId,
      rootName: rootPerson.name,
      source: SOURCE,
      maxGenerations: actualMaxGeneration,
      personCount: personIds.size,
      isSample,
    }
  );

  for (const [externalId, personId] of personIds) {
    await tx.run(
      `INSERT INTO database_membership (db_id, person_id, is_root, generation)
       VALUES (@databaseId, @personId, @isRoot, @generation)
       ON CONFLICT (db_id, person_id) DO UPDATE SET
         is_root = EXCLUDED.is_root,
         generation = EXCLUDED.generation`,
      {
        databaseId,
        personId,
        isRoot: externalId === rootExternalId,
        generation: generations.get(externalId) ?? 0,
      }
    );
  }

  await tx.run(
    `DELETE FROM database_membership
     WHERE db_id = @databaseId
       AND NOT (person_id = ANY(@personIds::text[]))`,
    { databaseId, personIds: [...personIds.values()] }
  );
}

export function createPostgresWriter(service: PostgresWriterService = postgresService) {
  const isConfigured = (): boolean => service.isConfigured();

  const rebuildDatabase = async ({
    rootExternalId,
    database: inputDatabase,
    databaseId: requestedDatabaseId,
    canonicalIds,
    isSample = false,
  }: PostgresRebuildOptions): Promise<PostgresRebuildResult> => {
    const database = inputDatabase as WritableDatabase;
    const externalIds = Object.keys(database);
    const rootPerson = database[rootExternalId];
    if (!rootPerson) {
      throw new Error(`Cannot rebuild PostgreSQL: root ${rootExternalId} is missing from the JSON graph`);
    }
    if (!isConfigured()) {
      throw new Error('PostgreSQL is not configured; set DATABASE_URL before rebuilding the query store');
    }

    await service.initDb();
    return service.transaction(async (tx) => {
      // Natural-key rows such as provider claims/events predate dedicated
      // uniqueness constraints. Serialize rebuilds so two processes cannot
      // both observe an empty key and mint different ULIDs for the same fact.
      await tx.run(
        'SELECT pg_advisory_xact_lock(hashtext(@lockName))',
        { lockName: 'sparsetree:json-rebuild' }
      );
      const existingIdentities = await tx.queryAll<ExistingIdentityRow>(
        `SELECT external_id, person_id
         FROM external_identity
         WHERE source = @source AND external_id = ANY(@externalIds::text[])`,
        { source: SOURCE, externalIds }
      );
      const personIds = resolvePersonIds(externalIds, existingIdentities, canonicalIds);
      const rootPersonId = personIds.get(rootExternalId)!;
      const databaseId = requestedDatabaseId ?? rootPersonId;
      const generations = calculateGenerations(rootExternalId, database);

      await syncPeople(tx, externalIds, database, personIds);
      const relationshipCounts = await syncRelationships(tx, database, personIds);
      await syncDatabaseMembership(
        tx,
        databaseId,
        rootExternalId,
        rootPersonId,
        rootPerson,
        personIds,
        generations,
        isSample
      );

      return {
        databaseId,
        rootPersonId,
        personIds,
        personCount: externalIds.length,
        ...relationshipCounts,
      };
    });
  };

  return {
    isConfigured,
    init: service.initDb,
    close: service.closeDb,
    rebuildDatabase,
  };
}

export const postgresWriter = createPostgresWriter();
