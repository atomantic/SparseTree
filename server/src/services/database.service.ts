import fs from 'fs';
import path from 'path';
import type { Database, DatabaseInfo, Person, PersonWithId } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

// Data directory is at root of project, not in server/
const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
// Sample databases included in the repo
const SAMPLES_DIR = path.resolve(import.meta.dirname, '../../../samples');

// Feature flag: use SQLite when available
let useSqlite = false;

// Initialize SQLite if database exists
function initSqliteIfAvailable(): boolean {
  const dbPath = path.join(DATA_DIR, 'sparsetree.db');
  if (fs.existsSync(dbPath)) {
    sqliteService.initDb();
    const stats = sqliteService.getStats();
    // Only use SQLite if it has data
    if (stats.personCount > 0) {
      useSqlite = true;
      return true;
    }
  }
  return false;
}

// Try to initialize on module load
initSqliteIfAvailable();

// Helper to parse database info from a JSON file (fallback)
function parseDatabaseInfoFromFile(filePath: string, filename: string, isSample = false): DatabaseInfo {
  const match = filename.match(/^db-([^.]+)\.json$/);
  const id = match ? match[1] : filename;

  const content = fs.readFileSync(filePath, 'utf-8');
  const db: Database = JSON.parse(content);
  const personCount = Object.keys(db).length;

  // Extract root ID and max generations from filename
  const parts = id.split('-');
  let rootId = id;
  let maxGenerations: number | undefined;

  if (parts.length > 2 && /^\d+$/.test(parts[parts.length - 1])) {
    const possibleRootId = parts.slice(0, -1).join('-');
    if (db[possibleRootId]) {
      rootId = possibleRootId;
      maxGenerations = parseInt(parts[parts.length - 1]);
    }
  }

  const rootName = db[rootId]?.name;

  return { id, filename, personCount, rootId, rootName, maxGenerations, isSample };
}

// Parse database info from SQLite
function parseDatabaseInfoFromSqlite(dbId: string): DatabaseInfo | null {
  const dbInfo = sqliteService.queryOne<{
    db_id: string;
    root_id: string;
    root_name: string | null;
    source_provider: string | null;
    max_generations: number | null;
    is_sample: number;
  }>('SELECT * FROM database_info WHERE db_id = @dbId', { dbId });

  if (!dbInfo) return null;

  // Get person count
  const countResult = sqliteService.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM database_membership WHERE db_id = @dbId',
    { dbId }
  );

  // Get root's FamilySearch ID for backwards compatibility
  const rootExternal = sqliteService.queryOne<{ external_id: string }>(
    `SELECT external_id FROM external_identity
     WHERE person_id = @rootId AND source = 'familysearch'`,
    { rootId: dbInfo.root_id }
  );

  return {
    id: dbInfo.db_id,
    filename: `db-${dbInfo.db_id}.json`,
    personCount: countResult?.count ?? 0,
    rootId: rootExternal?.external_id ?? dbInfo.root_id,
    rootName: dbInfo.root_name ?? undefined,
    maxGenerations: dbInfo.max_generations ?? undefined,
    sourceProvider: dbInfo.source_provider ?? undefined,
    isSample: dbInfo.is_sample === 1,
  };
}

// Find database file path, checking both data and samples directories
function findDatabasePath(id: string): string | null {
  const filename = `db-${id}.json`;
  const dataPath = path.join(DATA_DIR, filename);
  const samplePath = path.join(SAMPLES_DIR, filename);

  if (fs.existsSync(dataPath)) return dataPath;
  if (fs.existsSync(samplePath)) return samplePath;
  return null;
}

