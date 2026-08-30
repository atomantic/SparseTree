import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../server/src/app.js';

describe('terminal API boundary', () => {
  let app: Express;
  let clientDist: string;

  beforeAll(() => {
    clientDist = mkdtempSync(path.join(tmpdir(), 'sparsetree-client-'));
    writeFileSync(
      path.join(clientDist, 'index.html'),
      '<!doctype html><html><body>SparseTree test client</body></html>'
    );
    app = createApp({ clientDist });
  });

  afterAll(() => {
    rmSync(clientDist, { recursive: true, force: true });
  });

  it.each([
    ['get', '/api/persons/missing/typo/extra'],
    ['post', '/api/missing']
  ] as const)('returns the JSON error envelope for unknown %s routes', async (method, url) => {
    const response = await request(app)[method](url).expect(404);

    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({
      success: false,
      error: 'API route not found'
    });
  });

  it('keeps non-API navigation behind the SPA fallback', async () => {
    const response = await request(app)
      .get('/people/interesting-ancestor')
      .expect(200);

    expect(response.type).toBe('text/html');
    expect(response.text).toContain('SparseTree test client');
  });
});
