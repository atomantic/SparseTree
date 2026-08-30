import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { loadFamilySearchTreeFromJson } from '../../../server/src/lib/json-tree-loader.js';
import { createPostgresWriter } from '../../../server/src/lib/postgres-writer.js';
import { createFamilySearchResponse } from '../../utils/fixtures.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

const count = async (
  service: ReturnType<typeof createPostgresService>,
  table: string
): Promise<number> => {
  const row = await service.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(row?.count ?? 0);
};

describePostgres('PostgreSQL JSON rebuild writer', () => {
  const schemaName = `sparsetree_writer_${process.pid}_${Date.now()}`;
  const quotedSchema = `"${schemaName}"`;
  let adminPool: Pool;
  let service: ReturnType<typeof createPostgresService>;
  let writer: ReturnType<typeof createPostgresWriter>;
  let personDir: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString, application_name: 'sparsetree-writer-admin-test' });
    await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
    const pool = new Pool({
      connectionString,
      application_name: 'sparsetree-writer-test',
      options: `-c search_path=${schemaName}`,
    });
    service = createPostgresService({ pool });
    writer = createPostgresWriter(service);
    personDir = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-person-json-'));

    const fixtures = {
      'ROOT-001': createFamilySearchResponse({
        id: 'ROOT-001',
        name: 'Root Person',
        parents: ['PARENT-001', 'PARENT-002'],
        occupation: 'Cartographer',
        bio: 'Mapped the family tree.',
      }),
      'PARENT-001': createFamilySearchResponse({
        id: 'PARENT-001',
        name: 'First Parent',
        gender: 'Male',
      }),
      'PARENT-002': createFamilySearchResponse({
        id: 'PARENT-002',
        name: 'Second Parent',
        gender: 'Female',
      }),
    };
    await Promise.all(Object.entries(fixtures).map(([id, fixture]) =>
      writeFile(path.join(personDir, `${id}.json`), JSON.stringify(fixture, null, 2))
    ));
  });

  afterAll(async () => {
    if (writer) await writer.close();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await adminPool.end();
    }
    if (personDir) await rm(personDir, { recursive: true, force: true });
  });

  it('rebuilds a raw JSON tree idempotently without changing the source files', async () => {
    const sourcePaths = ['ROOT-001', 'PARENT-001', 'PARENT-002']
      .map((id) => path.join(personDir, `${id}.json`));
    const sourceBefore = await Promise.all(sourcePaths.map((sourcePath) => readFile(sourcePath, 'utf8')));
    const loaded = await loadFamilySearchTreeFromJson({
      rootExternalId: 'ROOT-001',
      personDir,
    });

    expect(loaded.missingPersonIds).toEqual([]);
    expect(Object.keys(loaded.database)).toHaveLength(3);
    expect(loaded.database['PARENT-001'].children).toEqual(['ROOT-001']);

    const canonicalIds = new Map([
      ['ROOT-001', '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      ['PARENT-001', '01ARZ3NDEKTSV4RRFFQ69G5FAW'],
      ['PARENT-002', '01ARZ3NDEKTSV4RRFFQ69G5FAX'],
    ]);
    const first = await writer.rebuildDatabase({
      rootExternalId: 'ROOT-001',
      database: loaded.database,
      canonicalIds,
    });
    const identityIds = await service.queryAll<{ external_id: string; person_id: string }>(
      'SELECT external_id, person_id FROM external_identity ORDER BY external_id'
    );
    const claimIds = await service.queryAll<{ claim_id: string }>(
      'SELECT claim_id FROM claim ORDER BY claim_id'
    );
    const eventIds = await service.queryAll<{ event_id: string }>(
      'SELECT event_id FROM life_event ORDER BY event_id'
    );
    const noteIds = await service.queryAll<{ note_id: string }>(
      'SELECT note_id FROM note ORDER BY note_id'
    );
    const rootPersonId = canonicalIds.get('ROOT-001')!;
    const firstParentId = canonicalIds.get('PARENT-001')!;
    await service.run(
      `INSERT INTO media (media_id, person_id, source, caption)
       VALUES (@mediaId, @personId, 'local', 'Preserved portrait')`,
      { mediaId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', personId: rootPersonId }
    );
    await service.run(
      `UPDATE parent_edge
       SET source = 'local', parent_role = 'parent'
       WHERE child_id = @childId AND parent_id = @parentId`,
      { childId: rootPersonId, parentId: firstParentId }
    );

    const second = await writer.rebuildDatabase({
      rootExternalId: 'ROOT-001',
      database: loaded.database,
    });

    expect(second.databaseId).toBe(first.databaseId);
    expect(identityIds).toEqual([
      { external_id: 'PARENT-001', person_id: canonicalIds.get('PARENT-001') },
      { external_id: 'PARENT-002', person_id: canonicalIds.get('PARENT-002') },
      { external_id: 'ROOT-001', person_id: canonicalIds.get('ROOT-001') },
    ]);
    expect(await count(service, 'person')).toBe(3);
    expect(await count(service, 'external_identity')).toBe(3);
    expect(await count(service, 'parent_edge')).toBe(2);
    expect(await count(service, 'database_membership')).toBe(3);
    expect(await count(service, 'database_info')).toBe(1);
    expect(await count(service, 'person_search')).toBe(3);
    expect(await count(service, 'claim')).toBeGreaterThan(0);
    expect(await service.queryAll('SELECT external_id, person_id FROM external_identity ORDER BY external_id'))
      .toEqual(identityIds);
    expect(await service.queryAll('SELECT claim_id FROM claim ORDER BY claim_id')).toEqual(claimIds);
    expect(await service.queryAll('SELECT event_id FROM life_event ORDER BY event_id')).toEqual(eventIds);
    expect(await service.queryAll('SELECT note_id FROM note ORDER BY note_id')).toEqual(noteIds);
    expect(await service.queryOne(
      `SELECT media_id, person_id, source, caption FROM media
       WHERE media_id = '01ARZ3NDEKTSV4RRFFQ69G5FAY'`
    )).toEqual({
      media_id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      person_id: rootPersonId,
      source: 'local',
      caption: 'Preserved portrait',
    });
    expect(await service.queryOne(
      `SELECT parent_role, source FROM parent_edge
       WHERE child_id = @childId AND parent_id = @parentId`,
      { childId: rootPersonId, parentId: firstParentId }
    )).toEqual({ parent_role: 'parent', source: 'local' });

    const memberships = await service.queryAll<{ external_id: string; generation: number; is_root: boolean }>(
      `SELECT external_identity.external_id, database_membership.generation, database_membership.is_root
       FROM database_membership
       JOIN external_identity USING (person_id)
       ORDER BY external_identity.external_id`
    );
    expect(memberships).toEqual([
      { external_id: 'PARENT-001', generation: 1, is_root: false },
      { external_id: 'PARENT-002', generation: 1, is_root: false },
      { external_id: 'ROOT-001', generation: 0, is_root: true },
    ]);
    expect(await Promise.all(sourcePaths.map((sourcePath) => readFile(sourcePath, 'utf8'))))
      .toEqual(sourceBefore);
  });

  it('rolls back the entire person graph when one row in the batch fails', async () => {
    await service.run(`
      CREATE FUNCTION sparsetree_reject_failure_fixture()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.display_name = 'Rollback Failure' THEN
          RAISE EXCEPTION 'forced rebuild failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg_reject_failure_fixture
      BEFORE INSERT OR UPDATE ON person
      FOR EACH ROW EXECUTE FUNCTION sparsetree_reject_failure_fixture();
    `);

    const failureDir = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-failing-json-'));
    await Promise.all([
      writeFile(
        path.join(failureDir, 'FAIL-ROOT.json'),
        JSON.stringify(createFamilySearchResponse({
          id: 'FAIL-ROOT',
          name: 'Rollback Root',
          parents: ['FAIL-PARENT'],
        }))
      ),
      writeFile(
        path.join(failureDir, 'FAIL-PARENT.json'),
        JSON.stringify(createFamilySearchResponse({
          id: 'FAIL-PARENT',
          name: 'Rollback Failure',
        }))
      ),
    ]);
    const loaded = await loadFamilySearchTreeFromJson({
      rootExternalId: 'FAIL-ROOT',
      personDir: failureDir,
    });

    await expect(writer.rebuildDatabase({
      rootExternalId: 'FAIL-ROOT',
      database: loaded.database,
    })).rejects.toThrow('forced rebuild failure');

    expect(await count(service, 'person')).toBe(3);
    expect(await service.queryAll(
      `SELECT external_id FROM external_identity
       WHERE external_id = ANY(@externalIds::text[])`,
      { externalIds: ['FAIL-ROOT', 'FAIL-PARENT'] }
    )).toEqual([]);

    await rm(failureDir, { recursive: true, force: true });
    await service.run('DROP TRIGGER trg_reject_failure_fixture ON person');
    await service.run('DROP FUNCTION sparsetree_reject_failure_fixture()');
  });
});
