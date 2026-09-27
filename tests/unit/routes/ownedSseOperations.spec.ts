import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const makeService = () => ({ isRunning: vi.fn(() => false), getActiveOperationId: vi.fn(() => 'operation-1'), requestCancel: vi.fn(), run: vi.fn() });
  return { update: makeService(), hints: makeService(), bulk: makeService(), scrape: vi.fn() };
});
vi.mock('../../../server/src/services/ancestry-update.service.js', () => ({ ancestryUpdateService: { ...mocks.update, runAncestryUpdate: mocks.update.run } }));
vi.mock('../../../server/src/services/ancestry-hints.service.js', () => ({ ancestryHintsService: { ...mocks.hints, processPersonHintsWithProgress: mocks.hints.run } }));
vi.mock('../../../server/src/services/bulk-discovery.service.js', () => ({ bulkDiscoveryService: { ...mocks.bulk, discoverAllMissingLinks: mocks.bulk.run } }));
vi.mock('../../../server/src/services/scraper.service', () => ({ scraperService: { scrapePerson: mocks.scrape } }));
vi.mock('../../../server/src/services/id-mapping.service.js', () => ({ idMappingService: { resolveId: vi.fn() } }));
vi.mock('../../../server/src/services/browser.service', () => ({ browserService: {} }));
vi.mock('../../../server/src/services/integrity.service.js', () => ({ integrityService: {} }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: { start: vi.fn(), warn: vi.fn() } }));

const { ancestryUpdateRouter } = await import('../../../server/src/routes/ancestry-update.routes.js');
const { ancestryHintsRouter } = await import('../../../server/src/routes/ancestry-hints.routes.js');
const { integrityRouter } = await import('../../../server/src/routes/integrity.routes.js');
const { browserRouter } = await import('../../../server/src/routes/browser.routes.js');

type RouterStack = { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown }> } }> };
function invoke(router: unknown, path: string) {
  const req = Object.assign(new EventEmitter(), { params: { dbId: 'db-1', personId: 'KWCJ-QVS' }, query: { rootPersonId: 'root', provider: 'familysearch' } });
  const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), setTimeout: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), destroyed: false, writableEnded: false,
    end: vi.fn(() => { res.writableEnded = true; res.emit('close'); }),
  });
  const handler = (router as RouterStack).stack.find(item => item.route?.path === path)!.route!.stack[0].handle;
  const next = vi.fn();
  const pending = Promise.resolve(handler(req, res, next));
  return { req, res, next, pending };
}

beforeEach(() => vi.clearAllMocks());
describe('owning SSE route cancellation', () => {
  it.each([
    ['ancestry update', ancestryUpdateRouter, '/:dbId/events', mocks.update],
    ['ancestry hints', ancestryHintsRouter, '/:dbId/:personId/events', mocks.hints],
    ['bulk discovery', integrityRouter, '/:dbId/discover-all/events', mocks.bulk],
  ])('cancels %s exactly once and closes its iterator', async (_name, router, path, service) => {
    let signal: AbortSignal | undefined;
    const cleanup = vi.fn();
    service.run.mockImplementation(async function* (...args: unknown[]) {
      signal = args.at(-1) as AbortSignal;
      try {
        yield { type: 'started', operationId: 'operation-1' };
        await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
        yield { type: 'completed' };
      } finally { cleanup(); }
    });
    const { req, res, next, pending } = invoke(router, path as string);
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledTimes(1));
    res.destroyed = true;
    req.emit('close');
    res.emit('close');
    await pending;
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(service.requestCancel).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(req.listenerCount('close')).toBe(0);
  });

  it('passes an aborted signal to the browser scraper without writing terminal events', async () => {
    let signal: AbortSignal | undefined;
    mocks.scrape.mockImplementation(async (_id, _progress, receivedSignal) => {
      signal = receivedSignal;
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      throw signal!.reason;
    });
    const { req, res, pending } = invoke(browserRouter, '/scrape/:personId');
    await vi.waitFor(() => expect(mocks.scrape).toHaveBeenCalledTimes(1));
    res.destroyed = true;
    req.emit('close');
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('delivers one terminal event and does not cancel normal completion', async () => {
    mocks.update.run.mockImplementation(async function* () { yield { type: 'completed' }; });
    const { req, res, pending } = invoke(ancestryUpdateRouter, '/:dbId/events');
    await pending;
    req.emit('close');
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('completed'));
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(mocks.update.requestCancel).not.toHaveBeenCalled();
  });

  it('delivers a single browser scrape terminal event', async () => {
    mocks.scrape.mockImplementation(async (_id, progress) => {
      const data = { id: 'KWCJ-QVS' };
      progress({ phase: 'complete', data });
      return data;
    });
    const { res, pending } = invoke(browserRouter, '/scrape/:personId');
    await pending;
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: complete'));
  });

  it('keeps a real HTTP stream alive after its incoming GET completes', async () => {
    mocks.update.run.mockImplementation(async function* () {
      yield { type: 'started' };
      await new Promise(resolve => setTimeout(resolve, 10));
      yield { type: 'completed' };
    });
    const app = express();
    app.use('/update', ancestryUpdateRouter);
    const response = await request(app).get('/update/db/events?rootPersonId=root');
    expect(response.text).toContain('started');
    expect(response.text).toContain('completed');
    expect(mocks.update.requestCancel).not.toHaveBeenCalled();
  });

  it('does not cancel a separately running bulk background operation', async () => {
    mocks.bulk.isRunning.mockReturnValueOnce(true);
    const { req, res, pending } = invoke(integrityRouter, '/:dbId/discover-all/events');
    await pending;
    req.emit('close');
    expect(mocks.bulk.run).not.toHaveBeenCalled();
    expect(mocks.bulk.requestCancel).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
