import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(), queryAll: vi.fn(), run: vi.fn(), transaction: vi.fn(), transactionRun: vi.fn(), transactionQueryOne: vi.fn(),
  resolveDbId: vi.fn(), isPostgresEnabled: vi.fn(), getDatabase: vi.fn(),
  getFavoritesInDatabase: vi.fn(), getActiveProvider: vi.fn(), createRun: vi.fn(), executeApiRun: vi.fn(),
}));

vi.mock('../../../server/src/db/postgres.service.js', () => ({ postgresService: {
  queryOne: mocks.queryOne, queryAll: mocks.queryAll, run: mocks.run, transaction: mocks.transaction,
} }));
vi.mock('../../../server/src/services/database.service.js', () => ({ databaseService: {
  resolveDbId: mocks.resolveDbId, isPostgresEnabled: mocks.isPostgresEnabled, getDatabase: mocks.getDatabase,
} }));
vi.mock('../../../server/src/services/favorites.service.js', () => ({
  favoritesService: { getFavoritesInDatabase: mocks.getFavoritesInDatabase }, PRESET_TAGS: ['historical'],
}));
vi.mock('../../../server/src/services/id-mapping.service.js', () => ({ idMappingService: {
  getExternalId: vi.fn(),
} }));
vi.mock('../../../server/src/services/legacy-sqlite-database.js', () => {
  throw new Error('Discovery must not load the legacy database');
});
vi.mock('../../../server/src/db/sqlite.service.js', () => {
  throw new Error('Discovery must not load SQLite');
});
vi.mock('../../../server/src/services/ai-toolkit.service.js', () => ({ getAIToolkit: () => ({ services: {
  providers: { getActiveProvider: mocks.getActiveProvider },
  runner: { createRun: mocks.createRun, executeApiRun: mocks.executeApiRun },
} }) }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: {
  start: vi.fn(), done: vi.fn(), error: vi.fn(), warn: vi.fn(), data: vi.fn(),
  skip: vi.fn(), api: vi.fn(), ok: vi.fn(),
} }));

import { aiDiscoveryService } from '../../../server/src/services/ai-discovery.service.js';
import { createAiDiscoveryRouter } from '../../../server/src/routes/ai-discovery.routes.js';

