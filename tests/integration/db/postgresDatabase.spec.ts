import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import type { Database } from '@fsf/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { createPostgresWriter } from '../../../server/src/lib/postgres-writer.js';
import { createDatabaseService, databaseService } from '../../../server/src/services/database.service.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';
import { createJsonDatabase } from '../../../server/src/services/json-database.js';
import { databaseRoutes } from '../../../server/src/routes/database.routes.js';
import { personRoutes } from '../../../server/src/routes/person.routes.js';
import { errorHandler } from '../../../server/src/middleware/errorHandler.js';

vi.mock('../../../server/src/services/legacy-sqlite-database.js', () => ({ legacySqliteDatabase: {
  applyOverrides: vi.fn(), isEnabled: () => false,
} }));
vi.mock('../../../server/src/services/scraper.service.js', () => ({ scraperService: { hasPhoto: () => false } }));

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const graph: Database = {
  'ROOT-001': { name: 'Zoe Example', gender: 'female', living: true, parents: ['FATHER-001', 'MOTHER-001'], children: [], lifespan: '1900-1970',
    birth: { date: '12 March 1900', dateFormal: '+1900-03-12', place: 'London, England' }, death: { date: '1970' }, occupations: ['Cartographer'], aliases: ['Z'] },
  'FATHER-001': { name: 'Adam Example', gender: 'male', living: false, parents: [], children: ['ROOT-001'], spouses: ['MOTHER-001'], lifespan: '1870-1940',
    birth: { date: '1870', place: 'York, England' }, death: { date: '1940', place: 'London, England' } },
  'MOTHER-001': { name: 'Beth Example', gender: 'female', living: false, parents: [], children: ['ROOT-001'], lifespan: '1880-1950', birth: { date: '1880' }, death: { date: '1950' } },
};

