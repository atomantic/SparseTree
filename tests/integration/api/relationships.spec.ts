/** Production person, relationship, and scoped quick-search route contracts. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedTestData, TEST_PERSON_IDS, type TestContext } from '../setup';

describe('Production relationship routes', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    seedTestData(ctx.db);
  });

  afterEach(() => ctx.close());

  it('serves quick-search results from the requested database only', async () => {
    const response = await request(ctx.app).get('/api/persons/test-db/quick-search?q=John').expect(200);
    expect(response.body.data.map((person: { personId: string }) => person.personId).sort()).toEqual([
      TEST_PERSON_IDS.root, TEST_PERSON_IDS.father, TEST_PERSON_IDS.mother,
    ].sort());

    const shortQuery = await request(ctx.app).get('/api/persons/test-db/quick-search?q=J').expect(200);
    expect(shortQuery.body.data).toEqual([]);

    ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES (?, 'John Other', 'male', 0)`)
      .run(TEST_PERSON_IDS.outsider);
    ctx.db.prepare(`INSERT INTO database_info (db_id, root_id, root_name, source_provider) VALUES ('other-db', ?, 'John Other', 'test')`)
      .run(TEST_PERSON_IDS.outsider);
    ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('other-db', ?)`)
      .run(TEST_PERSON_IDS.outsider);
    const scoped = await request(ctx.app).get('/api/persons/test-db/quick-search?q=John').expect(200);
    expect(scoped.body.data.map((person: { personId: string }) => person.personId).sort()).toEqual([
      TEST_PERSON_IDS.root, TEST_PERSON_IDS.father, TEST_PERSON_IDS.mother,
    ].sort());
  });

  it('validates relationship input before touching persistence', async () => {
    await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'cousin', targetId: TEST_PERSON_IDS.father }).expect(400);
    await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'spouse' }).expect(400);
    await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'spouse', newPerson: { name: '   ' } }).expect(400);
    await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'spouse', targetId: 'not-a-canonical-id' }).expect(400);
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM spouse_edge').get()).toEqual({ count: 0 });
  });

  it('rejects source and target people outside the selected database', async () => {
    ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES (?, 'Orphan', 'unknown', 0)`)
      .run(TEST_PERSON_IDS.outsider);
    await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.outsider}/link-relationship`)
      .send({ relationshipType: 'spouse', targetId: TEST_PERSON_IDS.father }).expect(403);

    ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES (?, 'Outsider', 'unknown', 0)`)
      .run(TEST_PERSON_IDS.spouse);
    ctx.db.prepare(`INSERT INTO database_info (db_id, root_id, root_name, source_provider) VALUES ('other-db', ?, 'Outsider', 'test')`)
      .run(TEST_PERSON_IDS.spouse);
    ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('other-db', ?)`)
      .run(TEST_PERSON_IDS.spouse);
    const response = await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'spouse', targetId: TEST_PERSON_IDS.spouse }).expect(403);
    expect(response.body.error).toContain('does not belong');
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM spouse_edge').get()).toEqual({ count: 0 });
  });

  it('links existing members and persists the production edge write', async () => {
    ctx.db.prepare(`INSERT INTO person (person_id, display_name, gender, living) VALUES (?, 'Jane Doe', 'female', 0)`)
      .run(TEST_PERSON_IDS.spouse);
    ctx.db.prepare(`INSERT INTO database_membership (db_id, person_id) VALUES ('test-db', ?)`)
      .run(TEST_PERSON_IDS.spouse);

    const response = await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'spouse', targetId: TEST_PERSON_IDS.spouse }).expect(200);
    expect(response.body.data).toMatchObject({ personId: TEST_PERSON_IDS.root, targetId: TEST_PERSON_IDS.spouse, relationshipType: 'spouse', createdNew: false });
    expect(ctx.db.prepare('SELECT person1_id, person2_id FROM spouse_edge').get()).toEqual({
      person1_id: TEST_PERSON_IDS.root < TEST_PERSON_IDS.spouse ? TEST_PERSON_IDS.root : TEST_PERSON_IDS.spouse,
      person2_id: TEST_PERSON_IDS.root < TEST_PERSON_IDS.spouse ? TEST_PERSON_IDS.spouse : TEST_PERSON_IDS.root,
    });
  });

  it('creates a stub and its membership in the same route operation', async () => {
    const response = await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'father', newPerson: { name: 'Stub Father' } }).expect(200);
    expect(response.body.data).toMatchObject({ relationshipType: 'father', createdNew: true, targetId: TEST_PERSON_IDS.stub });
    expect(ctx.db.prepare('SELECT display_name, gender FROM person WHERE person_id = ?').get(TEST_PERSON_IDS.stub))
      .toEqual({ display_name: 'Stub Father', gender: 'male' });
    expect(ctx.db.prepare('SELECT 1 FROM database_membership WHERE db_id = ? AND person_id = ?').get('test-db', TEST_PERSON_IDS.stub))
      .toBeDefined();
    expect(ctx.db.prepare('SELECT 1 FROM parent_edge WHERE child_id = ? AND parent_id = ?').get(TEST_PERSON_IDS.root, TEST_PERSON_IDS.stub))
      .toBeDefined();
  });

  it('rejects duplicate links and unlinks only an existing in-database edge', async () => {
    const duplicate = await request(ctx.app).post(`/api/persons/test-db/${TEST_PERSON_IDS.root}/link-relationship`)
      .send({ relationshipType: 'father', targetId: TEST_PERSON_IDS.father }).expect(409);
    expect(duplicate.body.error).toMatch(/already exists/i);

    const removed = await request(ctx.app).delete(`/api/persons/test-db/${TEST_PERSON_IDS.root}/unlink-relationship`)
      .send({ relationshipType: 'father', targetId: TEST_PERSON_IDS.father }).expect(200);
    expect(removed.body.data).toMatchObject({ personId: TEST_PERSON_IDS.root, targetId: TEST_PERSON_IDS.father });
    expect(ctx.db.prepare('SELECT 1 FROM parent_edge WHERE child_id = ? AND parent_id = ?').get(TEST_PERSON_IDS.root, TEST_PERSON_IDS.father))
      .toBeUndefined();

    await request(ctx.app).delete(`/api/persons/test-db/${TEST_PERSON_IDS.root}/unlink-relationship`)
      .send({ relationshipType: 'father', targetId: TEST_PERSON_IDS.father }).expect(404);
  });
});
