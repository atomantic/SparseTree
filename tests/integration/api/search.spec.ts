/**
 * Search API tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

describe('Search Routes', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
    seedTestData(ctx.db);
  });

  afterAll(() => {
    ctx.close();
  });

  describe('GET /api/search/:dbId', () => {
    it('returns all persons when no query provided', async () => {
      const response = await request(ctx.app)
        .get('/api/search/test-db')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBeGreaterThan(0);
    });

    it('filters persons by name query', async () => {
      const response = await request(ctx.app)
        .get('/api/search/test-db?q=Smith')
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should find John Smith, James Smith, William Smith
      expect(response.body.data.results.length).toBeGreaterThanOrEqual(3);
      response.body.data.results.forEach((person: { name: string }) => {
        expect(person.name).toContain('Smith');
      });
    });

    it('returns empty results for non-matching query', async () => {
      const response = await request(ctx.app)
        .get('/api/search/test-db?q=NonexistentName')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(0);
    });

    it('respects pagination parameters', async () => {
      const response = await request(ctx.app)
        .get('/api/search/test-db?page=1&limit=2')
        .expect(200);

      expect(response.body.data.results.length).toBeLessThanOrEqual(2);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(2);
    });

    it('is case-insensitive', async () => {
      const upperCase = await request(ctx.app)
        .get('/api/search/test-db?q=SMITH')
        .expect(200);

      const lowerCase = await request(ctx.app)
        .get('/api/search/test-db?q=smith')
        .expect(200);

      // Both should return similar results (LIKE is case-insensitive by default in SQLite)
      expect(upperCase.body.data.results.length).toBeGreaterThan(0);
      expect(lowerCase.body.data.results.length).toBeGreaterThan(0);
    });

    it('returns empty results for non-existent database', async () => {
      const response = await request(ctx.app)
        .get('/api/search/nonexistent-db?q=Smith')
        .expect(200);

      expect(response.body.data.results).toHaveLength(0);
    });
  });
});
