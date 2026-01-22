/**
 * Health check API tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestContext } from '../setup';

describe('GET /api/health', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    ctx.close();
  });

  it('returns ok status', async () => {
    const response = await request(ctx.app)
      .get('/api/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
  });

  it('returns timestamp', async () => {
    const response = await request(ctx.app)
      .get('/api/health')
      .expect(200);

    expect(response.body.timestamp).toBeDefined();
    expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
  });
});
