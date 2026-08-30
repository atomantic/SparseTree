import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runner = {
  createRun: vi.fn(),
  executeApiRun: vi.fn(),
  executeCliRun: vi.fn(),
  stopRun: vi.fn(),
};

vi.mock('../../../server/src/services/database.service.js', () => ({
  databaseService: { getDatabase: vi.fn() },
}));
vi.mock('../../../server/src/services/favorites.service.js', () => ({
  favoritesService: { getFavoritesInDatabase: vi.fn() },
  PRESET_TAGS: ['historical'],
}));
vi.mock('../../../server/src/services/id-mapping.service.js', () => ({
  idMappingService: { getExternalId: vi.fn() },
}));
vi.mock('../../../server/src/db/sqlite.service.js', () => ({ sqliteService: {} }));
vi.mock('../../../server/src/services/ai-toolkit.service.js', () => ({
  getAIToolkit: () => ({
    services: {
      providers: {
        getActiveProvider: vi.fn().mockResolvedValue({
          id: 'test-provider',
          name: 'Test provider',
          type: 'api',
          enabled: true,
          defaultModel: 'test-model',
        }),
      },
      runner,
    },
  }),
}));
vi.mock('../../../server/src/lib/logger.js', () => ({
  logger: { start: vi.fn(), done: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { databaseService } from '../../../server/src/services/database.service.js';
import { favoritesService } from '../../../server/src/services/favorites.service.js';
import {
  aiDiscoveryService,
  DiscoveryInputError,
  DiscoveryRunConflictError,
  FULL_DISCOVERY_LIMITS,
  normalizeFullDiscoveryOptions,
} from '../../../server/src/services/ai-discovery.service.js';
import { aiDiscoveryRouter } from '../../../server/src/routes/ai-discovery.routes.js';

const db = {
  'PERSON-001': { name: 'Ada Example', lifespan: '1800-1870' },
  'PERSON-002': { name: 'Bea Example', lifespan: '1820-1890' },
  'PERSON-003': { name: 'Cy Example', lifespan: '1840-1910' },
};

const completedProviderRun = () => {
  runner.executeApiRun.mockImplementation((_runId, _provider, _model, _prompt, _workspace, _screenshots, onData, onComplete) => {
    onData({ text: '[]' });
    onComplete({ success: true });
    return Promise.resolve('provider-run');
  });
};

describe('full AI discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runner.createRun.mockReset().mockResolvedValue({
      runId: `provider-run-${Date.now()}`,
      provider: { type: 'api', defaultModel: 'test-model' },
      timeout: 300000,
    });
    runner.executeCliRun.mockReset();
    runner.stopRun.mockReset().mockResolvedValue(true);
    completedProviderRun();
    vi.mocked(databaseService.getDatabase).mockResolvedValue(db as never);
    vi.mocked(favoritesService.getFavoritesInDatabase).mockResolvedValue([]);
  });

  afterEach(async () => {
    for (const dbId of ['batch-test', 'invalid-test', 'failure-test', 'cancel-test']) {
      aiDiscoveryService.cancelDiscovery(dbId);
    }
  });

  it('uses safe defaults and rejects non-positive, fractional, non-numeric, and over-limit inputs', () => {
    expect(normalizeFullDiscoveryOptions()).toEqual({
      batchSize: FULL_DISCOVERY_LIMITS.defaultBatchSize,
      maxPersons: FULL_DISCOVERY_LIMITS.defaultMaxPersons,
    });

    for (const options of [
      { batchSize: 0 },
      { batchSize: -1 },
      { batchSize: 1.5 },
      { batchSize: '50' as unknown as number },
      { batchSize: FULL_DISCOVERY_LIMITS.maxBatchSize + 1 },
      { maxPersons: 0 },
      { maxPersons: -1 },
      { maxPersons: 1.5 },
      { maxPersons: '500' as unknown as number },
      { maxPersons: FULL_DISCOVERY_LIMITS.maxPersons + 1 },
    ]) {
      expect(() => normalizeFullDiscoveryOptions(options)).toThrow(DiscoveryInputError);
    }
  });

  it('does not create a provider run when programmatic callers pass invalid options', async () => {
    await expect(aiDiscoveryService.startDiscovery('invalid-test', { batchSize: 0 })).rejects.toThrow(DiscoveryInputError);
    expect(runner.createRun).not.toHaveBeenCalled();
    expect(runner.executeApiRun).not.toHaveBeenCalled();
  });

  it('executes the expected number of bounded batches with a fake provider', async () => {
    const { runId } = await aiDiscoveryService.startDiscovery('batch-test', { batchSize: 2, maxPersons: 3 });

    await vi.waitFor(() => expect(aiDiscoveryService.getProgress(runId)?.status).toBe('completed'));

    expect(runner.executeApiRun).toHaveBeenCalledTimes(2);
    expect(aiDiscoveryService.getProgress(runId)).toMatchObject({
      totalPersons: 3,
      totalBatches: 2,
      analyzedPersons: 3,
    });
    expect(aiDiscoveryService.getActiveDiscoveryRunId('batch-test')).toBeNull();
  });

  it('rejects a duplicate start for the same database and releases the guard after provider failure', async () => {
    runner.executeApiRun.mockImplementation((_runId, _provider, _model, _prompt, _workspace, _screenshots, _onData, onComplete) => {
      onComplete({ success: false, error: 'provider unavailable' });
      return Promise.resolve('provider-run');
    });

    const { runId } = await aiDiscoveryService.startDiscovery('failure-test', { batchSize: 1, maxPersons: 1 });
    await expect(aiDiscoveryService.startDiscovery('failure-test')).rejects.toThrow(DiscoveryRunConflictError);
    await vi.waitFor(() => expect(aiDiscoveryService.getProgress(runId)?.status).toBe('failed'));
    await vi.waitFor(() => expect(aiDiscoveryService.getActiveDiscoveryRunId('failure-test')).toBeNull());
  });

  it('cancels the in-flight provider run and releases the database guard', async () => {
    runner.executeApiRun.mockImplementation(() => Promise.resolve('provider-run'));

    const { runId } = await aiDiscoveryService.startDiscovery('cancel-test', { batchSize: 1, maxPersons: 1 });
    await vi.waitFor(() => expect(runner.executeApiRun).toHaveBeenCalled());
    expect(aiDiscoveryService.cancelDiscovery('cancel-test')).toEqual({ runId });

    await vi.waitFor(() => expect(runner.stopRun).toHaveBeenCalled());
    await vi.waitFor(() => expect(aiDiscoveryService.getProgress(runId)?.status).toBe('cancelled'));
    await vi.waitFor(() => expect(aiDiscoveryService.getActiveDiscoveryRunId('cancel-test')).toBeNull());
  });
});

