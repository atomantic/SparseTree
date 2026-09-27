import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Sqlite from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresService, POSTGRES_SCHEMA_PATH } from '../../../server/src/db/postgres.service.js';
import { createPostgresWriter } from '../../../server/src/lib/postgres-writer.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';
import { createDatabaseService, databaseService } from '../../../server/src/services/database.service.js';
import { createJsonDatabase } from '../../../server/src/services/json-database.js';
import { createPostgresSearch, PERSON_SEARCH_MATCH, personSearchQuery } from '../../../server/src/services/postgres-search.js';
import { searchRoutes } from '../../../server/src/routes/search.routes.js';
import { personRoutes } from '../../../server/src/routes/person.routes.js';
import { errorHandler } from '../../../server/src/middleware/errorHandler.js';
import type { Database } from '@fsf/shared';

vi.mock('../../../server/src/services/legacy-sqlite-database.js', () => ({ legacySqliteDatabase: {
  applyOverrides: vi.fn(), isEnabled: () => false,
} }));
vi.mock('../../../server/src/services/scraper.service.js', () => ({ scraperService: { hasPhoto: () => false } }));

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const graph: Database = {
  ROOT: { name: 'Zoe Smith', gender: 'female', living: false, parents: ['JOHN', 'ANNE'], children: [],
    birthName: 'Zoe Jones', aliases: ['Little Star'], alternateNames: ['Zodiac'], marriedNames: ['Zoe Brown'],
    bio: 'Adventurous engineer', occupations: ['Cartographer'], birth: { date: '1900', place: 'London, England' } },
  JOHN: { name: 'John Smith', gender: 'male', living: false, parents: [], children: ['ROOT'],
    bio: 'John John John Smith', occupations: ['Farmer'], birth: { date: '1870', place: 'York, England' } },
  ANNE: { name: 'Anne-Marie O’Neill', gender: 'female', living: false, parents: [], children: ['ROOT'],
    aliases: ['José Noël'], birth: { date: '1880', place: 'Paris, France' } },
  TWIN: { name: 'John Smith', gender: 'male', living: false, parents: [], children: [] },
  BIO: { name: 'Aaron Example', gender: 'unknown', living: false, parents: [], children: [], bio: 'John Smith explorer' },
};

