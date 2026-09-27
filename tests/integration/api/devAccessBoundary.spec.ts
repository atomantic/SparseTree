import path from 'node:path';
import request from 'supertest';
import { createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const configFile = path.resolve('client/vite.config.ts');
afterEach(() => vi.unstubAllEnvs());

describe('development listener access boundary', () => {
  it('refuses a CLI host override without an access token before starting the proxy', async () => {
    vi.stubEnv('SPARSETREE_API_TOKEN', undefined);
    vi.stubEnv('VITE_HOST', 'localhost');
    await expect(createServer({ configFile, server: { host: '0.0.0.0' } }))
      .rejects.toThrow('Non-loopback HOST requires SPARSETREE_API_TOKEN');
  });

  it('refuses an unauthenticated external preview listener', async () => {
    vi.stubEnv('SPARSETREE_API_TOKEN', undefined);
    vi.stubEnv('VITE_HOST', 'localhost');
    await expect(createServer({ configFile, preview: { host: '0.0.0.0' } }))
      .rejects.toThrow('Non-loopback HOST requires SPARSETREE_API_TOKEN');
  });

  it('gates proxy requests before contacting even an unauthenticated target', async () => {
    vi.stubEnv('SPARSETREE_API_TOKEN', 'development-test-token');
    vi.stubEnv('VITE_HOST', '0.0.0.0');
    const server = await createServer({
      configFile,
      appType: 'custom',
      root: path.resolve('client'),
      server: { middlewareMode: true }
    });
    const app = (await import('express')).default();
    app.use(server.middlewares);
    const intercepted = vi.fn((_req, res) => res.json({ success: true }));
    // A synthetic route after Vite middleware proves valid bearer handling
    // without reading the application's real data or browser.
    server.middlewares.use('/authorized-test', intercepted);
    await request(app).get('/api/health').expect(401);
    await request(app).get('/api/health').set('Authorization', 'Bearer wrong').expect(403);
    await request(app).get('/authorized-test').set('Authorization', 'Bearer development-test-token').expect(200);
    expect(intercepted).toHaveBeenCalledOnce();
    await server.close();
  });
});
