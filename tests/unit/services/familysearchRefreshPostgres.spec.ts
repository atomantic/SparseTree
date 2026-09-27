import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), createClient: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn(),
  registerExternalId: vi.fn(), removeExternalId: vi.fn(), syncPeople: vi.fn(), getPerson: vi.fn(),
  transaction: vi.fn(), tx: { run: vi.fn(), queryOne: vi.fn(), queryAll: vi.fn() },
}));
vi.mock('fs', () => ({ default: { writeFileSync: mocks.writeFileSync, unlinkSync: mocks.unlinkSync, existsSync: mocks.existsSync } }));
vi.mock('../../../server/src/lib/familysearch/client.js', () => ({ createFamilySearchClient: mocks.createClient }));
vi.mock('../../../server/src/services/browser.service.js', () => ({ browserService: {
  verifyAndReconnect: async () => true, getFamilySearchToken: async () => ({ token: 'fixture-token' }),
} }));
vi.mock('../../../server/src/services/provider.service.js', () => ({ providerService: { ensureAuthenticated: vi.fn() } }));
vi.mock('../../../server/src/services/id-mapping.service.js', () => ({ idMappingService: {
  resolveId: async () => 'canonical-fixture', getExternalId: async () => 'OLD-153',
  registerExternalId: mocks.registerExternalId, removeExternalId: mocks.removeExternalId,
} }));
vi.mock('../../../server/src/db/postgres.service.js', () => ({ postgresService: { transaction: mocks.transaction } }));
vi.mock('../../../server/src/lib/postgres-person-sync.js', () => ({ syncPeople: mocks.syncPeople }));
vi.mock('../../../server/src/services/database.service.js', () => ({ databaseService: { getPerson: mocks.getPerson } }));
vi.mock('../../../server/src/lib/familysearch/transformer.js', () => ({ json2person: () => ({ name: 'Fixture', living: false, parents: [], children: [] }) }));
vi.mock('../../../server/src/utils/paths.js', () => ({ PROVIDER_CACHE_DIR: '/fixture/provider-cache', PERSON_CACHE_DIR: '/fixture/person', ensureDir: vi.fn() }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: Object.fromEntries(['auth', 'api', 'time', 'timeEnd', 'error', 'data', 'cache', 'sync', 'ok'].map(key => [key, vi.fn()])) }));
import { familySearchRefreshService } from '../../../server/src/services/familysearch-refresh.service.js';

describe('FamilySearch PostgreSQL refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({ get: mocks.get });
    mocks.get.mockResolvedValue({ statusCode: 200, data: { persons: [{ id: 'NEW-153' }] } });
    mocks.transaction.mockImplementation(async work => work(mocks.tx));
    mocks.syncPeople.mockResolvedValue(undefined);
    mocks.getPerson.mockResolvedValue({ id: 'canonical-fixture', name: 'Fixture' });
    mocks.existsSync.mockReturnValue(true);
  });

  it('updates redirected identity and normalized rows on the same transaction after writing raw JSON', async () => {
    const result = await familySearchRefreshService.refreshPerson('database', 'OLD-153');
    expect(mocks.createClient).toHaveBeenCalledWith({ accessToken: 'fixture-token', maxThrottledRetries: 3 });
    expect(mocks.writeFileSync.mock.calls.map(call => call[0])).toEqual([
      '/fixture/provider-cache/familysearch/NEW-153.json', '/fixture/person/NEW-153.json',
    ]);
    expect(mocks.registerExternalId).toHaveBeenCalledWith('canonical-fixture', 'familysearch', 'NEW-153', expect.any(Object), mocks.tx);
    expect(mocks.removeExternalId).toHaveBeenCalledWith('familysearch', 'OLD-153', mocks.tx);
    expect(mocks.syncPeople).toHaveBeenCalledWith(mocks.tx, ['NEW-153'], expect.any(Object), new Map([['NEW-153', 'canonical-fixture']]));
    expect(mocks.tx.run).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), { key: 'sparsetree:json-rebuild' });
    expect(result).toMatchObject({ success: true, wasRedirected: true, newFsId: 'NEW-153' });
    expect(mocks.unlinkSync).toHaveBeenCalledWith('/fixture/provider-cache/familysearch/OLD-153.json');
  });

  it('surfaces a failed database write without returning stale data or removing the old cache', async () => {
    mocks.syncPeople.mockRejectedValue(new Error('fixture transaction failed'));
    await expect(familySearchRefreshService.refreshPerson('database', 'OLD-153')).rejects.toThrow('fixture transaction failed');
    expect(mocks.getPerson).not.toHaveBeenCalled();
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });
});
