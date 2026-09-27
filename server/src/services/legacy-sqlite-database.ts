// Temporary compatibility boundary for feature slices still backed by SQLite.
import fs from 'fs';
import path from 'path';
import type { Person, PersonWithId } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { DATA_DIR } from '../utils/paths.js';
import { buildLifespan } from '../utils/lifespan.js';
import { parseYear } from '../utils/parseYear.js';
import { applyLocalOverrides } from '../utils/applyOverrides.js';
import { logger } from '../lib/logger.js';

// Feature flag: use SQLite when available
let useSqlite = false;

// Initialize SQLite if database exists
function initSqliteIfAvailable(): boolean {
  const dbPath = path.join(DATA_DIR, 'sparsetree.db');
  if (fs.existsSync(dbPath)) {
    try {
      sqliteService.initDb();
      const stats = sqliteService.getStats();
      // Only use SQLite if it has data
      if (stats.personCount > 0) {
        useSqlite = true;
        return true;
      }
    } catch (error) {
      useSqlite = false;
      sqliteService.closeDb();
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('db', `SQLite unavailable, falling back to JSON data: ${message}`);
    }
  }
  return false;
}

// Try to initialize on module load
initSqliteIfAvailable();

function resolveDbId(id: string): string | null {
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

function applyLocalOverridesToPerson(person: Person, personId: string): void {
  applyLocalOverrides(person, personId, {
    recomputeLifespan: (p) => {
      if (p.birth?.date || p.death?.date) {
        p.lifespan = buildLifespan(parseYear(p.birth?.date), parseYear(p.death?.date));
      }
      if (p.birth?.place || p.death?.place) {
        p.location = p.birth?.place ?? p.death?.place ?? undefined;
      }
    },
  });
}

function buildPersonsBatch(personIds: string[]): PersonWithId[] {
  if (personIds.length === 0) return [];

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

  // Batch: Vital events
  const vitalEvents = sqliteService.queryAll<{
    person_id: string;
    event_type: string;
    date_original: string | null;
    date_year: number | null;
    date_formal: string | null;
    place: string | null;
    place_id: string | null;
  }>(`SELECT person_id, event_type, date_original, date_year, date_formal, place, place_id FROM vital_event WHERE person_id IN (${placeholders})`, params);

  // Batch: Parent edges
  const parentEdges = sqliteService.queryAll<{
    child_id: string;
    parent_id: string;
    parent_role: string | null;
  }>(`SELECT child_id, parent_id, parent_role FROM parent_edge WHERE child_id IN (${placeholders}) ORDER BY child_id, CASE parent_role WHEN 'father' THEN 0 WHEN 'mother' THEN 1 ELSE 2 END`, params);

  // Batch: Child edges
  const childEdges = sqliteService.queryAll<{
    parent_id: string;
    child_id: string;
  }>(`SELECT parent_id, child_id FROM parent_edge WHERE parent_id IN (${placeholders})`, params);

  // Batch: Spouse edges
  const spouseEdges = sqliteService.queryAll<{
    person1_id: string;
    person2_id: string;
  }>(`SELECT person1_id, person2_id FROM spouse_edge WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`, params);

  // Batch: Claims
  const claims = sqliteService.queryAll<{
    person_id: string;
    predicate: string;
    value_text: string | null;
  }>(`SELECT person_id, predicate, value_text FROM claim WHERE person_id IN (${placeholders})`, params);

  // Build lookup maps
  const parentMap = new Map<string, string[]>();
  for (const edge of parentEdges) {
    const arr = parentMap.get(edge.child_id) || [];
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

  // SQLite's `WHERE person_id IN (...)` returns rows in table (rowid) order, not
  // in the order of the IN list. Index the rows by id and assemble by iterating
  // `personIds`, so the caller's ordering (e.g. search's `ORDER BY display_name`)
  // is preserved; ids with no matching row are skipped.
  const rowById = new Map(persons.map((r) => [r.person_id, r]));

  // Assemble PersonWithId results
  const results: PersonWithId[] = [];
  for (const pid of personIds) {
    const row = rowById.get(pid);
    if (!row) continue;
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

    const lifespan = buildLifespan(birth?.date_year, death?.date_year);

    const person: PersonWithId = {
      id: pid,
      canonicalId: pid,
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
    };

    // Apply local overrides
    applyLocalOverridesToPerson(person, pid);

    results.push(person);
  }

  return results;
}

export const legacySqliteDatabase = {
  isEnabled: () => useSqlite,
  resolveDbId,
  getPersonsBatch: buildPersonsBatch,
  applyOverrides(person: Person, personId: string): void {
    if (useSqlite) applyLocalOverridesToPerson(person, personId);
  },
};
