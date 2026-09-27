/**
 * Integration app factory: production route handlers with isolated persistence
 * adapters. Tests never register parallel HTTP routes here.
 */

import express from 'express';
import { SqliteTestDatabase } from '../utils/sqliteTestDatabase.js';
import { createApp } from '../../server/src/app.js';
import { createAiDiscoveryRouter } from '../../server/src/routes/ai-discovery.routes.js';
import { createDatabaseRoutes } from '../../server/src/routes/database.routes.js';
import { createFavoritesRouter } from '../../server/src/routes/favorites.routes.js';
import { createPersonRoutes } from '../../server/src/routes/person.routes.js';
import { createSearchRoutes } from '../../server/src/routes/search.routes.js';
import { DiscoveryRunConflictError } from '../../server/src/services/ai-discovery.service.js';
import { PRESET_TAGS } from '../../server/src/services/favorites.service.js';

const TEST_DATABASE_SCHEMA = `
  CREATE TABLE person (
    person_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, birth_name TEXT,
    gender TEXT, living INTEGER NOT NULL DEFAULT 0, bio TEXT, is_unusual_death INTEGER DEFAULT 0
  );
  CREATE TABLE external_identity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, source TEXT NOT NULL,
    external_id TEXT NOT NULL, url TEXT, confidence REAL, last_seen_at TEXT, UNIQUE(source, external_id)
  );
  CREATE TABLE database_info (
    db_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, root_name TEXT, source_provider TEXT,
    max_generations INTEGER, person_count INTEGER DEFAULT 0, is_sample INTEGER DEFAULT 0
  );
  CREATE TABLE database_membership (
    db_id TEXT NOT NULL, person_id TEXT NOT NULL, is_root INTEGER NOT NULL DEFAULT 0,
    generation INTEGER, PRIMARY KEY(db_id, person_id)
  );
  CREATE TABLE parent_edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
    parent_role TEXT, confidence REAL, source TEXT, UNIQUE(child_id, parent_id)
  );
  CREATE TABLE spouse_edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person1_id TEXT NOT NULL, person2_id TEXT NOT NULL,
    confidence REAL, source TEXT, UNIQUE(person1_id, person2_id)
  );
  CREATE TABLE vital_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, event_type TEXT NOT NULL,
    date_original TEXT, date_formal TEXT, date_year INTEGER, place TEXT, place_id TEXT,
    source TEXT, confidence REAL
  );
  CREATE TABLE claim (
    claim_id TEXT PRIMARY KEY, person_id TEXT NOT NULL, predicate TEXT NOT NULL,
    value_text TEXT, value_date TEXT, source TEXT, confidence REAL, created_at TEXT
  );
  CREATE TABLE media (media_id TEXT PRIMARY KEY, person_id TEXT NOT NULL, source TEXT, is_primary INTEGER DEFAULT 0);
  CREATE TABLE favorite (
    db_id TEXT NOT NULL, person_id TEXT NOT NULL, why_interesting TEXT, tags TEXT, added_at TEXT,
    PRIMARY KEY(db_id, person_id)
  );
  CREATE TABLE local_override (
    override_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL, original_value TEXT, override_value TEXT, reason TEXT, source TEXT,
    created_at TEXT, updated_at TEXT, UNIQUE(entity_type, entity_id, field_name)
  );
  CREATE TABLE migration (name TEXT PRIMARY KEY, applied_at TEXT);
`;

export const TEST_PERSON_IDS = {
  root: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  father: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  mother: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  grandfather: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  grandmother: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  stub: '01ARZ3NDEKTSV4RRFFQ69G5FBA',
  spouse: '01ARZ3NDEKTSV4RRFFQ69G5FBB',
  outsider: '01ARZ3NDEKTSV4RRFFQ69G5FBC',
  missing: '01ARZ3NDEKTSV4RRFFQ69G5FBZ',
} as const;

export interface TestContext {
  app: express.Express;
  db: SqliteTestDatabase;
  close: () => void;
  aiDiscovery: { failQuick: boolean; failStart: boolean; reset: () => void };
}

type QueryResult = { rowCount: number | null; rows: unknown[] };

