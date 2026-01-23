/**
 * Favorites API tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

describe('Favorites Routes', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
    seedTestData(ctx.db);
  });

  afterAll(() => {
    ctx.close();
  });

  describe('GET /api/favorites', () => {
    it('returns empty list initially', async () => {
      const response = await request(ctx.app)
        .get('/api/favorites')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.favorites).toEqual([]);
    });
  });

  describe('POST /api/favorites/db/:dbId/:personId', () => {
    it('adds a person to favorites', async () => {
      const response = await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-001')
        .send({
          whyInteresting: 'Root person of the tree',
          tags: ['royalty', 'famous']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.favorite.personId).toBe('PERSON-001');
      expect(response.body.data.favorite.whyInteresting).toBe('Root person of the tree');
      expect(response.body.data.favorite.tags).toEqual(['royalty', 'famous']);
    });

    it('returns error when whyInteresting is missing', async () => {
      const response = await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-002')
        .send({ tags: ['test'] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('whyInteresting');
    });

    it('handles empty tags array', async () => {
      const response = await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-003')
        .send({
          whyInteresting: 'Another interesting person',
          tags: []
        })
        .expect(200);

      expect(response.body.data.favorite.tags).toEqual([]);
    });

    it('handles missing tags (defaults to empty array)', async () => {
      const response = await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-004')
        .send({ whyInteresting: 'No tags provided' })
        .expect(200);

      expect(response.body.data.favorite.tags).toEqual([]);
    });
  });

  describe('DELETE /api/favorites/db/:dbId/:personId', () => {
    beforeEach(async () => {
      // Add a favorite to delete
      await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-005')
        .send({ whyInteresting: 'To be removed' });
    });

    it('removes a person from favorites', async () => {
      const response = await request(ctx.app)
        .delete('/api/favorites/db/test-db/PERSON-005')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.removed).toBe(true);
    });

    it('returns 404 when person is not a favorite', async () => {
      // First delete
      await request(ctx.app)
        .delete('/api/favorites/db/test-db/PERSON-005')
        .expect(200);

      // Second delete should fail
      const response = await request(ctx.app)
        .delete('/api/favorites/db/test-db/PERSON-005')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not a favorite');
    });

    it('returns 404 for non-existent person', async () => {
      const response = await request(ctx.app)
        .delete('/api/favorites/db/test-db/NONEXISTENT')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('favorites list after modifications', () => {
    it('shows added favorites in list', async () => {
      // Add a favorite
      await request(ctx.app)
        .post('/api/favorites/db/test-db/PERSON-002')
        .send({ whyInteresting: 'Test listing' });

      const response = await request(ctx.app)
        .get('/api/favorites')
        .expect(200);

      expect(response.body.data.favorites.length).toBeGreaterThan(0);
      const added = response.body.data.favorites.find(
        (f: { personId: string }) => f.personId === 'PERSON-002'
      );
      expect(added).toBeDefined();
      expect(added.whyInteresting).toBe('Test listing');
    });
  });
});
