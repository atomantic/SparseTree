import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  verify: vi.fn(async () => true), auth: vi.fn(async () => ({ authenticated: true })),
  gaps: vi.fn(() => [{ childId: 'child-1', childName: 'Child 1' }, { childId: 'child-2', childName: 'Child 2' }]),
  discover: vi.fn(async () => ({ discovered: [], skipped: [] })),
}));
vi.mock('../../../server/src/services/browser.service.js', () => ({ browserService: { verifyAndReconnect: mocks.verify } }));
vi.mock('../../../server/src/services/provider.service.js', () => ({ providerService: { ensureAuthenticated: mocks.auth } }));
vi.mock('../../../server/src/services/augmentation.service.js', () => ({ augmentationService: { getAugmentation: () => ({ platforms: [{ platform: 'ancestry', url: 'url' }] }) } }));
vi.mock('../../../server/src/services/platform-linking.service.js', () => ({ parseAncestryUrl: () => ({ treeId: 'tree', ancestryPersonId: 'person' }) }));
vi.mock('../../../server/src/services/integrity.service.js', () => ({ integrityService: { getParentLinkageGaps: mocks.gaps } }));
vi.mock('../../../server/src/services/parent-discovery.service.js', () => ({ parentDiscoveryService: { discoverParentIds: mocks.discover } }));
vi.mock('../../../server/src/services/multi-platform-comparison.service.js', () => ({ multiPlatformComparisonService: {} }));
vi.mock('../../../server/src/services/id-mapping.service.js', () => ({ idMappingService: {} }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: { start: vi.fn(), warn: vi.fn(), data: vi.fn(), done: vi.fn() } }));
const { ancestryUpdateService: update } = await import('../../../server/src/services/ancestry-update.service.js');
const { ancestryHintsService: hints } = await import('../../../server/src/services/ancestry-hints.service.js');
const { bulkDiscoveryService: bulk } = await import('../../../server/src/services/bulk-discovery.service.js');
const cases = [
  ['update', update, (signal?: AbortSignal) => update.runAncestryUpdate('db', 'person', 4, false, signal)],
  ['hints', hints, (signal?: AbortSignal) => hints.processPersonHintsWithProgress('person', signal)],
  ['bulk', bulk, (signal?: AbortSignal) => bulk.discoverAllMissingLinks('db', 'familysearch', signal)],
] as const;
beforeEach(() => { vi.clearAllMocks(); });

describe('operation tracker lifecycle', () => {
  it.each(cases)('releases %s on early iterator return and allows a new run', async (_name, service, start) => {
    const first = start();
    expect((await first.next()).value?.type).toBe('started');
    expect(service.isRunning()).toBe(true);
    service.requestCancel();
    await first.return(undefined as never);
    expect(service.isRunning()).toBe(false);
    const retry = start();
    expect((await retry.next()).value?.type).toBe('started');
    await retry.return(undefined as never);
    expect(service.isRunning()).toBe(false);
  });

  it.each(cases)('releases %s after an abort without a second terminal event', async (_name, service, start) => {
    const controller = new AbortController();
    const run = start(controller.signal);
    await run.next();
    controller.abort();
    await expect(run.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.isRunning()).toBe(false);
    expect((await run.next()).done).toBe(true);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it.each(cases)('releases %s after a thrown preflight failure', async (name, service, start) => {
    const preflight = name === 'bulk' ? mocks.auth : mocks.verify;
    preflight.mockRejectedValueOnce(new Error('preflight failed'));
    const run = start();
    await run.next();
    await expect(run.next()).rejects.toThrow('preflight failed');
    expect(service.isRunning()).toBe(false);
  });

  it('aborts a bulk rate-limit sleep before another provider request', async () => {
    const controller = new AbortController();
    const run = bulk.discoverAllMissingLinks('db', 'familysearch', controller.signal);
    await run.next(); // started
    await run.next(); // first child progress
    const pending = run.next(); // discovery followed by interruptible delay
    await vi.waitFor(() => expect(mocks.discover).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    expect(bulk.isRunning()).toBe(false);
  });
});
