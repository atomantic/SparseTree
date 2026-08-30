import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const batchGeocode = vi.fn();
const sendEvent = vi.fn();

vi.mock('../../../server/src/services/geocode.service.js', () => ({
  geocodeService: { batchGeocode, getGeocodeStats: vi.fn(), resetNotFound: vi.fn() },
}));
vi.mock('../../../server/src/services/map.service.js', () => ({
  mapService: { getUngeocodedPlaces: vi.fn(() => ['First place', 'Second place']) },
}));
vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: { queryOne: vi.fn(() => ({ db_id: 'db-1' })) },
}));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: { api: vi.fn() } }));
vi.mock('../../../server/src/utils/sseHelpers.js', () => ({ initSSEData: vi.fn(() => sendEvent) }));

const { mapRouter } = await import('../../../server/src/routes/map.routes.js');

describe('map geocode stream cancellation', () => {
  it('aborts the batch when the SSE client disconnects', async () => {
    let receivedSignal: AbortSignal | undefined;
    batchGeocode.mockImplementation(async function* (_places: string[], signal?: AbortSignal) {
      receivedSignal = signal;
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'progress', current: 1, total: 2, place: 'First place', status: 'resolved' };
    });

    const layer = (mapRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }> } }> }).stack
      .find(item => item.route?.path === '/geocode/stream');
    const handler = layer?.route?.stack[0]?.handle;
    expect(handler).toBeDefined();

    const req = Object.assign(new EventEmitter(), { query: { dbId: 'db-1' } });
    const res = { end: vi.fn() };
    const completion = handler!(req, res);
    await vi.waitFor(() => expect(batchGeocode).toHaveBeenCalledTimes(1));

    req.emit('close');
    await completion;

    expect(receivedSignal?.aborted).toBe(true);
    expect(sendEvent).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