/** In-memory SQLite test adapter for the PostgreSQL-shaped route service port. */
const createPostgresAdapter = (db: SqliteTestDatabase) => {
  const normalize = (sql: string) => sql.replace(/\s+FOR UPDATE\b/gi, '');
  const queryOne = async <T>(sql: string, params?: Record<string, unknown>): Promise<T | undefined> =>
    db.prepare(normalize(sql)).get(params ?? {}) as T | undefined;
  const queryAll = async <T>(sql: string, params?: Record<string, unknown>): Promise<T[]> =>
    db.prepare(normalize(sql)).all(params ?? {}) as T[];
  const run = async (sql: string, params?: Record<string, unknown>): Promise<QueryResult> => {
    const result = db.prepare(normalize(sql)).run(params ?? {});
    return { rowCount: result.changes, rows: [] };
  };
  const transaction = async <T>(work: (tx: { queryOne: typeof queryOne; queryAll: typeof queryAll; run: typeof run }) => Promise<T>): Promise<T> => {
    db.exec('BEGIN');
    try {
      const result = await work({ queryOne, queryAll, run });
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return { isConfigured: () => true, queryOne, queryAll, run, transaction };
};

const personRows = (db: SqliteTestDatabase, dbId: string) => db.prepare(`
  SELECT p.person_id AS id, p.display_name AS name, p.birth_name AS birthName,
    p.gender, p.living, p.bio, dm.generation,
    (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth' ORDER BY id LIMIT 1) AS birthYear,
    (SELECT place FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth' ORDER BY id LIMIT 1) AS birthPlace,
    (SELECT GROUP_CONCAT(value_text, ' ') FROM claim WHERE person_id = p.person_id AND predicate = 'occupation') AS occupation,
    EXISTS (SELECT 1 FROM media WHERE person_id = p.person_id) AS hasPhoto
  FROM person p JOIN database_membership dm ON dm.person_id = p.person_id
  WHERE dm.db_id = @dbId ORDER BY p.display_name, p.person_id
`).all({ dbId }) as Array<Record<string, unknown> & {
  id: string; name: string; birthName: string | null; gender: string; living: number; bio: string | null;
  generation: number | null; birthYear: number | null; birthPlace: string | null; occupation: string | null; hasPhoto: number;
}>;

const createDatabaseAdapter = (db: SqliteTestDatabase) => ({
  isPostgresEnabled: async () => true,
  resolveDbId: async (id: string) => db.prepare('SELECT db_id FROM database_info WHERE db_id = ?').get(id) ? id : null,
  async listDatabases() {
    return db.prepare(`SELECT db_id AS id, root_id AS rootId, root_name AS rootName,
      max_generations AS maxGenerations, person_count AS personCount, is_sample AS isSample
      FROM database_info ORDER BY db_id`).all();
  },
  async getDatabaseInfo(dbId: string) {
    const row = db.prepare(`SELECT db_id AS id, root_id AS rootId, root_name AS rootName,
      max_generations AS maxGenerations, person_count AS personCount, is_sample AS isSample
      FROM database_info WHERE db_id = ?`).get(dbId);
    if (!row) throw new Error(`Database ${dbId} not found`);
    return row;
  },
  async createRoot(personId: string, options: { maxGenerations?: number } = {}) {
    const person = db.prepare('SELECT display_name FROM person WHERE person_id = ?').get(personId) as { display_name: string } | undefined;
    if (!person) throw new Error(`Person ${personId} not found`);
    const dbId = `db-${personId}`;
    db.prepare(`INSERT INTO database_info (db_id, root_id, root_name, max_generations, source_provider, person_count)
      VALUES (?, ?, ?, ?, 'test', 1)`).run(dbId, personId, person.display_name, options.maxGenerations ?? 10);
    db.prepare('INSERT INTO database_membership (db_id, person_id, is_root, generation) VALUES (?, ?, 1, 0)').run(dbId, personId);
    return { id: dbId, rootId: personId, rootName: person.display_name, maxGenerations: options.maxGenerations ?? 10, personCount: 1 };
  },
  async updateRoot(dbId: string, updates: { maxGenerations?: number }) {
    db.prepare('UPDATE database_info SET max_generations = @maxGenerations WHERE db_id = @dbId').run({ dbId, maxGenerations: updates.maxGenerations });
    return this.getDatabaseInfo(dbId);
  },
  async refreshRootCount(dbId: string) {
    db.prepare('UPDATE database_info SET person_count = (SELECT COUNT(*) FROM database_membership WHERE db_id = @dbId) WHERE db_id = @dbId').run({ dbId });
    return this.getDatabaseInfo(dbId);
  },
  async calculateMaxGenerations(dbId: string) { return this.getDatabaseInfo(dbId); },
  async getTreeStats() { return { totalPersons: 0 }; },
  async getOnThisDay() { return []; },
  async deleteDatabase(dbId: string) {
    db.prepare('DELETE FROM database_membership WHERE db_id = ?').run(dbId);
    db.prepare('DELETE FROM database_info WHERE db_id = ?').run(dbId);
  },
  async getDatabase(dbId: string) {
    return Object.fromEntries(personRows(db, dbId).map(person => [person.id, person]));
  },
  async getPerson(dbId: string, personId: string) {
    return personRows(db, dbId).find(person => person.id === personId) ?? null;
  },
  async listPersons(dbId: string, options: { page?: number; limit?: number } = {}) {
    const persons = personRows(db, dbId);
    const limit = options.limit ?? 50;
    const page = options.page ?? 1;
    return { persons: persons.slice((page - 1) * limit, page * limit), total: persons.length };
  },
});

const createPersonAdapter = (db: SqliteTestDatabase) => ({
  async listPersons(dbId: string, page: number, limit: number) {
    const people = personRows(db, dbId);
    const total = people.length;
    return { results: people.slice((page - 1) * limit, page * limit), total, page, limit, totalPages: Math.ceil(total / limit) };
  },
  async getPerson(dbId: string, personId: string) {
    return personRows(db, dbId).find(person => person.id === personId) ?? null;
  },
  async getPersonTree() { return null; },
  async inferParentRole(personId: string) {
    const person = db.prepare('SELECT gender FROM person WHERE person_id = ?').get(personId) as { gender: string } | undefined;
    return person?.gender === 'male' ? 'father' : person?.gender === 'female' ? 'mother' : 'parent';
  },
});

const createSearchAdapter = (db: SqliteTestDatabase) => ({
  async search(dbId: string, params: Record<string, unknown>) {
    const rows = personRows(db, dbId).filter(person => {
      const q = typeof params.q === 'string' ? params.q.toLowerCase() : '';
      if (q && !`${person.name} ${person.birthName ?? ''} ${person.bio ?? ''} ${person.occupation ?? ''}`.toLowerCase().includes(q)) return false;
      const location = typeof params.location === 'string' ? params.location.toLowerCase() : '';
      if (location && !(person.birthPlace ?? '').toLowerCase().includes(location)) return false;
      const occupation = typeof params.occupation === 'string' ? params.occupation.toLowerCase() : '';
      if (occupation && !(person.occupation ?? '').toLowerCase().includes(occupation)) return false;
      const birthAfter = Number(params.birthAfter);
      const birthBefore = Number(params.birthBefore);
      if (params.birthAfter && (!person.birthYear || person.birthYear < birthAfter)) return false;
      if (params.birthBefore && (!person.birthYear || person.birthYear > birthBefore)) return false;
      if (typeof params.generationMin === 'number' && (person.generation ?? 0) < params.generationMin) return false;
      if (typeof params.generationMax === 'number' && (person.generation ?? 0) > params.generationMax) return false;
      if (params.hasPhoto === true && !person.hasPhoto) return false;
      if (params.hasBio === true && !person.bio?.trim()) return false;
      return true;
    });
    const page = Number(params.page ?? 1);
    const limit = Number(params.limit ?? 50);
    return { results: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, totalPages: Math.ceil(rows.length / limit) };
  },
  async quickSearch(dbId: string, q: string) {
    if (q.trim().length < 2) return [];
    const result = await this.search(dbId, { q, page: 1, limit: 20 });
    return result.results.map(person => ({ personId: person.id, displayName: person.name, gender: person.gender, birthYear: person.birthYear }));
  },
});

const createFavoritesAdapter = (db: SqliteTestDatabase) => {
  const toFavorite = (row: { db_id: string; person_id: string; why_interesting: string; tags: string | null; added_at: string }) => ({
    dbId: row.db_id, personId: row.person_id, isFavorite: true, whyInteresting: row.why_interesting,
    tags: row.tags ? JSON.parse(row.tags) as string[] : [], addedAt: row.added_at,
  });
  const select = (dbId: string, personId: string) => db.prepare('SELECT * FROM favorite WHERE db_id = ? AND person_id = ?').get(dbId, personId) as
    { db_id: string; person_id: string; why_interesting: string; tags: string | null; added_at: string } | undefined;
  return {
    async listFavorites(page = 1, limit = 50) {
      const rows = db.prepare('SELECT * FROM favorite ORDER BY added_at DESC').all() as Array<{ db_id: string; person_id: string; why_interesting: string; tags: string | null; added_at: string }>;
      return { favorites: rows.slice((page - 1) * limit, page * limit).map(toFavorite), total: rows.length, page, limit, totalPages: Math.ceil(rows.length / limit) };
    },
    async getAllTags() { return PRESET_TAGS; },
    async getFavoritesInDatabase(dbId: string) { return this.listDbFavorites(dbId, 1, 1000).then(result => result.favorites); },
    async listDbFavorites(dbId: string, page = 1, limit = 50) {
      const rows = db.prepare('SELECT * FROM favorite WHERE db_id = ? ORDER BY added_at DESC').all(dbId) as Array<{ db_id: string; person_id: string; why_interesting: string; tags: string | null; added_at: string }>;
      return { favorites: rows.slice((page - 1) * limit, page * limit).map(toFavorite), total: rows.length, page, limit, totalPages: Math.ceil(rows.length / limit) };
    },
    async getDbTags(dbId: string) { return this.listDbFavorites(dbId).then(result => [...new Set([...PRESET_TAGS, ...result.favorites.flatMap(favorite => favorite.tags)])].sort()); },
    async getDbFavorite(dbId: string, personId: string) { const row = select(dbId, personId); return row ? toFavorite(row) : null; },
    async setDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []) {
      db.prepare(`INSERT INTO favorite (db_id, person_id, why_interesting, tags) VALUES (?, ?, ?, ?)
        ON CONFLICT(db_id, person_id) DO UPDATE SET why_interesting = excluded.why_interesting, tags = excluded.tags`).run(dbId, personId, whyInteresting, JSON.stringify(tags));
      return toFavorite(select(dbId, personId)!);
    },
    async updateDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []) {
      if (!select(dbId, personId)) return null;
      return this.setDbFavorite(dbId, personId, whyInteresting, tags);
    },
    async removeDbFavorite(dbId: string, personId: string) { return db.prepare('DELETE FROM favorite WHERE db_id = ? AND person_id = ?').run(dbId, personId).changes > 0; },
    async getFavorite(personId: string) { return this.getDbFavorite('test-db', personId); },
    async setFavorite(personId: string, why: string, tags: string[] = []) { return this.setDbFavorite('test-db', personId, why, tags); },
    async updateFavorite(personId: string, why: string, tags: string[] = []) { return this.updateDbFavorite('test-db', personId, why, tags); },
    async removeFavorite(personId: string) { return this.removeDbFavorite('test-db', personId); },
  };
};

