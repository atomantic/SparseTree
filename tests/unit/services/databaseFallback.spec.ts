import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { createJsonDatabase } from '../../../server/src/services/json-database.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';
import { createDatabaseService, databaseService } from '../../../server/src/services/database.service.js';
import { databaseRoutes } from '../../../server/src/routes/database.routes.js';
import { errorHandler } from '../../../server/src/middleware/errorHandler.js';

vi.mock('../../../server/src/services/scraper.service.js', () => ({ scraperService: { hasPhoto: () => false } }));

const graph = {
  'ROOT-001': { name: 'Root Person', gender: 'male', living: false, parents: ['PARENT-001'], children: [], birth: { date: '12 March 1900', dateFormal: '+1900-03-12', place: 'London, England' }, death: { date: '1970' } },
  'PARENT-001': { name: 'Parent Person', gender: 'female', parents: [], children: ['ROOT-001'], birth: { date: '1870' } },
};
const result = (rows: Record<string, unknown>[] = []) => ({ rows, rowCount: rows.length, fields: [], command: 'SELECT', oid: 0 });

describe('core database JSON fallback', () => {
  let directory: string;
  let samples: string;
  let query: ReturnType<typeof vi.fn>;
  let json: ReturnType<typeof createJsonDatabase>;
  let service: ReturnType<typeof createDatabaseService>;
  const unavailable = Object.assign(new Error('connection lost'), { code: 'ECONNREFUSED' });

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-fallback-'));
    samples = path.join(directory, 'samples');
    await mkdir(samples);
    await writeFile(path.join(directory, 'db-ROOT-001.json'), JSON.stringify(graph));
    query = vi.fn().mockRejectedValue(unavailable);
    const pool = {
      query,
      connect: vi.fn(async () => ({ query: vi.fn(async () => result()), release: vi.fn() })),
      end: vi.fn(),
    };
    const store = createPostgresService({ pool });
    json = createJsonDatabase(directory, samples);
    service = createDatabaseService(store, json, createPostgresDatabase(store));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const app = () => {
    for (const key of ['listDatabases', 'getDatabaseInfo', 'getTreeStats', 'getOnThisDay', 'deleteDatabase'] as const) {
      vi.spyOn(databaseService, key).mockImplementation(service[key] as never);
    }
    const instance = express();
    instance.use(express.json());
    instance.use('/api/databases', databaseRoutes);
    instance.use(errorHandler);
    return instance;
  };

  it('serves the production routes when PostgreSQL is down before startup', async () => {
    const server = app();
    const listing = await request(server).get('/api/databases').expect(200);
    expect(listing.body.data[0]).toMatchObject({ id: 'ROOT-001', personCount: 2, isSample: false });
    const info = await request(server).get('/api/databases/ROOT-001').expect(200);
    expect(info.body.data.rootName).toBe('Root Person');
    const anniversaries = await request(server).get('/api/databases/ROOT-001/on-this-day?month=3&day=12').expect(200);
    expect(anniversaries.body.data).toEqual([expect.objectContaining({ personId: 'ROOT-001', eventType: 'birth' })]);
    const stats = await request(server).get('/api/databases/ROOT-001/stats').expect(200);
    expect(stats.body.data).toMatchObject({ totalPersons: 2, gender: { male: 1, female: 1, unknown: 0 } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('serves full and quick person search through the same outage fallback', async () => {
    expect(await service.search('ROOT-001', { q: 'Root', limit: 1 })).toMatchObject({
      total: 1, page: 1, limit: 1, totalPages: 1, results: [{ id: 'ROOT-001' }],
    });
    expect(await service.quickSearch('ROOT-001', 'Root')).toEqual([{
      personId: 'ROOT-001', displayName: 'Root Person', gender: 'male', birthName: null, birthYear: 1900,
    }]);
    expect(await service.quickSearch('ROOT-001', 'R')).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('serves JSON without querying an unconfigured PostgreSQL store', async () => {
    const store = createPostgresService({ pool: {
      query,
      connect: vi.fn(async () => ({ query: vi.fn(async () => result()), release: vi.fn() })),
      end: vi.fn(),
    } });
    vi.spyOn(store, 'isConfigured').mockReturnValue(false);
    const unconfigured = createDatabaseService(store, json, createPostgresDatabase(store));
    expect(await unconfigured.getDatabase('ROOT-001')).toEqual(graph);
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the real connection guard when the PostgreSQL socket is absent', async () => {
    const store = createPostgresService({
      connectionString: `postgresql://test@localhost/postgres?host=${encodeURIComponent(path.join(directory, 'no-socket'))}`,
    });
    service = createDatabaseService(store, json, createPostgresDatabase(store));
    const response = await request(app()).get('/api/databases').expect(200);
    expect(response.body.data[0].id).toBe('ROOT-001');
    await store.closeDb();
  });

  it('uses JSON for an empty store and rechecks after explicit reinitialization', async () => {
    query.mockResolvedValueOnce(result([{ populated: false }]));
    expect(await service.getDatabase('ROOT-001')).toEqual(graph);
    query.mockResolvedValueOnce(result([{ populated: true }]));
    expect(await service.reinitialize()).toBe(true);
  });

  it('replays the whole read after a connection is lost during a request', async () => {
    query.mockResolvedValueOnce(result([{ populated: true }]));
    expect(await service.getDatabase('ROOT-001')).toEqual(graph);
    expect(await service.isPostgresEnabled()).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps remembered canonical root URLs usable after an outage', async () => {
    json.rememberInfo({ id: 'CANONICAL', rootId: 'CANONICAL', rootExternalId: 'ROOT-001', filename: '', personCount: 2 });
    expect(await service.getDatabase('CANONICAL')).toEqual(graph);
  });

  it('does not hide SQL bugs behind JSON fallback', async () => {
    query.mockResolvedValueOnce(result([{ populated: true }]));
    query.mockRejectedValueOnce(Object.assign(new Error('invalid SQL'), { code: '42601' }));
    await expect(service.getDatabase('ROOT-001')).rejects.toThrow('invalid SQL');
  });

  it('preserves JSON when a configured store cannot confirm destructive cleanup', async () => {
    await expect(service.deleteDatabase('ROOT-001')).rejects.toThrow('must be available');
    expect(JSON.parse(await readFile(path.join(directory, 'db-ROOT-001.json'), 'utf8'))).toEqual(graph);
  });

  it('protects bundled samples and limits JSON ancestor traversal through cycles', async () => {
    await writeFile(path.join(samples, 'db-SAMPLE-001.json'), JSON.stringify(graph));
    await expect(json.deleteDatabase('SAMPLE-001')).rejects.toThrow('Cannot delete sample');
    expect(Object.keys(await service.getAncestorsLimited('ROOT-001', 'ROOT-001', 0))).toEqual(['ROOT-001']);
    expect(Object.keys(await service.getAncestorsLimited('ROOT-001', 'ROOT-001', 1))).toEqual(['ROOT-001', 'PARENT-001']);
    expect(await service.personExists('ROOT-001', 'PARENT-001')).toBe(true);
    expect(await service.getPersonsBatch(['PARENT-001', 'MISSING', 'ROOT-001'])).toMatchObject([{ id: 'PARENT-001' }, { id: 'ROOT-001' }]);
  });
});
