/**
 * Person API tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

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
      expect(response.body.data.persons).toHaveLength(5);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBe(5);
    });

    it('respects pagination parameters', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db?page=1&limit=2')
        .expect(200);

      expect(response.body.data.persons).toHaveLength(2);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(2);
    });

    it('returns empty list for non-existent database', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/nonexistent-db')
        .expect(200);

      expect(response.body.data.persons).toHaveLength(0);
      expect(response.body.data.pagination.total).toBe(0);
    });
  });

  describe('GET /api/persons/:dbId/:personId', () => {
    it('returns single person by ID', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/PERSON-001')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('PERSON-001');
      expect(response.body.data.name).toBe('John Smith');
      expect(response.body.data.gender).toBe('male');
    });

    it('returns 404 for non-existent person', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/NONEXISTENT')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('includes bio in response', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/PERSON-001')
        .expect(200);

      expect(response.body.data.bio).toBe('A test person');
    });
  });
});
