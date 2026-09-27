import { describe, it, expect, vi } from 'vitest';
import { createFamilySearchClient } from '../../../server/src/lib/familysearch/client.js';

const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers });

function setup(maxThrottledRetries = 2) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const sleep = vi.fn(async () => {});
  return { fetch, sleep, client: createFamilySearchClient({ accessToken: 'test-token', fetch, sleep, maxThrottledRetries }) };
}

describe('FamilySearch fetch adapter', () => {
  it('reads production JSON and sends credentials only in the bearer header', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(json({ persons: [{ id: 'ABC' }] }));
    expect((await client.get('/platform/tree/persons/ABC')).data).toEqual({ persons: [{ id: 'ABC' }] });
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.familysearch.org/platform/tree/persons/ABC');
    expect(options).toMatchObject({ redirect: 'manual', headers: { Authorization: 'Bearer test-token', Accept: 'application/x-fs-v1+json' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['https://evil.example/platform/tree', '//evil.example/platform/tree', '/platform/../../secrets', '/platform/\\evil.example', 'https://api.familysearch.org/platform/tree'])('rejects unsafe caller input %s before requesting', async path => {
    const { client, fetch } = setup();
    await expect(client.get(path)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not follow upstream redirects with bearer credentials', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://evil.example' } }));
    await expect(client.get('/platform/tree/persons/ABC')).rejects.toThrow('redirect rejected');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps client tokens isolated', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json({}));
    await createFamilySearchClient({ accessToken: 'first', fetch }).get('/platform/tree/persons/A');
    await createFamilySearchClient({ accessToken: 'second', fetch }).get('/platform/tree/persons/B');
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer first' });
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer second' });
  });

  it('retries throttling up to the configured limit, honoring a bounded retry delay', async () => {
    const { client, fetch, sleep } = setup();
    fetch.mockImplementation(async () => json({ errors: [] }, 429, { 'Retry-After': '120' }));
    expect((await client.get('/platform/tree/persons/ABC')).statusCode).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[60_000], [60_000]]);
  });

  it('returns a successful response after throttling', async () => {
    const { client, fetch, sleep } = setup();
    fetch.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ persons: [] }));
    expect((await client.get('/platform/tree/persons/A')).statusCode).toBe(200);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it.each(['not json', ''])('rejects malformed/empty successful JSON %s', async body => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(body));
    await expect(client.get('/platform/tree/persons/A')).rejects.toThrow('FamilySearch JSON response');
  });

  it('retains HTTP status classification for non-JSON errors', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response('<html>unavailable</html>', { status: 503 }));
    expect(await client.get('/platform/tree/persons/A')).toEqual({ statusCode: 503, data: undefined });
  });
});