describePostgres('core reads from a rebuilt PostgreSQL store', () => {
  const schema = `sparsetree_reads_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let service: ReturnType<typeof createDatabaseService>;
  let directory: string;
  let samples: string;
  let root: string;
  let father: string;
  let mother: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2000 });
    pool.on('error', () => {});
    store = createPostgresService({ pool });
    await store.initDb();
    directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-reads-'));
    samples = path.join(directory, 'samples');
    await mkdir(samples);
  });
  beforeEach(async () => {
    await store.run('TRUNCATE person, database_info CASCADE');
    const rebuilt = await createPostgresWriter(store).rebuildDatabase({ rootExternalId: 'ROOT-001', database: graph });
    root = rebuilt.rootPersonId;
    father = rebuilt.personIds.get('FATHER-001')!;
    mother = rebuilt.personIds.get('MOTHER-001')!;
    await writeFile(path.join(directory, 'db-ROOT-001.json'), JSON.stringify(graph));
    const json = createJsonDatabase(directory, samples);
    service = createDatabaseService(store, json, createPostgresDatabase(store));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const app = () => {
    for (const key of ['listDatabases', 'getDatabaseInfo', 'getTreeStats', 'getOnThisDay', 'deleteDatabase', 'getPerson', 'listPersons', 'createRoot', 'updateRoot', 'refreshRootCount', 'calculateMaxGenerations'] as const) {
      vi.spyOn(databaseService, key).mockImplementation(service[key] as never);
    }
    const server = express();
    server.use(express.json());
    server.use('/api/databases', databaseRoutes);
    server.use('/api/persons', personRoutes);
    server.use(errorHandler);
    return server;
  };

  it('resolves external and canonical roots and returns native response types', async () => {
    expect(await service.resolveDbId('ROOT-001')).toBe(root);
    expect(await service.resolveDbId(root)).toBe(root);
    expect(await service.isRoot('ROOT-001')).toBe(true);
    expect(await service.listDatabases()).toEqual([expect.objectContaining({ id: root, rootExternalId: 'ROOT-001', personCount: 3, isSample: false, maxGenerations: 1 })]);
    expect(await service.getPerson(root, 'ROOT-001')).toMatchObject({ id: root, canonicalId: root, externalId: 'ROOT-001', living: true, parents: [father, mother], aliases: ['Z'], occupations: ['Cartographer'] });
    expect(await service.getPerson(root, father)).toMatchObject({ id: father, living: false, spouses: [mother], children: [root] });
    expect(await service.personExists(root, 'FATHER-001')).toBe(true);
    expect(await service.personExists(root, 'MISSING')).toBe(false);
    expect((await service.getPersonsBatch([mother, 'MISSING', root, father])).map(person => person.id)).toEqual([mother, root, father]);
  });

  it('loads membership, paginates in name order, and limits ancestry depth', async () => {
    expect(Object.keys(await service.getDatabase(root)).sort()).toEqual([root, father, mother].sort());
    expect(await service.listPersons(root, { limit: 1, page: 2 })).toMatchObject({ total: 3, persons: [{ id: mother, externalId: 'MOTHER-001' }] });
    expect(Object.keys(await service.getAncestorsLimited(root, 'ROOT-001', 0))).toEqual([root]);
    expect(Object.keys(await service.getAncestorsLimited(root, root, 1)).sort()).toEqual([root, father, mother].sort());
  });

  it('supports legacy custom database IDs and bounds cyclic ancestry without memberships', async () => {
    await createPostgresWriter(store).rebuildDatabase({ rootExternalId: 'ROOT-001', database: graph, databaseId: 'custom-db' });
    expect(await service.resolveDbId('custom-db')).toBe('custom-db');
    await store.run('DELETE FROM database_membership WHERE db_id = @root', { root });
    await store.run('INSERT INTO parent_edge (child_id, parent_id, parent_role) VALUES (@father, @root, \'parent\')', { father, root });
    expect(Object.keys(await service.getDatabase(root)).sort()).toEqual([root, father, mother].sort());
    expect((await service.refreshRootCount(root)).personCount).toBe(3);
  });

  it('returns PostgreSQL statistics with numeric counts and average-age keys', async () => {
    const stats = await service.getTreeStats(root);
    expect(stats).toMatchObject({ totalPersons: 3, gender: { male: 1, female: 2, unknown: 0 }, providers: { familysearch: 3 },
      generations: [{ generation: 0, count: 1 }, { generation: 1, count: 2 }],
      surnames: [{ surname: 'Example', count: 3 }], lifespans: { overall: { avgAge: 70, count: 3 } },
      occupations: [{ occupation: 'Cartographer', count: 1 }] });
    expect(stats.lifespans.byGender).toContainEqual({ gender: 'female', avgAge: 70, count: 2 });
    expect(stats.completeness.hasDeathDate).toBe(2);
  });

  it('awaits real database and person routes, including anniversaries and updates', async () => {
    const server = app();
    const list = await request(server).get('/api/databases').expect(200);
    expect(list.body.data[0].id).toBe(root);
    const person = await request(server).get(`/api/persons/${root}/ROOT-001`).expect(200);
    expect(person.body.data).toMatchObject({ id: root, name: 'Zoe Example', living: true });
    const people = await request(server).get(`/api/persons/${root}?page=1&limit=1`).expect(200);
    expect(people.body.data.results[0].id).toBe(father);
    const anniversaries = await request(server).get(`/api/databases/${root}/on-this-day?month=3&day=12`).expect(200);
    expect(anniversaries.body.data).toEqual([expect.objectContaining({ personId: root, year: 1900 })]);
    const updated = await request(server).put(`/api/databases/${root}`).send({ maxGenerations: 10 }).expect(200);
    expect(updated.body.data.maxGenerations).toBe(10);
    const calculated = await request(server).post(`/api/databases/${root}/calculate-generations`).expect(200);
    expect(calculated.body.data.maxGenerations).toBe(1);
    const stats = await request(server).get(`/api/databases/${root}/stats`).expect(200);
    expect(stats.body.data.totalPersons).toBe(3);
  });

  it('creates roots and preserves sample protection before destructive cleanup', async () => {
    expect(await service.createRoot('FATHER-001', { maxGenerations: 2 })).toMatchObject({ rootId: father, personCount: 1, maxGenerations: 2 });
    await expect(service.createRoot(father)).rejects.toThrow('already a root');
    await store.run('UPDATE database_info SET is_sample = TRUE WHERE db_id = @root', { root });
    await expect(service.deleteDatabase(root)).rejects.toThrow('Cannot delete sample');
    expect(JSON.parse(await readFile(path.join(directory, 'db-ROOT-001.json'), 'utf8'))).toEqual(graph);
    expect(await service.personExists(root, father)).toBe(true);
  });

  it('rolls back deletion and keeps JSON when a dependent delete fails', async () => {
    await store.run(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END; $$`);
    await store.run('CREATE TRIGGER reject_delete BEFORE DELETE ON database_info FOR EACH ROW EXECUTE FUNCTION reject_delete()');
    await expect(service.deleteDatabase(root)).rejects.toThrow('fixture rejection');
    expect(await service.personExists(root, father)).toBe(true);
    expect(JSON.parse(await readFile(path.join(directory, 'db-ROOT-001.json'), 'utf8'))).toEqual(graph);
    await store.run('DROP TRIGGER reject_delete ON database_info');
    await store.run('DROP FUNCTION reject_delete()');
  });

  it('deletes the root, memberships, favorites, and matching JSON while retaining people', async () => {
    await store.run('INSERT INTO favorite (person_id, db_id) VALUES (@father, @root)', { father, root });
    await request(app()).delete(`/api/databases/${root}`).expect(200);
    expect(await store.queryAll('SELECT * FROM database_info')).toEqual([]);
    expect(await store.queryAll('SELECT * FROM database_membership')).toEqual([]);
    expect(await store.queryAll('SELECT * FROM favorite')).toEqual([]);
    expect(await store.queryOne('SELECT COUNT(*)::int AS count FROM person')).toEqual({ count: 3 });
    await expect(readFile(path.join(directory, 'db-ROOT-001.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
