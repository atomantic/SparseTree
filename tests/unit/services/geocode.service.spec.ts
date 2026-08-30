import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryOne = vi.fn();
const run = vi.fn(() => ({ changes: 1 }));

vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: { queryOne, queryAll: vi.fn(() => []), run },
}));

vi.mock('../../../server/src/lib/logger.js', () => ({
  logger: {
    ok: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { fetchNominatim, geocodeService } = await import('../../../server/src/services/geocode.service.js');

const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

describe('geocodeService Nominatim lifecycle', () => {
  beforeEach(() => {
    queryOne.mockReset();
    run.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out a stalled request and lets the next queued request proceed', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
      }))
      .mockResolvedValueOnce(response(200, [{ lat: '1', lon: '2', display_name: 'Recovered' }]));
    vi.stubGlobal('fetch', fetchMock);

    const stalled = fetchNominatim('Stalled place');
    await vi.advanceTimersByTimeAsync(1_100 + 15_000);
    await expect(stalled).resolves.toEqual({ status: 'error' });

    const recovered = fetchNominatim('Recovered place');
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(recovered).resolves.toMatchObject({ status: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the deadline active while reading a stalled response body', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => ({
      status: 200,
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchNominatim('Slow body place');
    await vi.advanceTimersByTimeAsync(1_100 + 15_000);
    await expect(request).resolves.toEqual({ status: 'error' });
  });

  it('does not make another upstream request after a batch is cancelled', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    queryOne.mockReturnValue(undefined);

    const controller = new AbortController();
    const iterator = geocodeService.batchGeocode(['First place', 'Second place'], controller.signal);
    const progress = iterator.next();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(progress).resolves.toMatchObject({ done: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1); // pending record only; cancellation is never persisted as not_found/error
  });

  it('preserves the 429 pause and retry policy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, []))
      .mockResolvedValueOnce(response(200, [{ lat: '3', lon: '4', display_name: 'Retried' }]));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchNominatim('Rate limited place');
    await vi.advanceTimersByTimeAsync(1_100 + 60_000);
    await expect(request).resolves.toMatchObject({ status: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
