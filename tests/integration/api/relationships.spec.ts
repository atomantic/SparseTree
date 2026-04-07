/**
 * Relationship link/unlink + quick-search API tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, type TestContext } from '../setup';

describe('Relationship Routes', () => {
  let ctx: TestContext;

  // Use beforeEach so each test starts with a fresh DB — link/unlink mutate state
  beforeEach(() => {
    ctx = createTestApp();
    seedTestData(ctx.db);
  });

  afterEach(() => {
    ctx.close();
  });

  describe('GET /api/persons/:dbId/quick-search', () => {
    it('returns matching persons scoped to the database', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/quick-search?q=John')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].personId).toBe('PERSON-001');
      expect(response.body.data[0].displayName).toBe('John Smith');
    });

    it('returns empty for queries shorter than 2 chars', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/quick-search?q=J')
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('returns empty when no matches', async () => {
      const response = await request(ctx.app)
        .get('/api/persons/test-db/quick-search?q=Zelda')
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('does not return persons from another database', async () => {
      // Create a second database with a person who matches the same query
      ctx.db.prepare(`
        INSERT INTO person (person_id, display_name, gender, living)
        VALUES ('PERSON-OTHER', 'John Otherson', 'male', 0)
      `).run();
      ctx.db.prepare(`
        INSERT INTO database_info (db_id, root_id, root_name, source_provider)
        VALUES ('other-db', 'PERSON-OTHER', 'John Otherson', 'test')
      `).run();
      ctx.db.prepare(`
        INSERT INTO database_membership (db_id, person_id) VALUES ('other-db', 'PERSON-OTHER')
      `).run();

      const response = await request(ctx.app)
        .get('/api/persons/test-db/quick-search?q=John')
        .expect(200);

      const ids = response.body.data.map((r: { personId: string }) => r.personId);
      expect(ids).toContain('PERSON-001');
      expect(ids).not.toContain('PERSON-OTHER');
    });
  });

  describe('POST /api/persons/:dbId/:personId/link-relationship', () => {
    it('rejects invalid relationshipType', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'cousin', targetId: 'PERSON-002' })
        .expect(400);

      expect(response.body.error).toContain('Invalid relationshipType');
    });

    it('rejects missing targetId AND newPerson.name', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'spouse' })
        .expect(400);

      expect(response.body.error).toContain('targetId');
    });

    it('rejects whitespace-only newPerson.name', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'spouse', newPerson: { name: '   ' } })
        .expect(400);
    });

    it('rejects self-link', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'spouse', targetId: 'PERSON-001' })
        .expect(400);

      expect(response.body.error).toContain('themselves');
    });

    it('rejects when source person is not in this database', async () => {
      // Create an isolated person not in test-db
      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES ('ORPHAN', 'Orphan', 'unknown', 0)`).run();

      const response = await request(ctx.app)
        .post('/api/persons/test-db/ORPHAN/link-relationship')
        .send({ relationshipType: 'spouse', targetId: 'PERSON-002' })
        .expect(403);
    });

    it('rejects 404 when targetId does not exist', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'spouse', targetId: 'NONEXISTENT' })
        .expect(404);
    });

    it('creates a spouse edge between existing persons', async () => {
      // Add a candidate spouse to the database
      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES ('SPOUSE-1', 'Jane Doe', 'female', 0)`).run();
      ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('test-db', 'SPOUSE-1')`).run();

      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'spouse', targetId: 'SPOUSE-1' })
        .expect(200);

      expect(response.body.data.relationshipType).toBe('spouse');

      const edge = ctx.db.prepare(`
        SELECT * FROM spouse_edge
        WHERE (person1_id = 'PERSON-001' AND person2_id = 'SPOUSE-1')
           OR (person1_id = 'SPOUSE-1' AND person2_id = 'PERSON-001')
      `).get();
      expect(edge).toBeDefined();
    });

    it('creates a stub person and links as parent', async () => {
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({
          relationshipType: 'father',
          newPerson: { name: 'Stub Father' }
        });

      // PERSON-001 already has a father (PERSON-002) in seed data — linking
      // a NEW father should still work since the constraint is on
      // (child_id, parent_id) not on parent_role.
      expect(response.status).toBe(200);
      expect(response.body.data.createdNew).toBe(true);

      const stubId = response.body.data.targetId;
      const stub = ctx.db.prepare('SELECT * FROM person WHERE person_id = ?').get(stubId) as { display_name: string; gender: string };
      expect(stub.display_name).toBe('Stub Father');
      expect(stub.gender).toBe('male'); // coerced from relationshipType

      // Stub should be a member of the same database
      const membership = ctx.db.prepare(
        'SELECT 1 FROM database_membership WHERE db_id = ? AND person_id = ?'
      ).get('test-db', stubId);
      expect(membership).toBeDefined();
    });

    it('rejects duplicate parent edge', async () => {
      // PERSON-001 already has father PERSON-002 from seed data
      const response = await request(ctx.app)
        .post('/api/persons/test-db/PERSON-001/link-relationship')
        .send({ relationshipType: 'father', targetId: 'PERSON-002' })
        .expect(409);

      expect(response.body.error).toMatch(/already exists/i);
    });
  });

  describe('DELETE /api/persons/:dbId/:personId/unlink-relationship', () => {
    it('removes a parent edge', async () => {
      const response = await request(ctx.app)
        .delete('/api/persons/test-db/PERSON-001/unlink-relationship')
        .send({ relationshipType: 'father', targetId: 'PERSON-002' })
        .expect(200);

      const edge = ctx.db.prepare(
        'SELECT 1 FROM parent_edge WHERE child_id = ? AND parent_id = ?'
      ).get('PERSON-001', 'PERSON-002');
      expect(edge).toBeUndefined();
    });

    it('returns 404 when no matching edge exists', async () => {
      // Add an unrelated person to test-db so the membership check passes
      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES ('UNRELATED', 'Unrelated', 'unknown', 0)`).run();
      ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('test-db', 'UNRELATED')`).run();

      const response = await request(ctx.app)
        .delete('/api/persons/test-db/PERSON-001/unlink-relationship')
        .send({ relationshipType: 'spouse', targetId: 'UNRELATED' })
        .expect(404);
    });

    it('rejects unlink when source person is not in this database', async () => {
      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES ('ORPHAN', 'Orphan', 'unknown', 0)`).run();

      const response = await request(ctx.app)
        .delete('/api/persons/test-db/ORPHAN/unlink-relationship')
        .send({ relationshipType: 'father', targetId: 'PERSON-002' })
        .expect(403);
    });

    it('rejects unlink when target is in a different database', async () => {
      ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES ('OTHER-PERSON', 'Other', 'unknown', 0)`).run();
      ctx.db.prepare(`
        INSERT INTO database_info (db_id, root_id, root_name, source_provider)
        VALUES ('other-db', 'OTHER-PERSON', 'Other', 'test')
      `).run();
      ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('other-db', 'OTHER-PERSON')`).run();

      const response = await request(ctx.app)
        .delete('/api/persons/test-db/PERSON-001/unlink-relationship')
        .send({ relationshipType: 'spouse', targetId: 'OTHER-PERSON' })
        .expect(403);
    });
  });
});