describe('PostgreSQL discovery persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveDbId.mockResolvedValue('db-canonical');
    mocks.isPostgresEnabled.mockResolvedValue(true);
    mocks.queryAll.mockResolvedValue([]);
    mocks.queryOne.mockImplementation(async (sql: string, params?: { personId: string }) =>
      sql.includes('SELECT person_id') ? { person_id: params?.personId === 'FS-PERSON' ? 'person-canonical' : params?.personId } : { count: 0 }
    );
    mocks.run.mockResolvedValue({ rowCount: 0 });
    mocks.transactionRun.mockResolvedValue({ rowCount: 1 });
    mocks.transactionQueryOne.mockImplementation((...args) => mocks.queryOne(...args));
    mocks.transaction.mockImplementation(async (work: (tx: { run: typeof mocks.transactionRun; queryOne: typeof mocks.transactionQueryOne }) => Promise<void>) =>
      work({ run: mocks.transactionRun, queryOne: mocks.transactionQueryOne })
    );
    mocks.getFavoritesInDatabase.mockResolvedValue([]);
    mocks.getDatabase.mockResolvedValue({});
  });

  it('upserts canonical identifiers and JSONB tags for concurrent dismissals', async () => {
    await Promise.all([
      aiDiscoveryService.dismissCandidate('db-alias', 'FS-PERSON', '', []),
      aiDiscoveryService.dismissCandidate('db-alias', 'FS-PERSON', 'Duplicate research', ['reviewed']),
    ]);

    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run).toHaveBeenNthCalledWith(1,
      expect.stringContaining('ON CONFLICT (db_id, person_id) DO UPDATE'),
      { dbId: 'db-canonical', personId: 'person-canonical', aiReason: null, aiTags: '[]' },
    );
    expect(mocks.run).toHaveBeenNthCalledWith(2,
      expect.stringContaining('@aiTags::jsonb'),
      { dbId: 'db-canonical', personId: 'person-canonical', aiReason: 'Duplicate research', aiTags: '["reviewed"]' },
    );
  });

  it('preserves omitted metadata as null and rejects unresolved persons before writing', async () => {
    await expect(aiDiscoveryService.dismissCandidate('db-alias', 'FS-PERSON')).resolves.toEqual({ success: true });
    expect(mocks.run).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ aiReason: null, aiTags: null }));
    mocks.run.mockClear();
    mocks.queryOne.mockResolvedValue(undefined);
    await expect(aiDiscoveryService.dismissCandidate('db-alias', 'missing')).rejects.toThrow('Person missing not found');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('awaits every batch write inside one transaction and counts repeated candidates', async () => {
    const candidates = [{ personId: 'FS-PERSON' }, { personId: 'FS-PERSON', suggestedTags: [] }];
    await expect(aiDiscoveryService.dismissCandidatesBatch('db-alias', candidates)).resolves.toEqual({ dismissed: 2 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transactionRun).toHaveBeenCalledTimes(2);
    expect(mocks.transactionQueryOne).toHaveBeenCalledTimes(2);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.resolveDbId).toHaveBeenCalledOnce();
  });

  it('propagates a batch write failure through the transaction without returning a partial count', async () => {
    mocks.transactionRun.mockResolvedValueOnce({ rowCount: 1 }).mockRejectedValueOnce(new Error('write rejected'));
    await expect(aiDiscoveryService.dismissCandidatesBatch('db-alias', [
      { personId: 'person-one' }, { personId: 'person-two' }, { personId: 'person-three' },
    ])).rejects.toThrow('write rejected');
    expect(mocks.transactionRun).toHaveBeenCalledTimes(2);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('maps native JSONB arrays and timestamp values without changing null and empty fields', async () => {
    mocks.queryAll.mockResolvedValue([
      { person_id: 'person-one', ai_reason: '', ai_tags: ['artist', 1, null], dismissed_at: new Date('2026-09-27T12:00:00Z') },
      { person_id: 'person-two', ai_reason: null, ai_tags: null, dismissed_at: '2026-09-27T11:00:00Z' },
    ]);
    await expect(aiDiscoveryService.getDismissedCandidates('db-alias')).resolves.toEqual([
      { personId: 'person-one', aiReason: '', aiTags: ['artist'], dismissedAt: '2026-09-27T12:00:00.000Z' },
      { personId: 'person-two', aiReason: null, aiTags: [], dismissedAt: '2026-09-27T11:00:00Z' },
    ]);
    expect(mocks.queryAll).toHaveBeenCalledWith(expect.stringContaining('FROM discovery_dismissed'), { dbId: 'db-canonical' });
  });

  it('returns the committed delete count and keeps undo idempotent', async () => {
    mocks.run.mockResolvedValue({ rowCount: 2 });
    await expect(aiDiscoveryService.clearDismissed('db-alias')).resolves.toEqual({ cleared: 2 });
    expect(mocks.queryOne).not.toHaveBeenCalled();
    mocks.run.mockResolvedValue({ rowCount: 0 });
    await expect(aiDiscoveryService.undoDismiss('db-alias', 'FS-PERSON')).resolves.toEqual({ success: true });
    expect(mocks.run).toHaveBeenLastCalledWith(expect.stringContaining('person_id = @personId'), {
      dbId: 'db-canonical', personId: 'person-canonical',
    });
  });

  it('returns empty results for a missing database without querying PostgreSQL', async () => {
    mocks.resolveDbId.mockResolvedValue(null);
    await expect(aiDiscoveryService.getDismissedCandidates('missing')).resolves.toEqual([]);
    await expect(aiDiscoveryService.getDismissedCount('missing')).resolves.toBe(0);
    await expect(aiDiscoveryService.clearDismissed('missing')).resolves.toEqual({ cleared: 0 });
    await expect(aiDiscoveryService.dismissCandidatesBatch('missing', [])).resolves.toEqual({ dismissed: 0 });
    expect(mocks.queryAll).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('uses canonical membership scope and PostgreSQL-compatible ranking for quick discovery', async () => {
    mocks.getFavoritesInDatabase.mockResolvedValue([{ personId: 'favorite' }]);
    mocks.queryAll.mockImplementation(async (sql: string) => sql.includes('discovery_dismissed') ? [
      { person_id: 'dismissed', ai_reason: null, ai_tags: [], dismissed_at: new Date() },
    ] : [{ person_id: 'favorite' }, { person_id: 'dismissed' }, { person_id: 'selected' }]);
    mocks.getDatabase.mockResolvedValue({ selected: { name: 'Selected ancestor', lifespan: '1900-1980' } });
    mocks.getActiveProvider.mockResolvedValue({ id: 'test-provider', name: 'Test provider', enabled: true });
    mocks.createRun.mockResolvedValue({ runId: 'provider-run', provider: { type: 'api', defaultModel: 'test-model' } });
    mocks.executeApiRun.mockImplementation(async (_id, _provider, _model, _prompt, _cwd, _screenshots, onData, onComplete) => {
      onData('[]');
      onComplete({ success: true });
    });

    const result = await aiDiscoveryService.quickDiscovery('db-alias', { sampleSize: 2, minBirthYear: 1800, maxGenerations: 3 });

    expect(result.totalAnalyzed).toBe(1);
    expect(mocks.queryAll).toHaveBeenCalledWith(expect.stringContaining('FROM database_membership'), {
      dbId: 'db-canonical', limit: 4, minBirthYear: 1800, maxGenerations: 3,
    });
    const rankingSql = mocks.queryAll.mock.calls.find(([sql]) => sql.includes('FROM database_membership'))?.[0];
    expect(rankingSql).toContain('CASE WHEN EXISTS');
    expect(rankingSql).not.toContain('SELECT DISTINCT');
    expect(mocks.createRun.mock.calls[0][0].prompt).toContain('Selected ancestor');
  });

  it('keeps the JSON discovery fallback usable when PostgreSQL is unavailable', async () => {
    mocks.isPostgresEnabled.mockResolvedValue(false);
    await expect(aiDiscoveryService.quickDiscovery('db-alias')).resolves.toMatchObject({ candidates: [], totalAnalyzed: 0 });
    expect(mocks.getDatabase).toHaveBeenCalledWith('db-alias');
    expect(mocks.queryAll).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it('awaits the asynchronous persistence results in HTTP responses', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai-discovery', createAiDiscoveryRouter());
    mocks.queryAll.mockResolvedValue([
      { person_id: 'person-canonical', ai_reason: null, ai_tags: [], dismissed_at: new Date('2026-09-27T12:00:00Z') },
    ]);
    mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT person_id') ? { person_id: 'person-canonical' } : { count: 1 });
    mocks.run.mockResolvedValue({ rowCount: 1 });

    expect((await request(app).post('/api/ai-discovery/db-alias/dismiss').send({ personId: 'FS-PERSON' }).expect(200)).body)
      .toEqual({ success: true, data: { success: true } });
    expect((await request(app).post('/api/ai-discovery/db-alias/dismiss-batch').send({ candidates: [{ personId: 'FS-PERSON' }] }).expect(200)).body)
      .toEqual({ success: true, data: { dismissed: 1 } });
    expect((await request(app).get('/api/ai-discovery/db-alias/dismissed').expect(200)).body.data)
      .toEqual({ count: 1, dismissed: [{ personId: 'person-canonical', aiReason: null, aiTags: [], dismissedAt: '2026-09-27T12:00:00.000Z' }] });
    expect((await request(app).delete('/api/ai-discovery/db-alias/dismissed/FS-PERSON').expect(200)).body)
      .toEqual({ success: true, data: { success: true } });
    expect((await request(app).delete('/api/ai-discovery/db-alias/dismissed').expect(200)).body)
      .toEqual({ success: true, data: { cleared: 1 } });
  });
});
