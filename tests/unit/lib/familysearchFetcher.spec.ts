import { describe, it, expect, vi, beforeEach } from 'vitest';
const get = vi.hoisted(() => vi.fn());
vi.mock('../../../server/src/lib/familysearch/client.js', () => ({ fsc: { get } }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: { error: vi.fn() } }));
import { fscget } from '../../../server/src/lib/familysearch/fetcher.js';

beforeEach(() => { get.mockReset(); });
describe('FamilySearch error classification', () => {
  it('retains the generic data interface', async () => {
    get.mockResolvedValue({ statusCode: 200, data: { persons: [] } });
    expect(await fscget('/platform/tree/persons/A')).toEqual({ persons: [] });
  });
  it('marks unauthorized responses as authentication failures even without JSON', async () => {
    get.mockResolvedValue({ statusCode: 401 });
    await expect(fscget('/platform/tree/persons/A')).rejects.toMatchObject({ isAuthError: true });
  });
  it.each([[429, true], [503, true], [404, false]])('classifies HTTP %s retryability', async (statusCode, isTransient) => {
    get.mockResolvedValue({ statusCode, data: { errors: [{ message: 'failed' }] } });
    await expect(fscget('/platform/tree/persons/A')).rejects.toMatchObject({ statusCode, isTransient, isNetworkError: false });
  });
  it('extracts native fetch network causes for existing caller retries', async () => {
    get.mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }));
    const error = await fscget('/platform/tree/persons/A').catch(error => error);
    expect(error.code).toBe('ECONNRESET');
    expect(error.isTransient).toBe(true);
    expect(error.isNetworkError).toBe(true);
  });
  it('maps fetch timeout to the existing retryable code', async () => {
    get.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const error = await fscget('/platform/tree/persons/A').catch(error => error);
    expect(error.code).toBe('ETIMEDOUT');
    expect(error.isTransient).toBe(true);
  });
  it('does not retry malformed responses', async () => {
    get.mockRejectedValue(new Error('Malformed FamilySearch JSON response'));
    const error = await fscget('/platform/tree/persons/A').catch(error => error);
    expect(error.isTransient).toBe(false);
    expect(error.isNetworkError).toBe(false);
  });
});