// Build a Person object from SQLite data
function buildPersonFromSqlite(
  personId: string,
  options?: { includeCanonicalId?: boolean }
): Person | null {
  const row = sqliteService.queryOne<{
    person_id: string;
    display_name: string;
    birth_name: string | null;
    gender: string | null;
    living: number;
    bio: string | null;
  }>('SELECT * FROM person WHERE person_id = @personId', { personId });

  if (!row) return null;

  // Get vital events
  const vitalEvents = sqliteService.queryAll<{
    event_type: string;
    date_original: string | null;
    date_formal: string | null;
    place: string | null;
    place_id: string | null;
  }>('SELECT * FROM vital_event WHERE person_id = @personId', { personId });

  const birth = vitalEvents.find((e) => e.event_type === 'birth');
  const death = vitalEvents.find((e) => e.event_type === 'death');
  const burial = vitalEvents.find((e) => e.event_type === 'burial');

  // Get parents (as external FamilySearch IDs for backwards compatibility)
  const parentEdges = sqliteService.queryAll<{
    parent_id: string;
    parent_role: string;
  }>(
    `SELECT parent_id, parent_role FROM parent_edge WHERE child_id = @personId ORDER BY parent_role`,
    { personId }
  );

  const parents: string[] = [];
  for (const edge of parentEdges) {
    // Get FamilySearch ID for the parent
    const extId = sqliteService.queryOne<{ external_id: string }>(
      `SELECT external_id FROM external_identity
       WHERE person_id = @parentId AND source = 'familysearch'`,
      { parentId: edge.parent_id }
    );
    if (extId) {
      if (edge.parent_role === 'father') {
        parents[0] = extId.external_id;
      } else if (edge.parent_role === 'mother') {
        parents[1] = extId.external_id;
      } else {
        parents.push(extId.external_id);
      }
    }
  }

  // Get children
  const childEdges = sqliteService.queryAll<{ child_id: string }>(
    'SELECT child_id FROM parent_edge WHERE parent_id = @personId',
    { personId }
  );

  const children: string[] = [];
  for (const edge of childEdges) {
    const extId = sqliteService.queryOne<{ external_id: string }>(
      `SELECT external_id FROM external_identity
       WHERE person_id = @childId AND source = 'familysearch'`,
      { childId: edge.child_id }
    );
    if (extId) {
      children.push(extId.external_id);
    }
  }

  // Get spouses
  const spouseEdges = sqliteService.queryAll<{ person1_id: string; person2_id: string }>(
    `SELECT person1_id, person2_id FROM spouse_edge
     WHERE person1_id = @personId OR person2_id = @personId`,
    { personId }
  );

  const spouses: string[] = [];
  for (const edge of spouseEdges) {
    const spouseCanonicalId = edge.person1_id === personId ? edge.person2_id : edge.person1_id;
    const extId = sqliteService.queryOne<{ external_id: string }>(
      `SELECT external_id FROM external_identity
       WHERE person_id = @spouseId AND source = 'familysearch'`,
      { spouseId: spouseCanonicalId }
    );
    if (extId) {
      spouses.push(extId.external_id);
    }
  }

  // Get claims (occupations, aliases, religion)
  const claims = sqliteService.queryAll<{
    predicate: string;
    value_text: string | null;
  }>('SELECT predicate, value_text FROM claim WHERE person_id = @personId', { personId });

  const occupations = claims.filter((c) => c.predicate === 'occupation').map((c) => c.value_text!);
  const aliases = claims.filter((c) => c.predicate === 'alias').map((c) => c.value_text!);
  const religion = claims.find((c) => c.predicate === 'religion')?.value_text;

  // Build lifespan string
  const birthYear = birth?.date_original?.match(/\d{4}/)?.at(0) ?? '';
  const deathYear = death?.date_original?.match(/\d{4}/)?.at(0) ?? '';
  const lifespan = birthYear || deathYear ? `${birthYear}-${deathYear}` : '';

  // Build location (first available place)
  const location = birth?.place ?? death?.place ?? undefined;

  const person: Person = {
    name: row.display_name,
    birthName: row.birth_name ?? undefined,
    aliases: aliases.length > 0 ? aliases : undefined,
    gender: (row.gender as 'male' | 'female' | 'unknown') ?? 'unknown',
    living: row.living === 1,
    birth: birth
      ? {
          date: birth.date_original ?? undefined,
          dateFormal: birth.date_formal ?? undefined,
          place: birth.place ?? undefined,
          placeId: birth.place_id ?? undefined,
        }
      : undefined,
    death: death
      ? {
          date: death.date_original ?? undefined,
          dateFormal: death.date_formal ?? undefined,
          place: death.place ?? undefined,
          placeId: death.place_id ?? undefined,
        }
      : undefined,
    burial: burial
      ? {
          date: burial.date_original ?? undefined,
          dateFormal: burial.date_formal ?? undefined,
          place: burial.place ?? undefined,
          placeId: burial.place_id ?? undefined,
        }
      : undefined,
    occupations: occupations.length > 0 ? occupations : undefined,
    religion: religion ?? undefined,
    bio: row.bio ?? undefined,
    parents: parents.filter(Boolean),
    children,
    spouses: spouses.length > 0 ? spouses : undefined,
    lifespan,
    location,
    occupation: occupations[0] ?? undefined,
  };

  if (options?.includeCanonicalId) {
    person.canonicalId = row.person_id;
  }

  return person;
}