describePostgres('PostgreSQL person search and production routes', () => {
  const schema = `sparsetree_search_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let service: ReturnType<typeof createDatabaseService>;
  let search: ReturnType<typeof createPostgresSearch>;
  let ids: Map<string, string>;
  let root: string;
  let sqlite: Sqlite.Database;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    store = createPostgresService({ pool: new Pool({ connectionString, options: `-c search_path=${schema}` }) });
    await store.initDb();
  });
  beforeEach(async () => {
    await store.run('TRUNCATE person, database_info CASCADE');
    const rebuilt = await createPostgresWriter(store).rebuildDatabase({ rootExternalId: 'ROOT', database: graph });
    root = rebuilt.rootPersonId;
    ids = rebuilt.personIds;
    const postgres = createPostgresDatabase(store);
    service = createDatabaseService(store, createJsonDatabase(), postgres);
    search = createPostgresSearch(store, postgres);
    sqlite = new Sqlite(':memory:');
    sqlite.exec('CREATE VIRTUAL TABLE person_fts USING fts5(person_id UNINDEXED, display_name, birth_name, aliases, bio, occupations)');
    const insert = sqlite.prepare('INSERT INTO person_fts VALUES (?, ?, ?, ?, ?, ?)');
    for (const [externalId, person] of Object.entries(graph)) {
      insert.run(ids.get(externalId), person.name, person.birthName ?? '',
        [...person.aliases ?? [], ...person.alternateNames ?? [], ...person.marriedNames ?? []].join(' '),
        person.bio ?? '', (person.occupations ?? []).join(' '));
    }
  });
  afterEach(() => { sqlite?.close(); vi.restoreAllMocks(); });
  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  const app = () => {
    vi.spyOn(databaseService, 'search').mockImplementation(service.search);
    vi.spyOn(databaseService, 'quickSearch').mockImplementation(service.quickSearch);
    const server = express();
    server.use('/api/search', searchRoutes);
    server.use('/api/persons', personRoutes);
    server.use(errorHandler);
    return server;
  };
  const externalId = (id: string) => [...ids].find(([, canonical]) => canonical === id)?.[0];
  const externalIds = async (q: string) => (await search.search(root, { q })).results.map(p => externalId(p.id));

  it.each(['Smith', 'SMI', 'John Smi', 'Little Sta', 'Zodiac', 'Brown', 'Anne-Marie', 'O’Neill', 'Jose Noel',
    'Adventurous', 'enginee', 'Cartograph', 'nonexistent', 'mit', 'John OR Zoe'])('matches FTS5 membership and order for %s', async q => {
    const expected = sqlite.prepare(`SELECT person_id FROM person_fts WHERE person_fts MATCH ? ORDER BY display_name, person_id`)
      .all(`"${q.replaceAll('"', '""')}"*`) as { person_id: string }[];
    const result = await search.search('ROOT', { q });
    expect(result.results.map(p => p.id)).toEqual(expected.map(p => p.person_id));
    expect(result.total).toBe(expected.length);
  });

  it('preserves alphabetical order over relevance, stable ties and paging metadata', async () => {
    expect(await externalIds('John')).toEqual(['BIO', ...['JOHN', 'TWIN'].sort((a, b) => ids.get(a)!.localeCompare(ids.get(b)!))]);
    const all = await search.search(root, {});
    expect(all.total).toBe(5);
    expect((await search.search(root, { q: '  ' })).results).toEqual(all.results);
    const page = await search.search(root, { page: 2, limit: 2 });
    expect(page).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
    expect(page.results).toEqual(all.results.slice(2, 4));
    expect((await search.search(root, { page: 4, limit: 2 })).results).toEqual([]);
    const rank = await store.queryAll<{ person_id: string }>(`SELECT person_id FROM person_search
      WHERE person_id = ANY(@ids::text[]) ORDER BY ts_rank(search_document, to_tsquery('simple', @q)) DESC`,
    { ids: [ids.get('JOHN'), ids.get('BIO')], q: personSearchQuery('John') });
    expect(rank[0].person_id).toBe(ids.get('JOHN'));
  });

  it('applies every SQL filter without duplicating people or leaking other databases', async () => {
    expect((await search.search(root, { location: 'ENGLAND', occupation: 'CARTO', birthAfter: '1900', birthBefore: '1900',
      generationMin: 0, generationMax: 0, hasBio: true })).results.map(p => externalId(p.id))).toEqual(['ROOT']);
    expect((await search.search(root, { generationMin: 1, generationMax: 1 })).results.map(p => externalId(p.id))).toEqual(['ANNE', 'JOHN']);
    expect((await search.search(root, { birthAfter: 'invalid', birthBefore: 'invalid' })).total).toBe(5);
    expect((await search.search(root, { hasPhoto: true })).total).toBe(0);
    await store.run(`INSERT INTO media(media_id, person_id, source) VALUES ('photo', @id, 'local')`, { id: root });
    expect((await search.search(root, { hasPhoto: true })).results.map(p => externalId(p.id))).toEqual(['ROOT']);
    await store.run(`INSERT INTO person(person_id, display_name) VALUES ('outsider', 'John Smith')`);
    expect((await search.search(root, { q: 'Smith' })).total).toBe(4);
    expect(await search.search('missing', { q: 'Smith' })).toMatchObject({ results: [], total: 0 });
  });

  it('indexes person and claim inserts, updates, moves, predicate changes and deletions', async () => {
    await store.run(`UPDATE person SET display_name = 'Renamed Person', birth_name = 'Maiden Name', bio = 'New biography'
      WHERE person_id = @id`, { id: root });
    expect(await externalIds('Zoe Smith')).toEqual([]);
    for (const q of ['Renamed', 'Maiden', 'biography']) expect(await externalIds(q)).toEqual(['ROOT']);
    await store.run(`INSERT INTO claim(claim_id, person_id, predicate, value_text, source)
      VALUES ('local-alias', @id, 'alias', 'Stargazer', 'local')`, { id: root });
    expect(await externalIds('Stargaz')).toEqual(['ROOT']);
    await store.run(`UPDATE claim SET person_id = @id, value_text = 'Astronomer', predicate = 'occupation' WHERE claim_id = 'local-alias'`, { id: ids.get('JOHN') });
    expect(await externalIds('Stargaz')).toEqual([]);
    expect(await externalIds('Astronomer')).toEqual(['JOHN']);
    await store.run(`UPDATE claim SET predicate = 'religion' WHERE claim_id = 'local-alias'`);
    expect(await externalIds('Astronomer')).toEqual([]);
    await store.run(`DELETE FROM claim WHERE person_id = @id AND predicate = 'occupation'`, { id: root });
    expect(await externalIds('Cartograph')).toEqual([]);
    await store.run(`DELETE FROM person WHERE person_id = @id`, { id: ids.get('ANNE') });
    expect(await externalIds('Jose')).toEqual([]);
  });

  it('keeps all-source claim search through provider resync and transaction rollback', async () => {
    await store.run(`INSERT INTO claim(claim_id, person_id, predicate, value_text, source)
      VALUES ('local', @id, 'alias', 'Local Alias', 'local')`, { id: root });
    await createPostgresWriter(store).rebuildDatabase({ rootExternalId: 'ROOT', database: graph });
    expect(await externalIds('Local Alias')).toEqual(['ROOT']);
    await expect(store.transaction(async tx => {
      await tx.run(`UPDATE person SET display_name = 'Rolledback' WHERE person_id = @id`, { id: root });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await externalIds('Rolledback')).toEqual([]);
    expect(await externalIds('Zoe')).toEqual(['ROOT']);
  });

  it('serializes concurrent claim edits without losing either search term', async () => {
    await Promise.all(['ConcurrentAlpha', 'ConcurrentBeta'].map((value, index) => store.transaction(async tx => {
      await tx.run(`INSERT INTO claim(claim_id, person_id, predicate, value_text, source)
        VALUES (@value, @id, 'alias', @value, 'local')`, { id: root, value });
      if (index === 0) await tx.run('SELECT pg_sleep(0.03)');
    })));
    expect(await externalIds('ConcurrentAlpha')).toEqual(['ROOT']);
    expect(await externalIds('ConcurrentBeta')).toEqual(['ROOT']);
  });

  it('treats operators and punctuation as data and prevents cross-field phrases', async () => {
    for (const q of ['"; DROP TABLE person; --', '!* & | ()', "' OR 1=1 --", 'Smith Zoe']) {
      expect(await externalIds(q)).toEqual([]);
    }
    expect(await store.queryOne('SELECT COUNT(*)::int AS count FROM person')).toEqual({ count: 5 });
  });

  it('serves real full and quick-search routes with stable response shapes', async () => {
    const server = app();
    const response = await request(server).get('/api/search/ROOT').query({ q: 'Smi', page: 2, limit: 2 }).expect(200);
    expect(response.body.data).toMatchObject({ total: 4, page: 2, limit: 2, totalPages: 2 });
    const quick = await request(server).get('/api/persons/ROOT/quick-search').query({ q: 'Jose Noel' }).expect(200);
    expect(quick.body.data).toEqual([{ personId: ids.get('ANNE'), displayName: 'Anne-Marie O’Neill', gender: 'female', birthName: null, birthYear: 1880 }]);
    expect((await request(server).get('/api/persons/ROOT/quick-search?q=J').expect(200)).body.data).toEqual([]);
    expect((await request(server).get('/api/persons/missing/quick-search?q=Smith').expect(200)).body.data).toEqual([]);
  });

  it('caps quick results at 20 in stable name and ID order', async () => {
    await store.run(`INSERT INTO person(person_id, display_name)
      SELECT 'quick-' || n, 'Quick Person' FROM generate_series(1, 25) AS n`);
    await store.run(`INSERT INTO database_membership(db_id, person_id, generation)
      SELECT @root, person_id, 1 FROM person WHERE person_id LIKE 'quick-%'`, { root });
    const results = await search.quickSearch(root, 'Quick');
    expect(results).toHaveLength(20);
    const expected = Array.from({ length: 25 }, (_, i) => `quick-${i + 1}`).sort().slice(0, 20);
    expect(results.map(row => row.personId)).toEqual(expected);
  });

  it('upgrades and backfills staged stores without the SQLite migration, idempotently', async () => {
    await store.run(`DELETE FROM migration WHERE name = 'postgres_002_person_search'; DELETE FROM person_search`);
    const schemaSql = await readFile(POSTGRES_SCHEMA_PATH, 'utf8');
    await store.transaction(tx => tx.run(schemaSql));
    await store.transaction(tx => tx.run(schemaSql));
    expect(await externalIds('Little Star')).toEqual(['ROOT']);
    expect(await store.tableExists('person_fts', schema)).toBe(false);
    expect(await store.migrationApplied('003_rebuild_fts')).toBe(false);
  });

  it('uses the GIN document index for selective prefixes on representative data', async () => {
    await store.run(`INSERT INTO person(person_id, display_name)
      SELECT 'fixture-' || n, 'Common Person ' || n FROM generate_series(1, 12000) AS n`);
    await store.run('ANALYZE person_search');
    const plans = await store.queryAll(`EXPLAIN (FORMAT JSON) SELECT p.person_id FROM person p WHERE ${PERSON_SEARCH_MATCH}`,
      { query: personSearchQuery('Cartograph') });
    expect(JSON.stringify(plans)).toContain('idx_person_search_document');
  });
});
