/**
 * Test database utilities for integration tests
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'server', 'src', 'db', 'schema.sql');

export interface TestDatabase {
  db: Database.Database;
  close: () => void;
}

/**
 * Create an in-memory SQLite database for testing
 */
export const createTestDatabase = (): TestDatabase => {
  const db = new Database(':memory:');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Load and execute schema
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  return {
    db,
    close: () => db.close(),
  };
};

/**
 * Seed the test database with sample data
 */
export const seedTestDatabase = (db: Database.Database, seed: 'small-tree' | 'cyclic-tree' | 'empty' = 'small-tree'): void => {
  if (seed === 'empty') return;

  if (seed === 'small-tree') {
    // Insert sample persons
    const insertPerson = db.prepare(`
      INSERT INTO person (id, display_name, gender, living, lifespan, birth_date, death_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertExternalId = db.prepare(`
      INSERT INTO external_identity (canonical_id, provider, provider_id)
      VALUES (?, ?, ?)
    `);

    const insertParentEdge = db.prepare(`
      INSERT INTO parent_edge (child_id, parent_id, provider)
      VALUES (?, ?, ?)
    `);

    // Root person
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'John Smith', 'male', 0, '1900-1980', '1900-01-01', '1980-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'familysearch', 'KLGP-T38');

    // Father
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'James Smith', 'male', 0, '1870-1950', '1870-01-01', '1950-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'familysearch', 'KLGP-FA1');

    // Mother
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'Mary Jones', 'female', 0, '1875-1955', '1875-01-01', '1955-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'familysearch', 'KLGP-FA2');

    // Grandfather (paternal)
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FA3', 'William Smith', 'male', 0, '1840-1920', '1840-01-01', '1920-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FA3', 'familysearch', 'KLGP-GF1');

    // Grandmother (paternal)
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FA4', 'Elizabeth Brown', 'female', 0, '1845-1925', '1845-01-01', '1925-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FA4', 'familysearch', 'KLGP-GM1');

    // Child of John
    insertPerson.run('01ARZ3NDEKTSV4RRFFQ69G5FA5', 'Robert Smith', 'male', 0, '1925-2005', '1925-01-01', '2005-12-31');
    insertExternalId.run('01ARZ3NDEKTSV4RRFFQ69G5FA5', 'familysearch', 'KLGP-CH1');

    // Parent relationships
    insertParentEdge.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FA1', 'familysearch'); // John's father
    insertParentEdge.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FA2', 'familysearch'); // John's mother
    insertParentEdge.run('01ARZ3NDEKTSV4RRFFQ69G5FA1', '01ARZ3NDEKTSV4RRFFQ69G5FA3', 'familysearch'); // Father's father
    insertParentEdge.run('01ARZ3NDEKTSV4RRFFQ69G5FA1', '01ARZ3NDEKTSV4RRFFQ69G5FA4', 'familysearch'); // Father's mother
    insertParentEdge.run('01ARZ3NDEKTSV4RRFFQ69G5FA5', '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'familysearch'); // Child's parent (John)
  }

  if (seed === 'cyclic-tree') {
    // Insert sample persons with a cycle for testing cycle detection
    const insertPerson = db.prepare(`
      INSERT INTO person (id, display_name, gender, living, lifespan)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertParentEdge = db.prepare(`
      INSERT INTO parent_edge (child_id, parent_id, provider)
      VALUES (?, ?, ?)
    `);

    insertPerson.run('CYCLE-A', 'Person A', 'male', 0, '1900-1980');
    insertPerson.run('CYCLE-B', 'Person B', 'male', 0, '1920-2000');
    insertPerson.run('CYCLE-C', 'Person C', 'male', 0, '1940-2020');

    // Normal relationship: A is parent of B, B is parent of C
    insertParentEdge.run('CYCLE-B', 'CYCLE-A', 'test');
    insertParentEdge.run('CYCLE-C', 'CYCLE-B', 'test');
    // Cyclic: C is also parent of A (impossible but used to test cycle detection)
    insertParentEdge.run('CYCLE-A', 'CYCLE-C', 'test');
  }
};

/**
 * Setup test database with optional seeding
 */
export const setupTestDatabase = (seed: 'small-tree' | 'cyclic-tree' | 'empty' = 'small-tree'): TestDatabase => {
  const testDb = createTestDatabase();
  seedTestDatabase(testDb.db, seed);
  return testDb;
};

/**
 * Teardown test database
 */
export const teardownTestDatabase = (testDb: TestDatabase): void => {
  testDb.close();
};

/**
 * Reset database to clean state (for use between tests)
 */
export const resetDatabase = (db: Database.Database): void => {
  // Get all table names
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  // Delete all data from each table
  for (const { name } of tables) {
    db.exec(`DELETE FROM ${name}`);
  }
};

export default {
  createTestDatabase,
  seedTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  resetDatabase,
};
