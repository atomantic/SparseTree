import fs from 'fs';
import path from 'path';
import type { Database, DatabaseInfo, Person, PersonWithId } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { scraperService } from './scraper.service.js';
import { localOverrideService } from './local-override.service.js';

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

// Parse root info from SQLite
function parseDatabaseInfoFromSqlite(rootId: string): DatabaseInfo | null {
  const rootInfo = sqliteService.queryOne<{
    db_id: string;
    root_id: string;
    root_name: string | null;
    source_provider: string | null;
    max_generations: number | null;
    is_sample: number;
    person_count: number;
  }>('SELECT * FROM database_info WHERE db_id = @rootId', { rootId });

  if (!rootInfo) return null;

  // Get all external IDs for this root person
  const externalIdsMap = idMappingService.getExternalIds(rootInfo.root_id);
  const externalIds: Record<string, string> = {};
  for (const [source, extId] of externalIdsMap) {
    externalIds[source] = extId;
  }

  // Check if this root person has a photo
  const hasPhoto = scraperService.hasPhoto(rootInfo.root_id);

  return {
    id: rootInfo.root_id, // Root person's ULID for URL routing
    filename: `root-${rootInfo.root_id}.json`, // Not used for SQLite
    personCount: rootInfo.person_count || 1, // Use cached count
    rootId: rootInfo.root_id,
    rootExternalId: externalIds.familysearch, // FamilySearch ID for display (legacy)
    externalIds: Object.keys(externalIds).length > 0 ? externalIds : undefined,
    rootName: rootInfo.root_name ?? undefined,
    maxGenerations: rootInfo.max_generations ?? undefined,
    sourceProvider: rootInfo.source_provider ?? undefined,
    isSample: rootInfo.is_sample === 1,
    hasPhoto,
  };
}

/**
 * Resolve root ID to the canonical person ID.
 * Since we now use root_id as the primary key (db_id = root_id), this is simpler.
 * Also accepts FamilySearch IDs and resolves them to canonical ULIDs.
 */
export function resolveDbId(id: string): string | null {
  if (!useSqlite) return id; // Fallback to JSON - use as-is

  // First try direct match on db_id (which is now the root person's ULID)
  const byDbId = sqliteService.queryOne<{ db_id: string }>(
    'SELECT db_id FROM database_info WHERE db_id = @id',
    { id }
  );
  if (byDbId) return byDbId.db_id;

  // Try to find by FamilySearch ID (resolve to canonical then check if it's a root)
  const canonical = idMappingService.resolveId(id, 'familysearch');
  if (canonical) {
    const byCanonical = sqliteService.queryOne<{ db_id: string }>(
      'SELECT db_id FROM database_info WHERE db_id = @id',
      { id: canonical }
    );
    if (byCanonical) return byCanonical.db_id;
  }

  return null;
}

/**
 * Get canonical root ID from internal db_id.
 * Since db_id = root_id now, this is essentially an identity function,
 * but kept for API compatibility.
 */
export function getCanonicalDbId(internalDbId: string): string {
  return internalDbId; // db_id === root_id in the new schema
}

// Find database file path, checking both data and samples directories
function findDatabasePath(id: string): string | null {
  // Try to resolve to legacy db_id for file lookup
  const legacyId = resolveDbId(id) || id;
  const filename = `db-${legacyId}.json`;
  const dataPath = path.join(DATA_DIR, filename);
  const samplePath = path.join(SAMPLES_DIR, filename);

  if (fs.existsSync(dataPath)) return dataPath;
  if (fs.existsSync(samplePath)) return samplePath;
  return null;
}

/**
 * Apply local overrides to a Person object
 * Modifies the person in place to reflect user overrides
 */
