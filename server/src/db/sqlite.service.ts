import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database file location
const DATA_DIR = path.resolve(__dirname, '../../../data');
const DB_PATH = path.join(DATA_DIR, 'sparsetree.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Initialize SQLite database connection and schema
 */
function initDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Create database connection
  db = new Database(DB_PATH, {
    verbose: process.env.SQLITE_VERBOSE ? console.log : undefined,
  });

  // Performance optimizations
  db.pragma('journal_mode = WAL');          // Write-Ahead Logging for better concurrency
  db.pragma('synchronous = NORMAL');        // Balance between safety and speed
  db.pragma('foreign_keys = ON');           // Enforce foreign key constraints
  db.pragma('cache_size = -64000');         // 64MB cache
  db.pragma('temp_store = MEMORY');         // Store temp tables in memory

  // Apply schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  return db;
}

/**
 * Get the database instance (initializes if needed)
 */
function getDb(): Database.Database {
  return initDb();
}

/**
 * Close the database connection
 */
function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a query and return all results
 */
function queryAll<T>(sql: string, params?: Record<string, unknown>): T[] {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.all(params) : stmt.all()) as T[];
}

/**
 * Run a query and return first result
 */
function queryOne<T>(sql: string, params?: Record<string, unknown>): T | undefined {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.get(params) : stmt.get()) as T | undefined;
}

/**
 * Run a mutation (INSERT, UPDATE, DELETE) and return changes info
 */
function run(sql: string, params?: Record<string, unknown>): Database.RunResult {
  const stmt = getDb().prepare(sql);
  return params ? stmt.run(params) : stmt.run();
}

/**
 * Execute multiple statements in a transaction
 */
function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

/**
 * Batch insert multiple rows
 */
function batchInsert<T extends Record<string, unknown>>(
  tableName: string,
  rows: T[],
  options?: { orReplace?: boolean; orIgnore?: boolean }
): number {
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((col) => `@${col}`).join(', ');
  const conflict = options?.orReplace ? 'OR REPLACE' : options?.orIgnore ? 'OR IGNORE' : '';

  const sql = `INSERT ${conflict} INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
  const stmt = getDb().prepare(sql);

  let inserted = 0;
  transaction(() => {
    for (const row of rows) {
      const result = stmt.run(row);
      inserted += result.changes;
    }
  });

  return inserted;
}

/**
 * Check if a table exists
 */
function tableExists(tableName: string): boolean {
  const result = queryOne<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=@tableName",
    { tableName }
  );
  return !!result;
}

/**
 * Check if a migration has been applied
 */
function migrationApplied(name: string): boolean {
  const result = queryOne<{ id: number }>(
    'SELECT id FROM migration WHERE name = @name',
    { name }
  );
  return !!result;
}

/**
 * Mark a migration as applied
 */
function recordMigration(name: string): void {
  run('INSERT INTO migration (name) VALUES (@name)', { name });
}

/**
 * Get database statistics
 */
function getStats(): {
  personCount: number;
  externalIdCount: number;
  parentEdgeCount: number;
  favoriteCount: number;
  databaseCount: number;
} {
  return {
    personCount: queryOne<{ count: number }>('SELECT COUNT(*) as count FROM person')?.count ?? 0,
    externalIdCount: queryOne<{ count: number }>('SELECT COUNT(*) as count FROM external_identity')?.count ?? 0,
    parentEdgeCount: queryOne<{ count: number }>('SELECT COUNT(*) as count FROM parent_edge')?.count ?? 0,
    favoriteCount: queryOne<{ count: number }>('SELECT COUNT(*) as count FROM favorite')?.count ?? 0,
    databaseCount: queryOne<{ count: number }>('SELECT COUNT(*) as count FROM database_info')?.count ?? 0,
  };
}

/**
 * Rebuild FTS index for a person
 */
function updatePersonFts(
  personId: string,
  displayName: string,
  birthName?: string,
  aliases?: string[],
  bio?: string,
  occupations?: string[]
): void {
  // Delete existing entry
  run('DELETE FROM person_fts WHERE person_id = @personId', { personId });

  // Insert new entry
  run(
    `INSERT INTO person_fts (person_id, display_name, birth_name, aliases, bio, occupations)
     VALUES (@personId, @displayName, @birthName, @aliases, @bio, @occupations)`,
    {
      personId,
      displayName,
      birthName: birthName ?? '',
      aliases: aliases?.join(' ') ?? '',
      bio: bio ?? '',
      occupations: occupations?.join(' ') ?? '',
    }
  );
}

/**
 * Full-text search across persons
 */
function searchPersonsFts(
  query: string,
  options?: { limit?: number; offset?: number }
): { personId: string; rank: number }[] {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  // Use MATCH for FTS5 query syntax
  return queryAll<{ person_id: string; rank: number }>(
    `SELECT person_id, rank
     FROM person_fts
     WHERE person_fts MATCH @query
     ORDER BY rank
     LIMIT @limit OFFSET @offset`,
    { query, limit, offset }
  ).map((row) => ({ personId: row.person_id, rank: row.rank }));
}

/**
 * Vacuum the database to reclaim space
 */
function vacuum(): void {
  getDb().exec('VACUUM');
}

/**
 * Export the database to a backup file
 */
async function backup(backupPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getDb().backup(backupPath).then(() => resolve()).catch(reject);
  });
}

export const sqliteService = {
  initDb,
  getDb,
  closeDb,
  queryAll,
  queryOne,
  run,
  transaction,
  batchInsert,
  tableExists,
  migrationApplied,
  recordMigration,
  getStats,
  updatePersonFts,
  searchPersonsFts,
  vacuum,
  backup,
  DB_PATH,
  DATA_DIR,
};
