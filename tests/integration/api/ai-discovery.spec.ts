/**
 * AI Discovery API tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, TEST_PERSON_IDS, type TestContext } from '../setup';

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
    ctx.db.exec('DELETE FROM spouse_edge');
    ctx.db.exec('DELETE FROM database_membership');
    ctx.db.exec('DELETE FROM database_info');
    ctx.db.exec('DELETE FROM vital_event');
    ctx.db.exec('DELETE FROM claim');
    ctx.db.exec('DELETE FROM media');
    ctx.db.exec('DELETE FROM person');
    ctx.aiDiscovery.reset();
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
        .send({ personId: TEST_PERSON_IDS.father })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('personId and whyInteresting are required');
    });

    it('applies a candidate as favorite', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({
          personId: TEST_PERSON_IDS.father,
          whyInteresting: 'Notable ancestor',
          tags: ['historical', 'verified']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(true);

      // Verify favorite was created
      const favorite = ctx.db.prepare(
        'SELECT * FROM favorite WHERE db_id = ? AND person_id = ?'
      ).get('test-db', TEST_PERSON_IDS.father) as Record<string, unknown> | undefined;

      expect(favorite).toBeDefined();
      expect(favorite?.why_interesting).toBe('Notable ancestor');
      expect(JSON.parse(favorite?.tags as string)).toEqual(['historical', 'verified']);
    });

    it('applies a candidate without tags', async () => {
      const response = await request(ctx.app)
        .post('/api/ai-discovery/test-db/apply')
        .send({
          personId: TEST_PERSON_IDS.mother,
          whyInteresting: 'Important person'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const favorite = ctx.db.prepare(
        'SELECT * FROM favorite WHERE db_id = ? AND person_id = ?'
      ).get('test-db', TEST_PERSON_IDS.mother) as Record<string, unknown> | undefined;

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
            { personId: TEST_PERSON_IDS.father, whyInteresting: 'First notable ancestor', suggestedTags: ['tag1'] },
            { personId: TEST_PERSON_IDS.mother, whyInteresting: 'Second notable ancestor', suggestedTags: ['tag2'] },
            { personId: TEST_PERSON_IDS.grandfather, whyInteresting: 'Third notable ancestor' }
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
            { personId: TEST_PERSON_IDS.father, whyInteresting: 'Valid candidate' },
            { personId: 'PERSON-003' }, // Missing whyInteresting
            { whyInteresting: 'Missing personId' }, // Missing personId
            { personId: TEST_PERSON_IDS.grandfather, whyInteresting: 'Another valid candidate' },
            null,
            'malformed',
            { personId: TEST_PERSON_IDS.mother, whyInteresting: 42 }
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

    it('accepts exactly 1000 candidates and rejects 1001 without partial writes', async () => {
      const candidate = { personId: TEST_PERSON_IDS.father, whyInteresting: 'Boundary candidate' };
      const accepted = await request(ctx.app).post('/api/ai-discovery/test-db/apply-batch')
        .send({ candidates: Array.from({ length: 1000 }, () => candidate) }).expect(200);
      expect(accepted.body.data.applied).toBe(1000);
      expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM favorite').get()).toEqual({ count: 1 });

      ctx.db.exec('DELETE FROM favorite');
      const rejected = await request(ctx.app).post('/api/ai-discovery/test-db/apply-batch')
        .send({ candidates: Array.from({ length: 1001 }, () => candidate) }).expect(400);
      expect(rejected.body.error).toContain('Maximum 1000');
      expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM favorite').get()).toEqual({ count: 0 });
    });
  });

  describe('AI discovery provider boundaries', () => {
    it('returns a production failure response when quick discovery fails', async () => {
      ctx.aiDiscovery.failQuick = true;
      const response = await request(ctx.app).post('/api/ai-discovery/test-db/quick').send({}).expect(500);
      expect(response.body).toMatchObject({ success: false, error: 'Discovery provider failed' });
    });

    it('returns a production failure response when full discovery fails', async () => {
      ctx.aiDiscovery.failStart = true;
      const response = await request(ctx.app).post('/api/ai-discovery/test-db/start').send({}).expect(500);
      expect(response.body).toMatchObject({ success: false, error: 'Discovery provider failed' });
    });

    it('rejects a second active run with the production conflict response', async () => {
      const first = await request(ctx.app).post('/api/ai-discovery/test-db/start').send({}).expect(200);
      const second = await request(ctx.app).post('/api/ai-discovery/test-db/start').send({}).expect(409);
      expect(second.body.error).toContain('already active');
      expect(second.body.data.runId).toBe(first.body.data.runId);
    });
  });
});
