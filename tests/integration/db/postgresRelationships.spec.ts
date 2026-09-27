import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@fsf/shared';
import { createPostgresService, postgresService } from '../../../server/src/db/postgres.service.js';
import { createPostgresWriter } from '../../../server/src/lib/postgres-writer.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';
import { databaseService } from '../../../server/src/services/database.service.js';
import { createIdMappingService } from '../../../server/src/services/id-mapping.service.js';
import { createRelationshipService } from '../../../server/src/services/relationship.service.js';
import { pathService } from '../../../server/src/services/path.service.js';
import { sparseTreeService } from '../../../server/src/services/sparse-tree.service.js';
import { favoritesService } from '../../../server/src/services/favorites.service.js';
import { augmentationService } from '../../../server/src/services/augmentation.service.js';
import { ancestryUpdateService } from '../../../server/src/services/ancestry-update.service.js';
import { personService } from '../../../server/src/services/person.service.js';
import { addProviderMapping, removeProviderMapping } from '../../../server/src/services/provider-mapping.service.js';
import { personRoutes } from '../../../server/src/routes/person.routes.js';
import { pathRoutes } from '../../../server/src/routes/path.routes.js';
import { mapRouter } from '../../../server/src/routes/map.routes.js';
import { integrityRouter } from '../../../server/src/routes/integrity.routes.js';
import { ancestryUpdateRouter } from '../../../server/src/routes/ancestry-update.routes.js';
import { errorHandler } from '../../../server/src/middleware/errorHandler.js';

vi.mock('../../../server/src/services/scraper.service.js', () => ({ scraperService: { hasPhoto: () => false } }));
vi.mock('../../../server/src/services/browser.service.js', () => ({ browserService: { verifyAndReconnect: async () => true } }));
vi.mock('../../../server/src/services/provider.service.js', () => ({ providerService: { ensureAuthenticated: async () => ({ authenticated: true }) } }));

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const graph: Database = {
  'ROOT-152': { name: 'Root Person', gender: 'female', living: true, parents: ['FATHER-152', 'MOTHER-152'], children: [], lifespan: '1900-', birth: { date: '1900', place: 'London' } },
  'FATHER-152': { name: 'Father Person', gender: 'male', living: false, parents: [], children: ['ROOT-152'], lifespan: '1870-1940', birth: { date: '1870', place: 'York' }, death: { date: '1940', place: 'Missing Place' } },
  'MOTHER-152': { name: 'Mother Person', gender: 'female', living: false, parents: [], children: ['ROOT-152'], lifespan: '1880-', birth: { date: '1880', place: 'Pending Place' } },
};

