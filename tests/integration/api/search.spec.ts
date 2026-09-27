/**
 * Search API tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, TEST_PERSON_IDS, type TestContext } from '../setup';

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
      expect(response.body.data.results).toHaveLength(5);
      expect(response.body.data).toMatchObject({ total: 5, page: 1, limit: 50, totalPages: 1 });
    });

    it('filters persons by name query', async () => {
      const response = await request(ctx.app)
        .get('/api/search/test-db?q=Smith')
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should find John Smith, James Smith, William Smith
      expect(response.body.data.results).toHaveLength(3);
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
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.limit).toBe(2);
      expect(response.body.data.total).toBe(5);
      expect(response.body.data.totalPages).toBe(3);
    });

    it('is case-insensitive', async () => {
      const upperCase = await request(ctx.app)
        .get('/api/search/test-db?q=SMITH')
        .expect(200);

      const lowerCase = await request(ctx.app)
        .get('/api/search/test-db?q=smith')
        .expect(200);

      expect(upperCase.body.data.results.map((person: { id: string }) => person.id))
        .toEqual(lowerCase.body.data.results.map((person: { id: string }) => person.id));
    });

    it('returns empty results for non-existent database', async () => {
      const response = await request(ctx.app)
        .get('/api/search/nonexistent-db?q=Smith')
        .expect(200);

      expect(response.body.data.results).toHaveLength(0);
    });

    it('applies every production search filter and scopes results to the requested database', async () => {
      const filters: Array<[string, string[]]> = [
        ['location=London', [TEST_PERSON_IDS.root]],
        ['occupation=Farmer', [TEST_PERSON_IDS.father]],
        ['birthAfter=1870', [TEST_PERSON_IDS.root]],
        ['birthBefore=1860', [TEST_PERSON_IDS.father]],
        ['generationMin=1&generationMax=1', [TEST_PERSON_IDS.father, TEST_PERSON_IDS.mother]],
        ['hasPhoto=true', [TEST_PERSON_IDS.root]],
      ];
      for (const [query, expectedIds] of filters) {
        const response = await request(ctx.app).get(`/api/search/test-db?${query}`).expect(200);
        expect(response.body.data.results.map((person: { id: string }) => person.id).sort()).toEqual(expectedIds.sort());
      }
      const withBio = await request(ctx.app).get('/api/search/test-db?hasBio=true').expect(200);
      expect(withBio.body.data.results).toHaveLength(5);

      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living, bio) VALUES (?, 'John Other', 'male', 0, 'outside')`)
        .run(TEST_PERSON_IDS.outsider);
      ctx.db.prepare(`INSERT INTO database_info (db_id, root_id, root_name, source_provider) VALUES ('other-db', ?, 'John Other', 'test')`)
        .run(TEST_PERSON_IDS.outsider);
      ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('other-db', ?)`)
        .run(TEST_PERSON_IDS.outsider);
      const scoped = await request(ctx.app).get('/api/search/test-db?q=John').expect(200);
      expect(scoped.body.data.results.map((person: { id: string }) => person.id).sort()).toEqual([
        TEST_PERSON_IDS.root, TEST_PERSON_IDS.father, TEST_PERSON_IDS.mother,
      ].sort());
    });

    it('normalizes invalid, negative, unsafe and oversized pagination values', async () => {
      const invalid = await request(ctx.app).get('/api/search/test-db?page=-1&limit=0').expect(200);
      expect(invalid.body.data).toMatchObject({ page: 1, limit: 50, total: 5, totalPages: 1 });

      const unsafe = await request(ctx.app).get('/api/search/test-db?page=99999999999999999999&limit=999999999').expect(200);
      expect(unsafe.body.data).toMatchObject({ page: 1, limit: 100, total: 5, totalPages: 1 });
    });
  });
});