function applyLocalOverridesToPerson(person: Person, personId: string): void {
  // Get person-level overrides (name, gender)
  const personOverrides = localOverrideService.getOverridesForEntity('person', personId);
  for (const override of personOverrides) {
    if (override.fieldName === 'name' && override.overrideValue) {
      person.name = override.overrideValue;
    } else if (override.fieldName === 'gender' && override.overrideValue) {
      person.gender = override.overrideValue as 'male' | 'female' | 'unknown';
    }
  }

  // Get vital event IDs for this person and check for overrides
  const vitalEventIds = sqliteService.queryAll<{ id: number; event_type: string }>(
    `SELECT id, event_type FROM vital_event WHERE person_id = @personId`,
    { personId }
  );

  for (const event of vitalEventIds) {
    const eventOverrides = localOverrideService.getOverridesForEntity('vital_event', String(event.id));
    for (const override of eventOverrides) {
      if (event.event_type === 'birth') {
        if (!person.birth) person.birth = {};
        if (override.fieldName === 'date' && override.overrideValue) {
          person.birth.date = override.overrideValue;
        } else if (override.fieldName === 'place' && override.overrideValue) {
          person.birth.place = override.overrideValue;
        }
      } else if (event.event_type === 'death') {
        if (!person.death) person.death = {};
        if (override.fieldName === 'date' && override.overrideValue) {
          person.death.date = override.overrideValue;
        } else if (override.fieldName === 'place' && override.overrideValue) {
          person.death.place = override.overrideValue;
        }
      }
    }
  }

  // Also update the computed fields
  if (person.birth?.date || person.death?.date) {
    const birthYear = person.birth?.date?.match(/\d{4}/)?.at(0) ?? '';
    const deathYear = person.death?.date?.match(/\d{4}/)?.at(0) ?? '';
    person.lifespan = birthYear || deathYear ? `${birthYear}-${deathYear}` : '';
  }
  if (person.birth?.place || person.death?.place) {
    person.location = person.birth?.place ?? person.death?.place ?? undefined;
  }
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

  // Get parents (canonical IDs for URL routing)
  const parentEdges = sqliteService.queryAll<{
    parent_id: string;
    parent_role: string;
  }>(
    `SELECT parent_id, parent_role FROM parent_edge WHERE child_id = @personId ORDER BY parent_role`,
    { personId }
  );

  const parents: string[] = [];
  for (const edge of parentEdges) {
    if (edge.parent_role === 'father') {
      parents[0] = edge.parent_id;
    } else if (edge.parent_role === 'mother') {
      parents[1] = edge.parent_id;
    } else {
      parents.push(edge.parent_id);
    }
  }

  // Get children (canonical IDs)
  const childEdges = sqliteService.queryAll<{ child_id: string }>(
    'SELECT child_id FROM parent_edge WHERE parent_id = @personId',
    { personId }
  );

  const children: string[] = childEdges.map(edge => edge.child_id);

  // Get spouses (canonical IDs)
  const spouseEdges = sqliteService.queryAll<{ person1_id: string; person2_id: string }>(
    `SELECT person1_id, person2_id FROM spouse_edge
     WHERE person1_id = @personId OR person2_id = @personId`,
    { personId }
  );

  const spouses: string[] = spouseEdges.map(edge =>
    edge.person1_id === personId ? edge.person2_id : edge.person1_id
  );

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

  // Apply local overrides (user-set values take precedence)
  applyLocalOverridesToPerson(person, personId);

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
    // When SQLite is enabled, use it as the single source of truth
    if (useSqlite) {
      const results: DatabaseInfo[] = [];
      const dbInfos = sqliteService.queryAll<{ db_id: string }>(
        'SELECT db_id FROM database_info ORDER BY updated_at DESC'
      );

      for (const { db_id } of dbInfos) {
        const info = parseDatabaseInfoFromSqlite(db_id);
        if (info) {
          results.push(info);
        }
      }

      return results;
    }

    // Fall back to JSON files only when SQLite is not enabled
    const results: DatabaseInfo[] = [];
    const seenIds = new Set<string>();

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
    // Resolve to internal db_id
    const internalId = resolveDbId(id);

    // Try SQLite first
    if (useSqlite && internalId) {
      const info = parseDatabaseInfoFromSqlite(internalId);
      if (info) return info;
    }

    // Fall back to JSON
    const legacyId = internalId || id;
    const filename = `db-${legacyId}.json`;
    const filePath = findDatabasePath(id);

    if (!filePath) {
      throw new Error(`Database ${id} not found`);
    }

    const isSample = filePath.includes(SAMPLES_DIR);
    return parseDatabaseInfoFromFile(filePath, filename, isSample);
  },

  async getDatabase(id: string): Promise<Database> {
    // Resolve to internal db_id
    const internalId = resolveDbId(id);

    // Try SQLite first
    if (useSqlite && internalId) {
      // Check if we have membership data
      const memberships = sqliteService.queryAll<{ person_id: string }>(
        'SELECT person_id FROM database_membership WHERE db_id = @dbId',
        { dbId: internalId }
      );

      // Get person IDs - either from membership table or via recursive CTE from root
      let personIds: string[] = [];

      if (memberships.length > 0) {
        personIds = memberships.map(m => m.person_id);
      } else {
        // No membership data - check if we have a root entry and use recursive CTE
        const rootInfo = sqliteService.queryOne<{ root_id: string; max_generations: number | null }>(
          'SELECT root_id, max_generations FROM database_info WHERE db_id = @dbId',
          { dbId: internalId }
        );

        if (rootInfo) {
          const maxDepth = rootInfo.max_generations ?? 100;
          const ancestors = sqliteService.queryAll<{ person_id: string }>(
            `WITH RECURSIVE ancestors AS (
              SELECT person_id, 0 as depth FROM person WHERE person_id = @rootId
              UNION ALL
              SELECT pe.parent_id, a.depth + 1
              FROM ancestors a
              JOIN parent_edge pe ON pe.child_id = a.person_id
              WHERE a.depth < @maxDepth
            )
            SELECT DISTINCT person_id FROM ancestors`,
            { rootId: rootInfo.root_id, maxDepth }
          );
          personIds = ancestors.map(a => a.person_id);
        }
      }

      if (personIds.length > 0) {
        const db: Database = {};

        for (const person_id of personIds) {
          const person = buildPersonFromSqlite(person_id, { includeCanonicalId: true });

          if (person) {
            // Use canonical ULID as key for consistency with URLs
            db[person_id] = person;
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
    // Resolve database ID to internal db_id
    const internalDbId = resolveDbId(dbId);

    if (useSqlite && internalDbId) {
      // Try to resolve the person ID
      let canonicalId = idMappingService.resolveId(personId, 'familysearch');

      // If not found, check if it's directly in the database membership
      if (!canonicalId) {
        const membership = sqliteService.queryOne<{ person_id: string }>(
          `SELECT person_id FROM database_membership
           WHERE db_id = @dbId AND person_id = @personId`,
          { dbId: internalDbId, personId }
        );
        if (membership) {
          canonicalId = membership.person_id;
        }
      }

      if (canonicalId) {
        const person = buildPersonFromSqlite(canonicalId, { includeCanonicalId: true });
        if (person) {
          // Get FamilySearch ID for display reference
          const extId = idMappingService.getExternalId(canonicalId, 'familysearch');
          return {
            ...person,
            id: canonicalId, // Use canonical ID for URL routing
            externalId: extId, // FamilySearch ID for display/linking
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

  /**
   * Get ancestors limited to a specific depth - optimized for tree views
   * Uses batch queries instead of loading entire database
   */
  async getAncestorsLimited(
    dbId: string,
    personId: string,
    depth: number
  ): Promise<Database> {
    const internalDbId = resolveDbId(dbId);

    if (!useSqlite || !internalDbId) {
      // Fall back to full database load for non-SQLite
      return this.getDatabase(dbId);
    }

    // Resolve person ID to canonical
    const canonicalPersonId = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get all ancestor IDs up to depth using recursive CTE
    const ancestorRows = sqliteService.queryAll<{ person_id: string }>(
      `WITH RECURSIVE ancestors AS (
        SELECT person_id, 0 as depth FROM person WHERE person_id = @rootId
        UNION ALL
        SELECT pe.parent_id, a.depth + 1
        FROM ancestors a
        JOIN parent_edge pe ON pe.child_id = a.person_id
        WHERE a.depth < @maxDepth AND pe.parent_id IS NOT NULL
      )
      SELECT DISTINCT person_id FROM ancestors`,
      { rootId: canonicalPersonId, maxDepth: depth }
    );

    const personIds = ancestorRows.map(r => r.person_id);
    if (personIds.length === 0) {
      return {};
    }

    // Batch fetch all person data
    const placeholders = personIds.map((_, i) => `@id${i}`).join(',');
    const params: Record<string, string> = {};
    personIds.forEach((id, i) => { params[`id${i}`] = id; });

    // Batch: Base person info
    const persons = sqliteService.queryAll<{
      person_id: string;
      display_name: string;
      birth_name: string | null;
      gender: string | null;
      living: number;
      bio: string | null;
    }>(`SELECT person_id, display_name, birth_name, gender, living, bio FROM person WHERE person_id IN (${placeholders})`, params);

    // Batch: Parent edges (father first, then mother)
    const parentEdges = sqliteService.queryAll<{
      child_id: string;
      parent_id: string;
      parent_role: string | null;
    }>(`SELECT child_id, parent_id, parent_role FROM parent_edge WHERE child_id IN (${placeholders}) ORDER BY child_id, CASE parent_role WHEN 'father' THEN 0 WHEN 'mother' THEN 1 ELSE 2 END`, params);

    // Batch: Child edges (find children of these ancestors)
    const childEdges = sqliteService.queryAll<{
      parent_id: string;
      child_id: string;
    }>(`SELECT parent_id, child_id FROM parent_edge WHERE parent_id IN (${placeholders})`, params);

    // Batch: Spouse edges
    const spouseEdges = sqliteService.queryAll<{
      person1_id: string;
      person2_id: string;
    }>(`SELECT person1_id, person2_id FROM spouse_edge WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`, params);

    // Batch: Vital events
    const vitalEvents = sqliteService.queryAll<{
      person_id: string;
      event_type: string;
      date_original: string | null;
      date_formal: string | null;
      place: string | null;
      place_id: string | null;
    }>(`SELECT person_id, event_type, date_original, date_formal, place, place_id FROM vital_event WHERE person_id IN (${placeholders})`, params);

    // Batch: Claims (occupations, etc.)
    const claims = sqliteService.queryAll<{
      person_id: string;
      predicate: string;
      value_text: string | null;
    }>(`SELECT person_id, predicate, value_text FROM claim WHERE person_id IN (${placeholders})`, params);

    // Build lookup maps
    const parentMap = new Map<string, string[]>();
    for (const edge of parentEdges) {
      const arr = parentMap.get(edge.child_id) || [];
      // Father goes in position 0, mother in position 1
      const idx = edge.parent_role === 'father' ? 0 : edge.parent_role === 'mother' ? 1 : arr.length;
      arr[idx] = edge.parent_id;
      parentMap.set(edge.child_id, arr);
    }

    const childMap = new Map<string, string[]>();
    for (const edge of childEdges) {
      const arr = childMap.get(edge.parent_id) || [];
      if (!arr.includes(edge.child_id)) arr.push(edge.child_id);
      childMap.set(edge.parent_id, arr);
    }

    const spouseMap = new Map<string, string[]>();
    for (const edge of spouseEdges) {
      const arr1 = spouseMap.get(edge.person1_id) || [];
      if (!arr1.includes(edge.person2_id)) arr1.push(edge.person2_id);
      spouseMap.set(edge.person1_id, arr1);

      const arr2 = spouseMap.get(edge.person2_id) || [];
      if (!arr2.includes(edge.person1_id)) arr2.push(edge.person1_id);
      spouseMap.set(edge.person2_id, arr2);
    }

    const vitalMap = new Map<string, Map<string, typeof vitalEvents[0]>>();
    for (const event of vitalEvents) {
      const personEvents = vitalMap.get(event.person_id) || new Map();
      personEvents.set(event.event_type, event);
      vitalMap.set(event.person_id, personEvents);
    }

    const claimMap = new Map<string, typeof claims>();
    for (const claim of claims) {
      const arr = claimMap.get(claim.person_id) || [];
      arr.push(claim);
      claimMap.set(claim.person_id, arr);
    }

    // Build database object
    const db: Database = {};
    for (const row of persons) {
      const pid = row.person_id;
      const events = vitalMap.get(pid);
      const birth = events?.get('birth');
      const death = events?.get('death');
      const burial = events?.get('burial');
      const personClaims = claimMap.get(pid) || [];
      const parents = parentMap.get(pid) || [];
      const children = childMap.get(pid) || [];
      const spouses = spouseMap.get(pid) || [];

      const occupations = personClaims.filter(c => c.predicate === 'occupation').map(c => c.value_text!);
      const aliases = personClaims.filter(c => c.predicate === 'alias').map(c => c.value_text!);
      const religion = personClaims.find(c => c.predicate === 'religion')?.value_text;

      const birthYear = birth?.date_original?.match(/\d{4}/)?.at(0) ?? '';
      const deathYear = death?.date_original?.match(/\d{4}/)?.at(0) ?? '';
      const lifespan = birthYear || deathYear ? `${birthYear}-${deathYear}` : '';

      const person: Person = {
        name: row.display_name,
        birthName: row.birth_name ?? undefined,
        aliases: aliases.length > 0 ? aliases : undefined,
        gender: (row.gender as 'male' | 'female' | 'unknown') ?? 'unknown',
        living: row.living === 1,
        birth: birth ? {
          date: birth.date_original ?? undefined,
          dateFormal: birth.date_formal ?? undefined,
          place: birth.place ?? undefined,
          placeId: birth.place_id ?? undefined,
        } : undefined,
        death: death ? {
          date: death.date_original ?? undefined,
          dateFormal: death.date_formal ?? undefined,
          place: death.place ?? undefined,
          placeId: death.place_id ?? undefined,
        } : undefined,
        burial: burial ? {
          date: burial.date_original ?? undefined,
          dateFormal: burial.date_formal ?? undefined,
          place: burial.place ?? undefined,
          placeId: burial.place_id ?? undefined,
        } : undefined,
        occupations: occupations.length > 0 ? occupations : undefined,
        religion: religion ?? undefined,
        bio: row.bio ?? undefined,
        parents: parents.filter(Boolean),
        children,
        spouses: spouses.length > 0 ? spouses : undefined,
        lifespan,
        location: birth?.place ?? death?.place ?? undefined,
        occupation: occupations[0] ?? undefined,
        canonicalId: pid,
      };

      db[pid] = person;
    }

    return db;
  },

  async deleteDatabase(id: string): Promise<void> {
    // Resolve to internal db_id
    const internalId = resolveDbId(id) || id;
    const filename = `db-${internalId}.json`;
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
        sqliteService.run('DELETE FROM database_membership WHERE db_id = @dbId', { dbId: internalId });
        // Delete favorites
        sqliteService.run('DELETE FROM favorite WHERE db_id = @dbId', { dbId: internalId });
        // Delete database info
        sqliteService.run('DELETE FROM database_info WHERE db_id = @dbId', { dbId: internalId });
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

    // Resolve database ID to internal db_id
    const internalDbId = resolveDbId(dbId);

    if (useSqlite && internalDbId) {
      // Get total count
      const countResult = sqliteService.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM database_membership WHERE db_id = @dbId',
        { dbId: internalDbId }
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
        { dbId: internalDbId, limit, offset }
      );

      const persons: PersonWithId[] = [];
      for (const { person_id } of memberships) {
        const person = buildPersonFromSqlite(person_id, { includeCanonicalId: true });
        if (person) {
          const extId = idMappingService.getExternalId(person_id, 'familysearch');
          persons.push({
            ...person,
            id: person_id, // Use canonical ID for URL routing
            externalId: extId, // FamilySearch ID for display/linking
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
    // Resolve database ID to internal db_id
    const internalDbId = resolveDbId(dbId);

    if (useSqlite && internalDbId) {
      const canonicalId = idMappingService.resolveId(personId, 'familysearch');
      if (!canonicalId) return false;

      const result = sqliteService.queryOne<{ person_id: string }>(
        `SELECT person_id FROM database_membership
         WHERE db_id = @dbId AND person_id = @canonicalId`,
        { dbId: internalDbId, canonicalId }
      );
      return !!result;
    }

    const db = await this.getDatabase(dbId);
    return personId in db;
  },

  /**
   * Check if a person is already a root
   */
  isRoot(personId: string): boolean {
    if (!useSqlite) return false;

    // Resolve to canonical ID if FamilySearch ID
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    const result = sqliteService.queryOne<{ db_id: string }>(
      'SELECT db_id FROM database_info WHERE root_id = @canonical',
      { canonical }
    );
    return !!result;
  },

  /**
   * Create a new root from a person (mark them as an entry point into the tree)
   */
  async createRoot(
    personId: string,
    options?: { maxGenerations?: number }
  ): Promise<DatabaseInfo> {
    if (!useSqlite) {
      throw new Error('SQLite is required to create roots');
    }

    // Resolve to canonical ID if FamilySearch ID
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Check if person exists
    const person = sqliteService.queryOne<{
      person_id: string;
      display_name: string;
    }>('SELECT person_id, display_name FROM person WHERE person_id = @canonical', { canonical });

    if (!person) {
      throw new Error('Person not found in database');
    }

    // Check if already a root
    const existingRoot = sqliteService.queryOne<{ db_id: string }>(
      'SELECT db_id FROM database_info WHERE root_id = @canonical',
      { canonical }
    );

    if (existingRoot) {
      throw new Error('Person is already a root');
    }

    // Count ancestors for this person (limited to avoid timeout)
    const maxGen = options?.maxGenerations ?? 100;
    const countResult = sqliteService.queryOne<{ count: number }>(
      `WITH RECURSIVE ancestors AS (
        SELECT person_id, 0 as depth FROM person WHERE person_id = @rootId
        UNION ALL
        SELECT pe.parent_id, a.depth + 1
        FROM ancestors a
        JOIN parent_edge pe ON pe.child_id = a.person_id
        WHERE a.depth < @maxDepth
      )
      SELECT COUNT(DISTINCT person_id) as count FROM ancestors`,
      { rootId: canonical, maxDepth: maxGen }
    );

    const personCount = countResult?.count ?? 1;

    // Insert root entry
    sqliteService.run(
      `INSERT INTO database_info (db_id, root_id, root_name, max_generations, person_count, is_sample)
       VALUES (@dbId, @rootId, @rootName, @maxGen, @personCount, 0)`,
      {
        dbId: canonical, // db_id = root_id for new roots
        rootId: canonical,
        rootName: person.display_name,
        maxGen: options?.maxGenerations ?? null,
        personCount,
      }
    );

    // Return the new root info
    const info = parseDatabaseInfoFromSqlite(canonical);
    if (!info) {
      throw new Error('Failed to create root');
    }

    return info;
  },

  /**
   * Update a root's configuration (max generations)
   */
  async updateRoot(
    rootId: string,
    options?: { maxGenerations?: number | null }
  ): Promise<DatabaseInfo> {
    if (!useSqlite) {
      throw new Error('SQLite is required to update roots');
    }

    // Resolve to canonical ID if needed
    const canonical = idMappingService.resolveId(rootId, 'familysearch') || rootId;

    // Check if root exists
    const existing = sqliteService.queryOne<{ db_id: string }>(
      'SELECT db_id FROM database_info WHERE db_id = @canonical',
      { canonical }
    );

    if (!existing) {
      throw new Error('Root not found');
    }

    // Update max_generations if provided
    if (options?.maxGenerations !== undefined) {
      sqliteService.run(
        `UPDATE database_info SET max_generations = @maxGen, updated_at = datetime('now') WHERE db_id = @dbId`,
        { maxGen: options.maxGenerations, dbId: canonical }
      );
    }

    // Refresh the count with new max_generations
    return this.refreshRootCount(canonical);
  },

  /**
   * Refresh a root's person count using the current max_generations setting
   */
  async refreshRootCount(rootId: string): Promise<DatabaseInfo> {
    if (!useSqlite) {
      throw new Error('SQLite is required to refresh root counts');
    }

    // Resolve to canonical ID if needed
    const canonical = idMappingService.resolveId(rootId, 'familysearch') || rootId;

    // Get current root info
    const rootInfo = sqliteService.queryOne<{
      db_id: string;
      root_id: string;
      max_generations: number | null;
    }>('SELECT db_id, root_id, max_generations FROM database_info WHERE db_id = @canonical', { canonical });

    if (!rootInfo) {
      throw new Error('Root not found');
    }

    // First try to count from database_membership table (fast, O(1) index lookup)
    const membershipCount = sqliteService.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM database_membership WHERE db_id = @dbId',
      { dbId: canonical }
    );

    let personCount: number;

    if (membershipCount && membershipCount.count > 0) {
      // Use the fast membership count
      personCount = membershipCount.count;
    } else {
      // Fall back to recursive CTE with a hard limit to prevent hangs
      // Cap at 50 generations max regardless of config to prevent runaway queries
      const maxGen = Math.min(rootInfo.max_generations ?? 50, 50);
      const hardLimit = 500000; // Absolute cap on results to prevent memory issues

      const countResult = sqliteService.queryOne<{ count: number }>(
        `WITH RECURSIVE ancestors AS (
          SELECT person_id, 0 as depth FROM person WHERE person_id = @rootId
          UNION ALL
          SELECT pe.parent_id, a.depth + 1
          FROM ancestors a
          JOIN parent_edge pe ON pe.child_id = a.person_id
          WHERE a.depth < @maxDepth
          LIMIT @hardLimit
        )
        SELECT COUNT(DISTINCT person_id) as count FROM ancestors`,
        { rootId: rootInfo.root_id, maxDepth: maxGen, hardLimit }
      );

      personCount = countResult?.count ?? 1;
    }

    // Update the cached count
    sqliteService.run(
      `UPDATE database_info SET person_count = @personCount, updated_at = datetime('now') WHERE db_id = @dbId`,
      { personCount, dbId: canonical }
    );

    // Return updated info
    const info = parseDatabaseInfoFromSqlite(canonical);
    if (!info) {
      throw new Error('Failed to refresh root');
    }

    return info;
  },

  /**
   * Calculate and update max generations for a root.
   * Uses database_membership table if available.
   * Legacy roots without membership records need to be re-indexed.
   */
  async calculateMaxGenerations(rootId: string): Promise<DatabaseInfo> {
    if (!useSqlite) {
      throw new Error('SQLite is required to calculate max generations');
    }

    // Resolve to canonical ID if needed
    const canonical = idMappingService.resolveId(rootId, 'familysearch') || rootId;

    // Verify root exists
    const rootInfo = sqliteService.queryOne<{ db_id: string; root_id: string }>(
      'SELECT db_id, root_id FROM database_info WHERE db_id = @canonical',
      { canonical }
    );

    if (!rootInfo) {
      throw new Error('Root not found');
    }

    // Check if this root has membership records
    const membershipCheck = sqliteService.queryOne<{ count: number; max_gen: number | null }>(
      'SELECT COUNT(*) as count, MAX(generation) as max_gen FROM database_membership WHERE db_id = @dbId',
      { dbId: canonical }
    );

    if (!membershipCheck || membershipCheck.count === 0) {
      throw new Error('This root was created before generation tracking. Please re-index to calculate generations.');
    }

    const maxGenerations = membershipCheck.max_gen ?? 0;

    // Update the max_generations field
    sqliteService.run(
      `UPDATE database_info SET max_generations = @maxGen, updated_at = datetime('now') WHERE db_id = @dbId`,
      { maxGen: maxGenerations, dbId: canonical }
    );

    // Return updated info
    const info = parseDatabaseInfoFromSqlite(canonical);
    if (!info) {
      throw new Error('Failed to calculate max generations');
    }

    return info;
  },
};