export const createTestApp = (): TestContext => {
  const db = new SqliteTestDatabase();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(TEST_DATABASE_SCHEMA);

  const postgresService = createPostgresAdapter(db);
  const databaseService = createDatabaseAdapter(db);
  const personService = createPersonAdapter(db);
  const searchService = createSearchAdapter(db);
  const favoritesService = createFavoritesAdapter(db);
  const aiDiscovery = { failQuick: false, failStart: false, reset: () => {} };
  let runCounter = 0;
  const activeRuns = new Map<string, string>();
  const progress = new Map<string, unknown>();
  aiDiscovery.reset = () => { activeRuns.clear(); progress.clear(); aiDiscovery.failQuick = false; aiDiscovery.failStart = false; };
  const aiDiscoveryService = {
    async quickDiscovery() {
      if (aiDiscovery.failQuick) throw new Error('Discovery provider failed');
      return { totalAnalyzed: 1, candidates: [] };
    },
    async startDiscovery(dbId: string) {
      if (aiDiscovery.failStart) throw new Error('Discovery provider failed');
      const existing = activeRuns.get(dbId);
      if (existing) throw new DiscoveryRunConflictError(existing);
      const runId = `test-run-${++runCounter}`;
      activeRuns.set(dbId, runId);
      progress.set(runId, { status: 'pending', analyzedPersons: 0 });
      return { runId, message: 'Discovery started' };
    },
    getProgress(runId: string) { return progress.get(runId) ?? null; },
    cancelDiscovery(dbId: string) {
      const runId = activeRuns.get(dbId);
      if (!runId) return null;
      activeRuns.delete(dbId);
      progress.set(runId, { status: 'cancelled' });
      return { runId };
    },
    dismissCandidate() { return { dismissed: true }; },
    dismissCandidatesBatch() { return { dismissed: 0 }; },
    getDismissedCandidates() { return []; },
    getDismissedCount() { return 0; },
    undoDismiss() { return { restored: false }; },
    clearDismissed() { return { cleared: 0 }; },
  };
  const sparseTreeService = {
    async getSparseTree() { return { root: null, nodes: [], totalFavorites: 0 }; },
    async getUnusualDeathTree() { return { root: null, nodes: [], totalFavorites: 0 }; },
  };
  const idMappingService = {
    async resolveId(id: string) {
      const person = db.prepare('SELECT person_id FROM person WHERE person_id = ?').get(id) as { person_id: string } | undefined;
      if (person) return person.person_id;
      const external = db.prepare('SELECT person_id FROM external_identity WHERE external_id = ? AND source = ?').get(id, 'familysearch') as { person_id: string } | undefined;
      return external?.person_id;
    },
    async createPersonStub(name: string, options: { gender?: string } = {}, tx: { run: typeof postgresService.run }) {
      const personId = TEST_PERSON_IDS.stub;
      await tx.run('INSERT INTO person (person_id, display_name, gender, living) VALUES (@id, @name, @gender, 0)', {
        id: personId, name, gender: options.gender ?? 'unknown',
      });
      return personId;
    },
  };
  const databaseRouters = {
    databases: createDatabaseRoutes(databaseService as never),
    persons: createPersonRoutes({
      databaseService: databaseService as never,
      personService: personService as never,
      searchService: searchService as never,
      postgresService: postgresService as never,
      idMappingService: idMappingService as never,
    }),
    search: createSearchRoutes(searchService as never),
    favorites: createFavoritesRouter({ favoritesService: favoritesService as never, sparseTreeService: sparseTreeService as never }),
    aiDiscovery: createAiDiscoveryRouter({ aiDiscoveryService: aiDiscoveryService as never, favoritesService: favoritesService as never }),
  };
  const app = createApp({
    env: { HOST: 'localhost' },
    clientDist: '/nonexistent-test-client-dist',
    aiToolkit: { mountRoutes: () => {} },
    routers: databaseRouters,
  });

  return { app, db, close: () => db.close(), aiDiscovery };
};

