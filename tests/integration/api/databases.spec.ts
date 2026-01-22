/**
 * Database API tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

describe('Database Routes', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    ctx.close();
  });

  describe('GET /api/databases', () => {
    it('returns empty array when no databases exist', async () => {
      const response = await request(ctx.app)
        .get('/api/databases')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('returns list of databases after seeding', async () => {
      seedTestData(ctx.db);

      const response = await request(ctx.app)
        .get('/api/databases')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('test-db');
      expect(response.body.data[0].rootName).toBe('John Smith');
    });
  });

  describe('POST /api/databases', () => {
    let freshCtx: TestContext;

    beforeEach(() => {
      freshCtx = createTestApp();
    });

    afterAll(() => {
      freshCtx?.close();
    });

    it('creates a new database', async () => {
      const response = await request(freshCtx.app)
        .post('/api/databases')
        .send({
          dbId: 'new-db',
          rootId: 'ROOT-001',
          rootName: 'Test Root',
          maxGenerations: 10,
          sourceProvider: 'familysearch'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dbId).toBe('new-db');
      expect(response.body.data.rootName).toBe('Test Root');
    });

    it('returns error when required fields are missing', async () => {
      const response = await request(freshCtx.app)
        .post('/api/databases')
        .send({ dbId: 'incomplete' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });
  });
});
