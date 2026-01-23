/**
 * AI Discovery API tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

describe('AI Discovery API', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    ctx.close();
  });

  beforeEach(() => {
    // Reset database state before each test
    // Order matters due to FK constraints: delete children before parents
    ctx.db.exec('DELETE FROM favorite');
    ctx.db.exec('DELETE FROM parent_edge');
    ctx.db.exec('DELETE FROM database_membership');
    ctx.db.exec('DELETE FROM database_info');
    ctx.db.exec('DELETE FROM person');
    seedTestData(ctx.db);
  });

  describe('GET /api/ai-discovery/progress/:runId', () => {
    it('returns 404 for non-existent run', async () => {
      const response = await request(ctx.app)
        .get('/api/ai-discovery/progress/nonexistent-run')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Run not found');
    });
  });

  describe('POST /api/ai-discovery/:dbId/apply', () => {
    it('returns 400 when personId is missing', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({ whyInteresting: 'Historical figure' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('personId and whyInteresting are required');
    });

    it('returns 400 when whyInteresting is missing', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({ personId: 'PERSON-002' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('personId and whyInteresting are required');
    });

    it('applies a candidate as favorite', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({
          personId: 'PERSON-002',
          whyInteresting: 'Notable ancestor',
          tags: ['historical', 'verified']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(true);

      // Verify favorite was created
      const favorite = ctx.db.prepare(
        'SELECT * FROM favorite WHERE db_id = ? AND person_id = ?'
      ).get('test-db', 'PERSON-002') as Record<string, unknown> | undefined;

      expect(favorite).toBeDefined();
      expect(favorite?.why_interesting).toBe('Notable ancestor');
      expect(JSON.parse(favorite?.tags as string)).toEqual(['historical', 'verified']);
    });

    it('applies a candidate without tags', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({
          personId: 'PERSON-003',
          whyInteresting: 'Important person'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const favorite = ctx.db.prepare(
        'SELECT * FROM favorite WHERE db_id = ? AND person_id = ?'
      ).get('test-db', 'PERSON-003') as Record<string, unknown> | undefined;

      expect(favorite).toBeDefined();
      expect(JSON.parse(favorite?.tags as string)).toEqual([]);
    });
  });

  describe('POST /api/ai-discovery/:dbId/apply-batch', () => {
    it('returns 400 when candidates is not an array', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply-batch')
        .send({ candidates: 'not-an-array' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('candidates array is required');
    });

    it('returns 400 when candidates is missing', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply-batch')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('candidates array is required');
    });

    it('applies multiple candidates as favorites', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply-batch')
        .send({
          candidates: [
            { personId: 'PERSON-002', whyInteresting: 'First notable ancestor', suggestedTags: ['tag1'] },
            { personId: 'PERSON-003', whyInteresting: 'Second notable ancestor', suggestedTags: ['tag2'] },
            { personId: 'PERSON-004', whyInteresting: 'Third notable ancestor' }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(3);

      // Verify favorites were created
      const favorites = ctx.db.prepare(
        'SELECT * FROM favorite WHERE db_id = ?'
      ).all('test-db') as Record<string, unknown>[];

      expect(favorites.length).toBe(3);
    });

    it('skips candidates without required fields', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply-batch')
        .send({
          candidates: [
            { personId: 'PERSON-002', whyInteresting: 'Valid candidate' },
            { personId: 'PERSON-003' }, // Missing whyInteresting
            { whyInteresting: 'Missing personId' }, // Missing personId
            { personId: 'PERSON-004', whyInteresting: 'Another valid candidate' }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(2);
    });

    it('handles empty candidates array', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply-batch')
        .send({ candidates: [] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(0);
    });
  });
});