/** Seed deterministic fixtures in the isolated in-memory test database. */
export const seedTestData = (db: SqliteTestDatabase, scenario: 'small-tree' | 'empty' = 'small-tree'): void => {
  if (scenario === 'empty') return;
  const ids = TEST_PERSON_IDS;
  const insertPerson = db.prepare(`INSERT INTO person (person_id, display_name, gender, living, bio, birth_name)
    VALUES (?, ?, ?, ?, ?, ?)`);
  insertPerson.run(ids.root, 'John Smith', 'male', 0, 'A test person', 'John Smith');
  insertPerson.run(ids.father, 'James Smith', 'male', 0, 'Father of John', 'James Smith');
  insertPerson.run(ids.mother, 'Mary Jones', 'female', 0, 'Mother of John', 'Mary Jones');
  insertPerson.run(ids.grandfather, 'William Smith', 'male', 0, 'Grandfather', 'William Smith');
  insertPerson.run(ids.grandmother, 'Elizabeth Brown', 'female', 0, 'Grandmother', 'Elizabeth Brown');

  db.prepare(`INSERT INTO database_info (db_id, root_id, root_name, max_generations, source_provider, person_count)
    VALUES ('test-db', ?, 'John Smith', 5, 'familysearch', 5)`).run(ids.root);
  const insertMembership = db.prepare('INSERT INTO database_membership (db_id, person_id, is_root, generation) VALUES (?, ?, ?, ?)');
  insertMembership.run('test-db', ids.root, 1, 0);
  insertMembership.run('test-db', ids.father, 0, 1);
  insertMembership.run('test-db', ids.mother, 0, 1);
  insertMembership.run('test-db', ids.grandfather, 0, 2);
  insertMembership.run('test-db', ids.grandmother, 0, 2);

  const insertParent = db.prepare('INSERT INTO parent_edge (child_id, parent_id, parent_role, source) VALUES (?, ?, ?, ?)');
  insertParent.run(ids.root, ids.father, 'father', 'test');
  insertParent.run(ids.root, ids.mother, 'mother', 'test');
  insertParent.run(ids.father, ids.grandfather, 'father', 'test');
  insertParent.run(ids.father, ids.grandmother, 'mother', 'test');
  db.prepare(`INSERT INTO vital_event (person_id, event_type, date_year, place) VALUES (?, 'birth', 1880, 'London, England')`).run(ids.root);
  db.prepare(`INSERT INTO vital_event (person_id, event_type, date_year, place) VALUES (?, 'birth', 1850, 'York, England')`).run(ids.father);
  db.prepare(`INSERT INTO claim (person_id, predicate, value_text, source) VALUES (?, 'occupation', 'Farmer', 'test')`).run(ids.father);
  db.prepare(`INSERT INTO media (media_id, person_id, source) VALUES ('test-photo', ?, 'test')`).run(ids.root);
};

export default { createTestApp, seedTestData };
