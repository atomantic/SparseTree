import type { SearchParams, SearchResult, PersonWithId } from '@fsf/shared';
import { databaseService, resolveDbId } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

// Parse year from lifespan string or date string, handling BC notation
const parseYear = (yearStr: string): number | null => {
  if (!yearStr) return null;
  const cleaned = yearStr.trim();
  if (cleaned.toUpperCase().includes('BC')) {
    const num = parseInt(cleaned.replace(/BC/i, ''));
    return isNaN(num) ? null : -num;
  }
  const num = parseInt(cleaned);
  return isNaN(num) ? null : num;
};

const getBirthYear = (person: PersonWithId): number | null => {
  // First try the new birth.date field
  if (person.birth?.date) {
    return parseYear(person.birth.date);
  }
  // Fall back to parsing lifespan
  if (!person.lifespan) return null;
  const parts = person.lifespan.split('-');
  return parseYear(parts[0]);
};

const getLocation = (person: PersonWithId): string | undefined => {
  // Check new birth/death place fields first
  return person.birth?.place || person.death?.place || person.location;
};

const getOccupations = (person: PersonWithId): string[] => {
  // New format has occupations array
  if (person.occupations && person.occupations.length > 0) {
    return person.occupations;
  }
  // Fall back to single occupation field
  return person.occupation ? [person.occupation] : [];
};

/**
 * Search using SQLite FTS5 and SQL filters
 */