describePostgres('PostgreSQL relationship and identity services', () => {
  const schema = `sparsetree_relationships_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let identities: ReturnType<typeof createIdMappingService>;
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
    identities = createIdMappingService(store);
  });
  beforeEach(async () => {
    await store.run('TRUNCATE person, database_info, place_geocode CASCADE');
    const rebuilt = await createPostgresWriter(store).rebuildDatabase({ rootExternalId: 'ROOT-152', database: graph });
    root = rebuilt.rootPersonId;
    father = rebuilt.personIds.get('FATHER-152')!;
    mother = rebuilt.personIds.get('MOTHER-152')!;
    for (const key of ['queryAll', 'queryOne', 'run', 'transaction', 'isConfigured'] as const) {
      vi.spyOn(postgresService, key).mockImplementation(store[key] as never);
    }
    const reads = createPostgresDatabase(store);
    for (const key of ['getDatabaseInfo', 'getAncestorsLimited', 'getDatabase', 'getPerson', 'resolveDbId'] as const) {
      vi.spyOn(databaseService, key).mockImplementation(reads[key] as never);
    }
    vi.spyOn(databaseService, 'isPostgresEnabled').mockResolvedValue(true);
    vi.spyOn(augmentationService, 'getAugmentation').mockResolvedValue(null);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await store.run('DROP TRIGGER IF EXISTS reject_membership ON database_membership');
  });
  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  const app = () => {
    const server = express();
    server.use(express.json());
    server.use('/api/persons', personRoutes);
    server.use('/api/path', pathRoutes);
    server.use('/api/map', mapRouter);
    server.use('/api/integrity', integrityRouter);
    server.use('/api/ancestry-update', ancestryUpdateRouter);
    server.use(errorHandler);
    return server;
  };

  it('preserves provider namespaces, confidence ordering, reassignment and removal', async () => {
    await identities.registerExternalId(root, 'ancestry', 'same-id', { confidence: 0.5 });
    await identities.registerExternalId(root, 'ancestry', 'best-id', { confidence: 1 });
    await identities.registerExternalId(father, 'wikitree', 'same-id');
    expect(await identities.resolveId('same-id', 'ancestry')).toBe(root);
    expect(await identities.resolveId('same-id', 'wikitree')).toBe(father);
    expect(await identities.getExternalId(root, 'ancestry')).toBe('best-id');
    await identities.registerExternalId(mother, 'ancestry', 'best-id');
    expect(await identities.getExternalId(root, 'ancestry')).toBe('same-id');
    expect(await identities.removeExternalId('ancestry', 'best-id')).toBe(true);
    expect(await identities.getExternalId(mother, 'ancestry')).toBeUndefined();
    expect(await identities.batchGetCanonicalIds('familysearch', ['ROOT-152', 'missing'])).toEqual(new Map([['ROOT-152', root]]));
    const response = await request(app()).get(`/api/persons/${root}/ROOT-152/identities`).expect(200);
    expect(response.body.data.identities).toContainEqual(expect.objectContaining({ source: 'ancestry', externalId: 'same-id' }));
    expect(await personService.inferParentRole(father)).toBe('father');
    expect(await personService.inferParentRole(mother)).toBe('mother');
    expect(await identities.resolveId('missing')).toBeUndefined();
  });

  it('commits a single person for concurrent creation and rolls back identity failures', async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => identities.getOrCreateCanonicalId('ancestry', 'new-id', 'New Person', { living: true })));
    expect(new Set(ids).size).toBe(1);
    expect(await store.queryOne('SELECT living FROM person WHERE person_id = @id', { id: ids[0] })).toEqual({ living: true });
    await expect(identities.createPerson('Duplicate Person', 'ancestry', 'new-id')).rejects.toMatchObject({ code: '23505' });
    expect(await store.queryOne("SELECT person_id FROM person WHERE display_name = 'Duplicate Person'")).toBeUndefined();
    await expect(store.transaction(async tx => {
      await identities.createPersonStub('Rolled Back Stub', {}, tx);
      throw new Error('reject outer operation');
    })).rejects.toThrow('reject outer operation');
    expect(await store.queryOne("SELECT person_id FROM person_search WHERE display_name = 'Rolled Back Stub'")).toBeUndefined();
  });

  it('walks cycles under the existing depth bounds and returns resolved path metadata', async () => {
    await store.run("INSERT INTO parent_edge (child_id, parent_id, parent_role) VALUES (@father, @root, 'mother')", { father, root });
    expect(await pathService.findAncestors(root, 'ROOT-152', 100)).toEqual([{ id: father, depth: 1 }, { id: mother, depth: 1 }]);
    expect(await pathService.findDescendants(root, father, 100)).toEqual([{ id: root, depth: 1 }]);
    expect(await pathService.findAncestors(root, root, 0)).toEqual([]);
    expect(await pathService.findAncestors(root, 'missing', 10)).toEqual([]);
    for (const method of ['shortest', 'longest', 'random'] as const) {
      const result = await pathService.findPath(root, root, father, method);
      expect(result.path[0].name).toBe('Root Person');
      expect(result.path.at(-1)?.name).toBe('Father Person');
      expect(result.path.length).toBeLessThanOrEqual(4);
      if (method === 'shortest') expect(result.path.map(person => person.name)).toEqual(['Root Person', 'Father Person']);
    }
    await expect(pathService.findPath(root, 'missing', father, 'shortest')).rejects.toThrow('Source person missing not found');
    const response = await request(app()).post(`/api/path/${root}`).send({ source: 'ROOT-152', target: 'MOTHER-152' }).expect(200);
    expect(response.body.data.path.map((person: { id: string }) => person.id)).toEqual([root, mother]);
    const tree = await personService.getPersonTree(root, root, 2, 'ancestors');
    expect(tree?.children?.[0].children?.[0]).toMatchObject({ id: root, _collapsed: true });
    vi.spyOn(favoritesService, 'getFavoritesInDatabase').mockResolvedValue([{ personId: 'FATHER-152' }] as never);
    const sparse = await sparseTreeService.getSparseTree(root);
    expect(sparse.totalFavorites).toBe(1);
    expect(JSON.stringify(sparse)).toContain(father);
    const events = [];
    for await (const event of ancestryUpdateService.runAncestryUpdate(root, root, 'full', true)) events.push(event);
    expect(events.find(event => event.type === 'queue_built')?.queueSize).toBe(3);
    expect(events.at(-1)?.type).toBe('completed');
    await request(app()).get(`/api/ancestry-update/${root}/validate/ROOT-152`).expect(200);
  });

  it('creates, rejects duplicates, and removes relationships using production routes', async () => {
    const server = app();
    const linked = await request(server).post(`/api/persons/ROOT-152/ROOT-152/link-relationship`)
      .send({ relationshipType: 'child', newPerson: { name: 'New Child' } }).expect(200);
    const child = linked.body.data.targetId;
    expect(await store.queryOne('SELECT parent_role FROM parent_edge WHERE child_id = @child', { child })).toEqual({ parent_role: 'mother' });
    expect(await store.queryOne('SELECT person_id FROM database_membership WHERE db_id = @root AND person_id = @child', { root, child })).toEqual({ person_id: child });
    expect(await store.queryOne('SELECT person_count FROM database_info WHERE db_id = @root', { root })).toEqual({ person_count: 4 });
    expect(await store.queryOne('SELECT display_name FROM person_search WHERE person_id = @child', { child })).toEqual({ display_name: 'New Child' });
    await request(server).post(`/api/persons/${root}/${root}/link-relationship`).send({ relationshipType: 'child', targetId: child }).expect(409);
    await request(server).delete(`/api/persons/${root}/${root}/unlink-relationship`).send({ relationshipType: 'child', targetId: child }).expect(200);
    expect(await store.queryOne('SELECT id FROM parent_edge WHERE child_id = @child', { child })).toBeUndefined();
    const stranger = await identities.createPersonStub('Other Database');
    await request(server).post(`/api/persons/${root}/${root}/link-relationship`).send({ relationshipType: 'spouse', targetId: stranger }).expect(403);
  });

  it('rolls back the stub, search row and edge when membership insertion fails', async () => {
    await store.run(`CREATE OR REPLACE FUNCTION reject_membership() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture rejects membership'; END; $$;
      CREATE TRIGGER reject_membership BEFORE INSERT ON database_membership FOR EACH ROW EXECUTE FUNCTION reject_membership()`);
    await request(app()).post(`/api/persons/${root}/${root}/link-relationship`)
      .send({ relationshipType: 'spouse', newPerson: { name: 'Failed Stub' } }).expect(500);
    expect(await store.queryOne('SELECT COUNT(*)::int AS count FROM person')).toEqual({ count: 3 });
    expect(await store.queryOne("SELECT person_id FROM person_search WHERE display_name = 'Failed Stub'")).toBeUndefined();
    expect(await store.queryOne('SELECT COUNT(*)::int AS count FROM spouse_edge')).toEqual({ count: 0 });
  });

  it('atomically imports parents and rolls back their identities for a missing child', async () => {
    const relationships = createRelationshipService(store);
    const imported = await relationships.linkProviderParents(root, 'ancestry', [
      { externalId: 'a-father', role: 'father', name: 'Imported Father' },
      { externalId: 'a-mother', role: 'mother', name: 'Imported Mother' },
    ]);
    expect(imported).toHaveLength(2);
    expect(await store.queryOne("SELECT COUNT(*)::int AS count FROM parent_edge WHERE source = 'ancestry'")).toEqual({ count: 2 });
    await expect(relationships.linkProviderParents('missing-child', 'ancestry', [{ externalId: 'orphan-id', role: 'father' }])).rejects.toMatchObject({ code: '23503' });
    expect(await identities.getCanonicalId('ancestry', 'orphan-id')).toBeUndefined();
    expect(await store.queryOne("SELECT COUNT(*)::int AS count FROM person")).toEqual({ count: 5 });
  });

  it('returns native integrity counts and ordered provider gap rows', async () => {
    await identities.registerExternalId(root, 'ancestry', 'a-root');
    const summary = await request(app()).get(`/api/integrity/ROOT-152`).expect(200);
    expect(summary.body.data).toMatchObject({ dbId: root, coverageGaps: 3, parentLinkageGaps: 2, orphanedEdges: 0 });
    const coverage = await request(app()).get(`/api/integrity/${root}/coverage`).expect(200);
    expect(coverage.body.data.find((row: { personId: string }) => row.personId === root).linkedProviders).toEqual(['ancestry', 'familysearch']);
    const parents = await request(app()).get(`/api/integrity/${root}/parents?provider=ancestry`).expect(200);
    expect(parents.body.data.map((row: { parentRole: string }) => row.parentRole)).toEqual(['father', 'mother']);
    const orphans = await request(app()).get(`/api/integrity/${root}/orphans`).expect(200);
    expect(orphans.body.data).toEqual([]);
  });

  it('uses PostgreSQL coordinates, statuses and aliases for map data and reset', async () => {
    await store.run(`INSERT INTO place_geocode (place_text, lat, lng, display_name, geocode_status) VALUES
      ('london', 51.5, -0.1, 'London', 'resolved'), ('york', 53.9, -1.1, 'York', 'resolved'),
      ('missing place', NULL, NULL, NULL, 'not_found'), ('pending place', NULL, NULL, NULL, 'error')`);
    // Multiple provider events for one person must retain a single map entry.
    await store.run("INSERT INTO vital_event (person_id, event_type, place, source) VALUES (@root, 'birth', 'Other', 'ancestry')", { root });
    const map = await request(app()).get(`/api/map/ROOT-152/ROOT-152?depth=2`).expect(200);
    expect(map.body.data.persons).toHaveLength(2);
    expect(map.body.data.persons[0]).toMatchObject({ id: root, birthCoords: { lat: 51.5, lng: -0.1 }, lineage: 'self' });
    expect(map.body.data.ungeocoded).toEqual(expect.arrayContaining(['Other', 'Pending Place']));
    expect(map.body.data.ungeocoded).not.toContain('Missing Place');
    expect(map.body.data.geocodeStats).toEqual({ resolved: 2, pending: 0, notFound: 1, error: 1, total: 4 });
    const reset = await request(app()).post('/api/map/geocode/reset-not-found').expect(200);
    expect(reset.body.data.reset).toBe(1);
  });

  it('upserts and removes provider mappings before resolving the mutation', async () => {
    const augmentation = { id: root, platforms: [], photos: [], descriptions: [], updatedAt: '2026-09-27T00:00:00Z' };
    vi.spyOn(augmentationService, 'getOrCreate').mockResolvedValue(augmentation);
    vi.spyOn(augmentationService, 'getAugmentation').mockResolvedValue(augmentation);
    vi.spyOn(augmentationService, 'updateAugmentation').mockImplementation(async (_id, update) => {
      update(augmentation);
      return augmentation;
    });
    const mapping = { providerId: 'provider-ancestry', platform: 'ancestry', externalId: 'first', confidence: 'high' } as const;
    await addProviderMapping(root, mapping);
    await addProviderMapping(root, { ...mapping, externalId: 'second' });
    expect(await store.queryAll('SELECT account_id FROM provider_mapping WHERE person_id = @root', { root })).toEqual([{ account_id: 'second' }]);
    await removeProviderMapping(root, mapping.providerId);
    expect(await store.queryAll('SELECT account_id FROM provider_mapping WHERE person_id = @root', { root })).toEqual([]);
  });
});
