import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../server/src/app.js';
import { resolveAccessConfig } from '../../../server/src/middleware/accessBoundary.js';
import { browserService } from '../../../server/src/services/browser.service.js';

const token = 'test-api-token';
const externalEnv = { HOST: '0.0.0.0', SPARSETREE_API_TOKEN: token };
const makeApp = (env = externalEnv) => createApp({
  env,
  clientDist: '/nonexistent-client-dist',
  aiToolkit: { mountRoutes: app => {
    app.get('/toolkit-test', (_req, res) => res.json({ success: true }));
  } }
});

describe('production app access boundary', () => {
  it.each(['0.0.0.0', '::', '100.64.1.2', 'private.example'])('refuses an external bind without a token: %s', host => {
    expect(() => makeApp({ HOST: host } as typeof externalEnv)).toThrow('SPARSETREE_API_TOKEN');
  });

  it.each(['localhost', '127.0.0.1', '::1'])('keeps token-free loopback development: %s', async host => {
    await request(makeApp({ HOST: host } as typeof externalEnv)).get('/api/health').expect(200);
  });

  it.each(['', '   ', 'line\nbreak'])('rejects unusable configured tokens without printing them', badToken => {
    expect(() => resolveAccessConfig({ HOST: 'localhost', SPARSETREE_API_TOKEN: badToken })).toThrow('non-empty token');
  });

  it.each(['*', 'https://example.com/path', 'https://user:password@example.com', 'https://example.com,', 'null'])('rejects invalid CORS allowlists: %s', origin => {
    expect(() => resolveAccessConfig({ ...externalEnv, CORS_ORIGIN: origin })).toThrow('exact HTTP(S) origins');
  });

  it('validates each exact origin and never enables credentialed CORS', async () => {
    const app = makeApp({ ...externalEnv, CORS_ORIGIN: 'https://example.com,http://localhost:6373' } as typeof externalEnv);
    const response = await request(app).get('/api/health').set('Origin', 'https://example.com').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    const forbidden = await request(app).get('/api/health').set('Origin', 'https://other.example').expect(401);
    expect(forbidden.headers['access-control-allow-origin']).not.toBe('https://other.example');
  });

  it.each([
    ['get', '/api/persons/person-id'],
    ['post', '/api/scrape-providers/familysearch/credentials'],
    ['delete', '/api/scrape-providers/familysearch/credentials'],
    ['post', '/api/browser/navigate'],
    ['get', '/api/browser/token'],
    ['get', '/api/health'],
    ['get', '/api/missing'],
    ['get', '/toolkit-test']
  ] as const)('gates %s %s before reaching its handler', async (method, route) => {
    const app = makeApp();
    await request(app)[method](route).expect(401);
    await request(app)[method](route).set('Authorization', 'Basic invalid').expect(401);
    await request(app)[method](route).set('Authorization', 'Bearer wrong').expect(403);
    await request(app)[method](route).set('Authorization', 'Bearer much-longer-wrong-token').expect(403);
  });

  it('permits intended API and Toolkit routes with a valid token without reflecting it', async () => {
    const app = makeApp();
    for (const route of ['/api/health', '/toolkit-test']) {
      const response = await request(app).get(route).set('Authorization', `Bearer ${token}`).expect(200);
      expect(response.text).not.toContain(token);
    }
  });

  it('protects loopback API requests when configured, including forwarded proxy traffic', async () => {
    const app = makeApp({ ...externalEnv, HOST: 'localhost' });
    await request(app).get('/api/health').set('X-Forwarded-For', '100.64.1.2').expect(401);
    await request(app).get('/api/health').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('never extracts or returns a browser session token over HTTP, including authenticated requests', async () => {
    const extraction = vi.spyOn(browserService, 'getFamilySearchToken');
    await request(makeApp()).get('/api/browser/token').set('Authorization', `Bearer ${token}`).expect(404);
    await request(makeApp({ HOST: 'localhost' } as typeof externalEnv)).get('/api/browser/token').expect(404);
    expect(extraction).not.toHaveBeenCalled();
    extraction.mockRestore();
  });
});