async function searchWithSqlite(
  dbId: string,
  params: SearchParams
): Promise<SearchResult> {
  const { q, location, occupation, birthAfter, birthBefore, generationMin, generationMax, hasPhoto, hasBio, page = 1, limit = 50 } = params;
  const offset = (page - 1) * limit;

  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) {
    return { results: [], total: 0, page, limit, totalPages: 0 };
  }

  // Build the query dynamically based on search parameters
  const conditions: string[] = ['dm.db_id = @dbId'];
  const queryParams: Record<string, unknown> = { dbId: internalDbId };

  // FTS5 text search
  if (q) {
    // Use FTS5 MATCH for text search
    // Escape special FTS5 characters and wrap in quotes for phrase matching
    const escapedQuery = q.replace(/['"]/g, '').trim();
    conditions.push(`p.person_id IN (
      SELECT person_id FROM person_fts WHERE person_fts MATCH @ftsQuery
    )`);
    // Use prefix matching for partial word matches
    queryParams.ftsQuery = `"${escapedQuery}"*`;
  }

  // Location filter
  if (location) {
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM vital_event ve
        WHERE ve.person_id = p.person_id
        AND ve.event_type IN ('birth', 'death')
        AND ve.place LIKE @locationPattern
      )
    )`);
    queryParams.locationPattern = `%${location}%`;
  }

  // Occupation filter
  if (occupation) {
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM claim c
        WHERE c.person_id = p.person_id
        AND c.predicate = 'occupation'
        AND c.value_text LIKE @occupationPattern
      )
    )`);
    queryParams.occupationPattern = `%${occupation}%`;
  }

  // Birth year filters
  if (birthAfter) {
    const afterYear = parseYear(birthAfter);
    if (afterYear !== null) {
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM vital_event ve
          WHERE ve.person_id = p.person_id
          AND ve.event_type = 'birth'
          AND ve.date_year >= @birthAfterYear
        )
      )`);
      queryParams.birthAfterYear = afterYear;
    }
  }

  if (birthBefore) {
    const beforeYear = parseYear(birthBefore);
    if (beforeYear !== null) {
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM vital_event ve
          WHERE ve.person_id = p.person_id
          AND ve.event_type = 'birth'
          AND ve.date_year <= @birthBeforeYear
        )
      )`);
      queryParams.birthBeforeYear = beforeYear;
    }
  }

  // Generation filters (distance from root person)
  if (generationMin !== undefined) {
    conditions.push('dm.generation >= @generationMin');
    queryParams.generationMin = generationMin;
  }

  if (generationMax !== undefined) {
    conditions.push('dm.generation <= @generationMax');
    queryParams.generationMax = generationMax;
  }

  // Has photo filter
  if (hasPhoto) {
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM media m
        WHERE m.person_id = p.person_id
      )
    )`);
  }

  // Has bio filter
  if (hasBio) {
    conditions.push(`(p.bio IS NOT NULL AND p.bio != '')`);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countSql = `
    SELECT COUNT(*) as count
    FROM person p
    JOIN database_membership dm ON p.person_id = dm.person_id
    WHERE ${whereClause}
  `;
  const countResult = sqliteService.queryOne<{ count: number }>(countSql, queryParams);
  const total = countResult?.count ?? 0;

  // Get paginated results
  const searchSql = `
    SELECT p.person_id
    FROM person p
    JOIN database_membership dm ON p.person_id = dm.person_id
    WHERE ${whereClause}
    ORDER BY p.display_name
    LIMIT @limit OFFSET @offset
  `;

  const personIds = sqliteService.queryAll<{ person_id: string }>(searchSql, {
    ...queryParams,
    limit,
    offset,
  });

  // Build full person objects
  const results: PersonWithId[] = [];
  for (const { person_id } of personIds) {
    const person = await databaseService.getPerson(dbId, person_id);
    if (person) {
      results.push(person);
    }
  }

  const totalPages = Math.ceil(total / limit);
  return { results, total, page, limit, totalPages };
}

/**
 * Search using in-memory filtering (fallback for JSON-only mode)
 */
async function searchInMemory(
  dbId: string,
  params: SearchParams
): Promise<SearchResult> {
  const db = await databaseService.getDatabase(dbId);
  const { q, location, occupation, birthAfter, birthBefore, hasBio, page = 1, limit = 50 } = params;
  // Note: generationMin/generationMax and hasPhoto not supported in JSON-only mode - requires SQLite

  let results: PersonWithId[] = Object.entries(db).map(([id, person]) => ({
    id,
    ...person,
  }));

  // Text search (name, bio, occupation, alternate names)
  if (q) {
    const query = q.toLowerCase();
    results = results.filter((p) => {
      // Search in name
      if (p.name?.toLowerCase().includes(query)) return true;
      // Search in alternate names
      if (p.alternateNames?.some((n) => n.toLowerCase().includes(query))) return true;
      // Search in bio
      if (p.bio?.toLowerCase().includes(query)) return true;
      // Search in occupations (new array format)
      if (p.occupations?.some((o) => o.toLowerCase().includes(query))) return true;
      // Search in occupation (old format)
      if (p.occupation?.toLowerCase().includes(query)) return true;
      return false;
    });
  }

  // Location filter (checks birth.place, death.place, or location)
  if (location) {
    const loc = location.toLowerCase();
    results = results.filter((p) => {
      const personLocation = getLocation(p);
      return personLocation?.toLowerCase().includes(loc);
    });
  }

  // Occupation filter
  if (occupation) {
    const occ = occupation.toLowerCase();
    results = results.filter((p) => {
      const personOccupations = getOccupations(p);
      return personOccupations.some((o) => o.toLowerCase().includes(occ));
    });
  }

  // Birth date filters
  if (birthAfter) {
    const afterYear = parseYear(birthAfter);
    if (afterYear !== null) {
      results = results.filter((p) => {
        const birthYear = getBirthYear(p);
        return birthYear !== null && birthYear >= afterYear;
      });
    }
  }

  if (birthBefore) {
    const beforeYear = parseYear(birthBefore);
    if (beforeYear !== null) {
      results = results.filter((p) => {
        const birthYear = getBirthYear(p);
        return birthYear !== null && birthYear <= beforeYear;
      });
    }
  }

  // Has photo filter - requires SQLite mode (photos stored in media table)
  // In JSON-only mode, this filter is not supported

  // Has bio filter
  if (hasBio) {
    results = results.filter((p) => p.bio && p.bio.trim().length > 0);
  }

  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paginatedResults = results.slice(start, start + limit);

  return { results: paginatedResults, total, page, limit, totalPages };
}

export const searchService = {
  async search(dbId: string, params: SearchParams): Promise<SearchResult> {
    // Use SQLite if available
    if (databaseService.isSqliteEnabled()) {
      return searchWithSqlite(dbId, params);
    }

    // Fall back to in-memory search
    return searchInMemory(dbId, params);
  },

  /**
   * Quick search by name only (optimized for autocomplete)
   */
  async quickSearch(
    dbId: string,
    query: string,
    limit: number = 10
  ): Promise<PersonWithId[]> {
    // Resolve database ID to internal db_id
    const internalDbId = resolveDbId(dbId);

    if (databaseService.isSqliteEnabled() && internalDbId && query.length >= 2) {
      // Use FTS5 for fast prefix matching
      const escapedQuery = query.replace(/['"]/g, '').trim();
      const personIds = sqliteService.queryAll<{ person_id: string }>(
        `SELECT DISTINCT p.person_id
         FROM person p
         JOIN database_membership dm ON p.person_id = dm.person_id
         JOIN person_fts fts ON p.person_id = fts.person_id
         WHERE dm.db_id = @dbId
         AND fts.display_name MATCH @query
         LIMIT @limit`,
        {
          dbId: internalDbId,
          query: `"${escapedQuery}"*`,
          limit,
        }
      );

      const results: PersonWithId[] = [];
      for (const { person_id } of personIds) {
        const person = await databaseService.getPerson(dbId, person_id);
        if (person) {
          results.push(person);
        }
      }
      return results;
    }

    // Fall back to simple prefix search
    const db = await databaseService.getDatabase(dbId);
    const lowerQuery = query.toLowerCase();

    return Object.entries(db)
      .filter(([, person]) => person.name?.toLowerCase().startsWith(lowerQuery))
      .slice(0, limit)
      .map(([id, person]) => ({ id, ...person }));
  },

  /**
   * Search across all databases (SQLite only)
   */
  async searchGlobal(
    params: SearchParams
  ): Promise<{ dbId: string; results: PersonWithId[]; total: number }[]> {
    if (!databaseService.isSqliteEnabled()) {
      // Not supported without SQLite
      return [];
    }

    const { q, page = 1, limit = 20 } = params;
    if (!q) return [];

    const escapedQuery = q.replace(/['"]/g, '').trim();
    const offset = (page - 1) * limit;

    // Search across all databases
    const results = sqliteService.queryAll<{ db_id: string; person_id: string }>(
      `SELECT DISTINCT dm.db_id, p.person_id
       FROM person p
       JOIN database_membership dm ON p.person_id = dm.person_id
       JOIN person_fts fts ON p.person_id = fts.person_id
       WHERE fts MATCH @query
       ORDER BY dm.db_id, p.display_name
       LIMIT @limit OFFSET @offset`,
      {
        query: `"${escapedQuery}"*`,
        limit,
        offset,
      }
    );

    // Group by database
    const grouped = new Map<string, PersonWithId[]>();
    for (const { db_id, person_id } of results) {
      const person = await databaseService.getPerson(db_id, person_id);
      if (person) {
        const dbResults = grouped.get(db_id) ?? [];
        dbResults.push(person);
        grouped.set(db_id, dbResults);
      }
    }

    return Array.from(grouped.entries()).map(([dbId, persons]) => ({
      dbId,
      results: persons,
      total: persons.length,
    }));
  },
};
