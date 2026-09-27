import type { Database, SearchParams, SearchResult, PersonWithId } from '@fsf/shared';
import { parseYear } from '../utils/parseYear.js';

const getBirthYear = (person: PersonWithId): number | null => {
  // First try the new birth.date field
  if (person.birth?.dateFormal || person.birth?.date) {
    return parseYear(person.birth.dateFormal || person.birth.date);
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

async function searchInMemory(
  getDatabase: (id: string) => Promise<Database>,
  dbId: string,
  params: SearchParams
): Promise<SearchResult> {
  const db = await getDatabase(dbId);
  const { q, location, occupation, birthAfter, birthBefore, hasBio, page = 1, limit = 50 } = params;
  // Note: generationMin/generationMax and hasPhoto not supported in JSON-only mode - requires PostgreSQL

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

  // Has photo filter - requires PostgreSQL mode (photos stored in media table)
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

export function createJsonSearch(getDatabase: (id: string) => Promise<Database>) {
  return {
    search: (dbId: string, params: SearchParams) => searchInMemory(getDatabase, dbId, params),
    async quickSearch(dbId: string, q: string) {
      if (q.trim().length < 2) return [];
      const result = await searchInMemory(getDatabase, dbId, { q, limit: Number.MAX_SAFE_INTEGER });
      return result.results.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
        .slice(0, 20).map(person => ({
          personId: person.id, displayName: person.name, gender: person.gender ?? 'unknown',
          birthName: person.birthName ?? null, birthYear: getBirthYear(person),
        }));
    },
  };
}