describe('full AI discovery route', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-discovery', aiDiscoveryRouter);

  afterEach(() => vi.restoreAllMocks());

  it.each([
    [{ batchSize: 0 }],
    [{ batchSize: -1 }],
    [{ batchSize: 1.5 }],
    [{ batchSize: '50' }],
    [{ maxPersons: 0 }],
    [{ maxPersons: FULL_DISCOVERY_LIMITS.maxPersons + 1 }],
  ])('returns 400 without starting a run for invalid options: %j', async (body) => {
    const start = vi.spyOn(aiDiscoveryService, 'startDiscovery');

    const response = await request(app).post('/api/ai-discovery/route-test/start').send(body).expect(400);

    expect(response.body.success).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('returns the active run id when a concurrent start conflicts', async () => {
    vi.spyOn(aiDiscoveryService, 'startDiscovery').mockRejectedValue(new DiscoveryRunConflictError('discovery-route-test'));

    const response = await request(app).post('/api/ai-discovery/route-test/start').send({}).expect(409);

    expect(response.body).toMatchObject({ success: false, data: { runId: 'discovery-route-test' } });
  });

  it('requests cancellation through the database-scoped route', async () => {
    vi.spyOn(aiDiscoveryService, 'cancelDiscovery').mockReturnValue({ runId: 'discovery-route-test' });

    const response = await request(app).post('/api/ai-discovery/route-test/cancel').expect(200);

    expect(response.body).toMatchObject({ success: true, data: { runId: 'discovery-route-test' } });
  });
});
