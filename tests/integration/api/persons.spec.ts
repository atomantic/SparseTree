/**
 * Person API tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, TEST_PERSON_IDS, type TestContext } from '../setup';

describe('Person Routes', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
    seedTestData(ctx.db);
  });

  afterAll(() => {
    ctx.close();
  });

  describe('GET /api/persons/:dbId', () => {
    it('returns paginated list of persons', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(5);
      expect(response.body.data.total).toBe(5);
      expect(response.body.data.totalPages).toBe(1);
    });

    it('respects pagination parameters', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db?page=1&limit=2')
        .expect(200);

      expect(response.body.data.results).toHaveLength(2);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.limit).toBe(2);
    });

    it('returns empty list for non-existent database', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/nonexistent-db')
        .expect(200);

      expect(response.body.data.results).toHaveLength(0);
      expect(response.body.data.total).toBe(0);
    });
  });

  describe('GET /api/persons/:dbId/:personId', () => {
    it('returns single person by ID', async () => {
      const response = await request(ctx.app)
        .get(`/api/persons/test-db/${TEST_PERSON_IDS.root}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_PERSON_IDS.root);
      expect(response.body.data.name).toBe('John Smith');
      expect(response.body.data.gender).toBe('male');
    });

    it('returns 404 for non-existent person', async () => {
      const response = await request(ctx.app)
        .get(`/api/persons/test-db/${TEST_PERSON_IDS.missing}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('includes bio in response', async () => {
      const response = await request(ctx.app)
        .get(`/api/persons/test-db/${TEST_PERSON_IDS.root}`)
        .expect(200);

      expect(response.body.data.bio).toBe('A test person');
    });
  });
});