export const databaseService = {
  /**
   * Check if SQLite is being used
   */
  isSqliteEnabled(): boolean {
    return useSqlite;
  },

  /**
   * Enable or disable SQLite (for testing/fallback)
   */
  setSqliteEnabled(enabled: boolean): void {
    useSqlite = enabled;
  },

  /**
   * Re-initialize SQLite connection
   */
  reinitialize(): boolean {
    return initSqliteIfAvailable();
  },

  async listDatabases(): Promise<DatabaseInfo[]> {
    const results: DatabaseInfo[] = [];
    const seenIds = new Set<string>();

    // Try SQLite first
    if (useSqlite) {
      const dbInfos = sqliteService.queryAll<{ db_id: string }>(
        'SELECT db_id FROM database_info ORDER BY updated_at DESC'
      );

      for (const { db_id } of dbInfos) {
        const info = parseDatabaseInfoFromSqlite(db_id);
        if (info) {
          results.push(info);
          seenIds.add(info.id);
        }
      }
    }

    // Fall back to / supplement with JSON files
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      const dbFiles = files.filter((f) => f.startsWith('db-') && f.endsWith('.json'));

      for (const filename of dbFiles) {
        const match = filename.match(/^db-([^.]+)\.json$/);
        const id = match ? match[1] : filename;

        if (seenIds.has(id)) continue;

        const filePath = path.join(DATA_DIR, filename);
        const info = parseDatabaseInfoFromFile(filePath, filename, false);
        results.push(info);
        seenIds.add(info.id);
      }
    }

    // Load from samples directory (bundled sample databases)
    if (fs.existsSync(SAMPLES_DIR)) {
      const files = fs.readdirSync(SAMPLES_DIR);
      const dbFiles = files.filter((f) => f.startsWith('db-') && f.endsWith('.json'));

      for (const filename of dbFiles) {
        const match = filename.match(/^db-([^.]+)\.json$/);
        const id = match ? match[1] : filename;

        if (seenIds.has(id)) continue;

        const filePath = path.join(SAMPLES_DIR, filename);
        const info = parseDatabaseInfoFromFile(filePath, filename, true);
        results.push(info);
      }
    }

    return results;
  },

  async getDatabaseInfo(id: string): Promise<DatabaseInfo> {
    // Try SQLite first
    if (useSqlite) {
      const info = parseDatabaseInfoFromSqlite(id);
      if (info) return info;
    }

    // Fall back to JSON
    const filename = `db-${id}.json`;
    const filePath = findDatabasePath(id);

    if (!filePath) {
      throw new Error(`Database ${id} not found`);
    }

    const isSample = filePath.includes(SAMPLES_DIR);
    return parseDatabaseInfoFromFile(filePath, filename, isSample);
  },

  async getDatabase(id: string): Promise<Database> {
    // Try SQLite first
    if (useSqlite) {
      // Check if database exists in SQLite
      const dbExists = sqliteService.queryOne<{ db_id: string }>(
        'SELECT db_id FROM database_info WHERE db_id = @id',
        { id }
      );

      if (dbExists) {
        // Get all persons in this database
        const memberships = sqliteService.queryAll<{ person_id: string }>(
          'SELECT person_id FROM database_membership WHERE db_id = @id',
          { id }
        );

        const db: Database = {};

        for (const { person_id } of memberships) {
          // Get FamilySearch ID for backwards compatibility
          const extId = sqliteService.queryOne<{ external_id: string }>(
            `SELECT external_id FROM external_identity
             WHERE person_id = @personId AND source = 'familysearch'`,
            { personId: person_id }
          );

          const fsId = extId?.external_id ?? person_id;
          const person = buildPersonFromSqlite(person_id, { includeCanonicalId: true });

          if (person) {
            db[fsId] = person;
          }
        }

        return db;
      }
    }

    // Fall back to JSON
    const filePath = findDatabasePath(id);

    if (!filePath) {
      throw new Error(`Database ${id} not found`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  },

  /**
   * Get a single person by ID (FamilySearch ID or canonical ULID)
   */
  async getPerson(dbId: string, personId: string): Promise<PersonWithId | null> {
    if (useSqlite) {
      // Try to resolve the ID
      let canonicalId = idMappingService.resolveId(personId, 'familysearch');

      // If not found, check if it's directly in the database membership
      if (!canonicalId) {
        const membership = sqliteService.queryOne<{ person_id: string }>(
          `SELECT person_id FROM database_membership
           WHERE db_id = @dbId AND person_id = @personId`,
          { dbId, personId }
        );
        if (membership) {
          canonicalId = membership.person_id;
        }
      }

      if (canonicalId) {
        const person = buildPersonFromSqlite(canonicalId, { includeCanonicalId: true });
        if (person) {
          // Get FamilySearch ID for the `id` field
          const extId = idMappingService.getExternalId(canonicalId, 'familysearch');
          return {
            ...person,
            id: extId ?? canonicalId,
          };
        }
      }
    }

    // Fall back to JSON
    const db = await this.getDatabase(dbId);
    const person = db[personId];
    if (!person) return null;

    return { ...person, id: personId };
  },

  async deleteDatabase(id: string): Promise<void> {
    const filename = `db-${id}.json`;
    const dataPath = path.join(DATA_DIR, filename);
    const samplePath = path.join(SAMPLES_DIR, filename);

    // Only allow deleting user databases, not samples
    if (fs.existsSync(samplePath) && !fs.existsSync(dataPath)) {
      throw new Error(`Cannot delete sample database ${id}`);
    }

    // Delete from SQLite if enabled
    if (useSqlite) {
      sqliteService.transaction(() => {
        // Delete memberships first (foreign key constraint)
        sqliteService.run('DELETE FROM database_membership WHERE db_id = @id', { id });
        // Delete favorites
        sqliteService.run('DELETE FROM favorite WHERE db_id = @id', { id });
        // Delete database info
        sqliteService.run('DELETE FROM database_info WHERE db_id = @id', { id });
      });
    }

    // Delete JSON file
    if (fs.existsSync(dataPath)) {
      fs.unlinkSync(dataPath);
    }
  },

  /**
   * Get all persons in a database with pagination (SQLite-optimized)
   */
  async listPersons(
    dbId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ persons: PersonWithId[]; total: number }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 100;
    const offset = (page - 1) * limit;

    if (useSqlite) {
      // Get total count
      const countResult = sqliteService.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM database_membership WHERE db_id = @dbId',
        { dbId }
      );
      const total = countResult?.count ?? 0;

      // Get paginated person IDs
      const memberships = sqliteService.queryAll<{ person_id: string }>(
        `SELECT dm.person_id
         FROM database_membership dm
         JOIN person p ON dm.person_id = p.person_id
         WHERE dm.db_id = @dbId
         ORDER BY p.display_name
         LIMIT @limit OFFSET @offset`,
        { dbId, limit, offset }
      );

      const persons: PersonWithId[] = [];
      for (const { person_id } of memberships) {
        const person = buildPersonFromSqlite(person_id, { includeCanonicalId: true });
        if (person) {
          const extId = idMappingService.getExternalId(person_id, 'familysearch');
          persons.push({
            ...person,
            id: extId ?? person_id,
          });
        }
      }

      return { persons, total };
    }

    // Fall back to JSON (load all, then paginate in memory)
    const db = await this.getDatabase(dbId);
    const allIds = Object.keys(db);
    const total = allIds.length;

    const paginatedIds = allIds.slice(offset, offset + limit);
    const persons = paginatedIds.map((id) => ({
      ...db[id],
      id,
    }));

    return { persons, total };
  },

  /**
   * Check if a person exists in a database
   */
  async personExists(dbId: string, personId: string): Promise<boolean> {
    if (useSqlite) {
      const canonicalId = idMappingService.resolveId(personId, 'familysearch');
      if (!canonicalId) return false;

      const result = sqliteService.queryOne<{ person_id: string }>(
        `SELECT person_id FROM database_membership
         WHERE db_id = @dbId AND person_id = @canonicalId`,
        { dbId, canonicalId }
      );
      return !!result;
    }

    const db = await this.getDatabase(dbId);
    return personId in db;
  },
};
