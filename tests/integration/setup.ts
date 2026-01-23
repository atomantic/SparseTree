/**
 * Integration test setup
 * Creates a test Express app with routes for API testing
 */

import express, { Express, NextFunction, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'server', 'src', 'db', 'schema.sql');

export interface TestContext {
  app: Express;
  db: Database.Database;
  close: () => void;
}

/**
 * Create a test Express app with an in-memory database
 */
export const createTestApp = (): TestContext => {
  // Create in-memory SQLite database
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Load and execute schema
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // Create Express app
  const app = express();
  app.use(express.json());

  // Health check route
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Simple test routes that use the in-memory db
  // Note: These are simplified versions for testing - the real app uses services

  // GET /api/databases - List databases
  app.get('/api/databases', (_req, res) => {
    const databases = db.prepare(`
      SELECT db_id as id, root_name as rootName, max_generations as generations, is_sample as isSample
      FROM database_info
    `).all();
    res.json({ success: true, data: databases });
  });

  // POST /api/databases - Create database
  app.post('/api/databases', (req, res) => {
    const { dbId, rootId, rootName, maxGenerations, sourceProvider } = req.body;
    if (!dbId || !rootId || !rootName) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // First create the root person if it doesn't exist
    const existingPerson = db.prepare('SELECT person_id FROM person WHERE person_id = ?').get(rootId);
    if (!existingPerson) {
      db.prepare(`
        INSERT INTO person (person_id, display_name, gender, living)
        VALUES (?, ?, 'unknown', 0)
      `).run(rootId, rootName);
    }

    // Then create the database entry
    db.prepare(`
      INSERT INTO database_info (db_id, root_id, root_name, max_generations, source_provider)
      VALUES (?, ?, ?, ?, ?)
    `).run(dbId, rootId, rootName, maxGenerations || 10, sourceProvider || 'test');

    res.json({ success: true, data: { dbId, rootName } });
  });

  // GET /api/persons/:dbId - List persons in database
  app.get('/api/persons/:dbId', (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const persons = db.prepare(`
      SELECT p.person_id as id, p.display_name as name, p.gender, p.living, p.bio
      FROM person p
      JOIN database_membership dm ON p.person_id = dm.person_id
      WHERE dm.db_id = ?
      LIMIT ? OFFSET ?
    `).all(req.params.dbId, limit, offset);

    const countResult = db.prepare(`
      SELECT COUNT(*) as total
      FROM database_membership
      WHERE db_id = ?
    `).get(req.params.dbId) as { total: number };

    res.json({
      success: true,
      data: {
        persons,
        pagination: {
          page,
          limit,
          total: countResult?.total || 0,
          totalPages: Math.ceil((countResult?.total || 0) / limit)
        }
      }
    });
  });

  // GET /api/persons/:dbId/:personId - Get single person
  app.get('/api/persons/:dbId/:personId', (req, res) => {
    const person = db.prepare(`
      SELECT p.person_id as id, p.display_name as name, p.gender, p.living, p.bio
      FROM person p
      JOIN database_membership dm ON p.person_id = dm.person_id
      WHERE dm.db_id = ? AND p.person_id = ?
    `).get(req.params.dbId, req.params.personId) as Record<string, unknown> | undefined;

    if (!person) {
      return res.status(404).json({ success: false, error: 'Person not found' });
    }

    res.json({ success: true, data: person });
  });

  // GET /api/search/:dbId - Search persons
  app.get('/api/search/:dbId', (req, res) => {
    const q = (req.query.q as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    // Simple search implementation
    let sql = `
      SELECT p.person_id as id, p.display_name as name, p.gender, p.living
      FROM person p
      JOIN database_membership dm ON p.person_id = dm.person_id
      WHERE dm.db_id = ?
    `;
    const params: (string | number)[] = [req.params.dbId];

    if (q) {
      sql += ` AND p.display_name LIKE ?`;
      params.push(`%${q}%`);
    }

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const results = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data: {
        results,
        pagination: { page, limit, total: results.length }
      }
    });
  });

  // GET /api/favorites - List all favorites
  app.get('/api/favorites', (_req, res) => {
    const favorites = db.prepare(`
      SELECT f.person_id as personId, f.db_id as dbId, f.why_interesting as whyInteresting, f.tags
      FROM favorite f
    `).all();

    res.json({
      success: true,
      data: {
        favorites: favorites.map((f: Record<string, unknown>) => ({
          ...f,
          tags: f.tags ? JSON.parse(f.tags as string) : []
        }))
      }
    });
  });

  // POST /api/favorites/db/:dbId/:personId - Add favorite
  app.post('/api/favorites/db/:dbId/:personId', (req, res) => {
    const { dbId, personId } = req.params;
    const { whyInteresting, tags } = req.body;

    if (!whyInteresting) {
      return res.status(400).json({ success: false, error: 'whyInteresting is required' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO favorite (db_id, person_id, why_interesting, tags)
      VALUES (?, ?, ?, ?)
    `).run(dbId, personId, whyInteresting, JSON.stringify(tags || []));

    res.json({
      success: true,
      data: { favorite: { dbId, personId, whyInteresting, tags: tags || [] } }
    });
  });

  // DELETE /api/favorites/db/:dbId/:personId - Remove favorite
  app.delete('/api/favorites/db/:dbId/:personId', (req, res) => {
    const { dbId, personId } = req.params;

    const result = db.prepare(`
      DELETE FROM favorite WHERE db_id = ? AND person_id = ?
    `).run(dbId, personId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Person is not a favorite' });
    }

    res.json({ success: true, data: { removed: true } });
  });

  // AI Discovery routes (simplified for testing)
  // Note: Quick and full discovery are not tested here as they require the Claude CLI

  // GET /api/ai-discovery/progress/:runId - Get progress of a discovery run
  app.get('/api/ai-discovery/progress/:runId', (req, res) => {
    // For testing, we always return not found since we don't have real runs
    res.status(404).json({ success: false, error: 'Run not found' });
  });

  // POST /api/ai-discovery/:dbId/apply - Apply a candidate as favorite
  app.post('/api/ai-discovery/:dbId/apply', (req, res) => {
    const { dbId } = req.params;
    const { personId, whyInteresting, tags } = req.body;

    if (!personId || !whyInteresting) {
      return res.status(400).json({ success: false, error: 'personId and whyInteresting are required' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO favorite (db_id, person_id, why_interesting, tags)
      VALUES (?, ?, ?, ?)
    `).run(dbId, personId, whyInteresting, JSON.stringify(Array.isArray(tags) ? tags : []));

    res.json({ success: true, data: { applied: true } });
  });

  // POST /api/ai-discovery/:dbId/apply-batch - Apply multiple candidates as favorites
  app.post('/api/ai-discovery/:dbId/apply-batch', (req, res) => {
    const { dbId } = req.params;
    const { candidates } = req.body;

    if (!Array.isArray(candidates)) {
      return res.status(400).json({ success: false, error: 'candidates array is required' });
    }

    let applied = 0;
    for (const candidate of candidates) {
      if (candidate.personId && candidate.whyInteresting) {
        db.prepare(`
          INSERT OR REPLACE INTO favorite (db_id, person_id, why_interesting, tags)
          VALUES (?, ?, ?, ?)
        `).run(dbId, candidate.personId, candidate.whyInteresting, JSON.stringify(Array.isArray(candidate.suggestedTags) ? candidate.suggestedTags : []));
        applied++;
      }
    }

    res.json({ success: true, data: { applied } });
  });

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Test app error:', err);
    res.status(500).json({ success: false, error: err.message });
  });

  return {
    app,
    db,
    close: () => db.close()
  };
};

