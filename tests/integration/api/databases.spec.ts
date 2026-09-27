/**
 * Database API tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, TEST_PERSON_IDS, type TestContext } from '../setup';

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
      seedTestData(freshCtx.db);
    });

    afterEach(() => {
      freshCtx?.close();
    });

    it('creates a new database', async () => {
      const response = await request(freshCtx.app)
        .post('/api/databases')
        .send({
          personId: TEST_PERSON_IDS.grandfather,
          maxGenerations: 10
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(`db-${TEST_PERSON_IDS.grandfather}`);
      expect(response.body.data.rootName).toBe('William Smith');
      expect(freshCtx.db.prepare('SELECT 1 FROM database_info WHERE db_id = ?').get(`db-${TEST_PERSON_IDS.grandfather}`)).toBeDefined();
    });

    it('returns error when required fields are missing', async () => {
      const response = await request(freshCtx.app)
        .post('/api/databases')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('personId is required');
    });
  });
});