/**
 * Seed the test database with sample data
 */
export const seedTestData = (db: Database.Database, scenario: 'small-tree' | 'empty' = 'small-tree'): void => {
  if (scenario === 'empty') return;

  // Create persons first (before database_info due to FK constraint)
  const insertPerson = db.prepare(`
    INSERT INTO person (person_id, display_name, gender, living, bio)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Root person
  insertPerson.run('PERSON-001', 'John Smith', 'male', 0, 'A test person');

  // Father
  insertPerson.run('PERSON-002', 'James Smith', 'male', 0, 'Father of John');

  // Mother
  insertPerson.run('PERSON-003', 'Mary Jones', 'female', 0, 'Mother of John');

  // Grandfather
  insertPerson.run('PERSON-004', 'William Smith', 'male', 0, 'Grandfather');

  // Grandmother
  insertPerson.run('PERSON-005', 'Elizabeth Brown', 'female', 0, 'Grandmother');

  // Create test database entry (after persons exist)
  db.prepare(`
    INSERT INTO database_info (db_id, root_id, root_name, max_generations, source_provider)
    VALUES (?, ?, ?, ?, ?)
  `).run('test-db', 'PERSON-001', 'John Smith', 5, 'familysearch');

  // Create memberships
  const insertMembership = db.prepare(`
    INSERT INTO database_membership (db_id, person_id, is_root, generation)
    VALUES (?, ?, ?, ?)
  `);

  insertMembership.run('test-db', 'PERSON-001', 1, 0);
  insertMembership.run('test-db', 'PERSON-002', 0, 1);
  insertMembership.run('test-db', 'PERSON-003', 0, 1);
  insertMembership.run('test-db', 'PERSON-004', 0, 2);
  insertMembership.run('test-db', 'PERSON-005', 0, 2);

  // Create parent edges
  const insertParentEdge = db.prepare(`
    INSERT INTO parent_edge (child_id, parent_id, parent_role, source)
    VALUES (?, ?, ?, ?)
  `);

  insertParentEdge.run('PERSON-001', 'PERSON-002', 'father', 'test');
  insertParentEdge.run('PERSON-001', 'PERSON-003', 'mother', 'test');
  insertParentEdge.run('PERSON-002', 'PERSON-004', 'father', 'test');
  insertParentEdge.run('PERSON-002', 'PERSON-005', 'mother', 'test');
};

export default {
  createTestApp,
  seedTestData
};
