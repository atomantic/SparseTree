import type { SearchParams, SearchResult } from '@fsf/shared';
import type { PostgresStore, createPostgresDatabase } from './postgres-database.js';
import { parseYear } from '../utils/parseYear.js';

/** FTS5-style literal phrase, with prefix matching only on the final word. */
export function personSearchQuery(text: string): string | null {
  const words = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return null;
  return words.map((word, index) => `'${word}'${index === words.length - 1 ? ':*' : ''}`).join(' <-> ');
}

// Use the GIN document for candidate lookup; the field predicates prevent a
// phrase from accidentally spanning two different fields of the document.
export const PERSON_SEARCH_MATCH = `p.person_id IN (
  SELECT s.person_id FROM person_search s
  WHERE s.search_document @@ to_tsquery('simple', @query)
    AND (${['display_name', 'birth_name', 'aliases', 'bio', 'occupations'].map(field =>
      `sparsetree_search_vector(s.${field}) @@ to_tsquery('simple', @query)`
    ).join(' OR ')})
)`;

export function createPostgresSearch(store: PostgresStore, database: Pick<ReturnType<typeof createPostgresDatabase>, 'resolveDbId' | 'getPersonsBatch'>) {
  async function search(dbId: string, params: SearchParams): Promise<SearchResult> {
    const { q, location, occupation, birthAfter, birthBefore, generationMin, generationMax, hasPhoto, hasBio, page = 1, limit = 50 } = params;
    const empty = { results: [], total: 0, page, limit, totalPages: 0 };
    await store.initDb();
    const internalId = await database.resolveDbId(dbId);
    if (!internalId) return empty;
    const conditions = ['dm.db_id = @dbId'];
    const values: Record<string, unknown> = { dbId: internalId };
    if (q?.trim()) {
      values.query = personSearchQuery(q);
      if (!values.query) return empty;
      conditions.push(PERSON_SEARCH_MATCH);
    }
    if (location) {
      conditions.push(`EXISTS (SELECT 1 FROM vital_event ve WHERE ve.person_id = p.person_id
        AND ve.event_type IN ('birth', 'death') AND ve.place ILIKE @location)`);
      values.location = `%${location}%`;
    }
    if (occupation) {
      conditions.push(`EXISTS (SELECT 1 FROM claim c WHERE c.person_id = p.person_id
        AND c.predicate = 'occupation' AND c.value_text ILIKE @occupation)`);
      values.occupation = `%${occupation}%`;
    }
    for (const [value, name, operator] of [[birthAfter, 'birthAfter', '>='], [birthBefore, 'birthBefore', '<=']] as const) {
      const year = value ? parseYear(value) : null;
      if (year !== null) {
        conditions.push(`EXISTS (SELECT 1 FROM vital_event ve WHERE ve.person_id = p.person_id
          AND ve.event_type = 'birth' AND ve.date_year ${operator} @${name})`);
        values[name] = year;
      }
    }
    if (generationMin !== undefined) {
      conditions.push('dm.generation >= @generationMin');
      values.generationMin = generationMin;
    }
    if (generationMax !== undefined) {
      conditions.push('dm.generation <= @generationMax');
      values.generationMax = generationMax;
    }
    if (hasPhoto) conditions.push('EXISTS (SELECT 1 FROM media m WHERE m.person_id = p.person_id)');
    if (hasBio) conditions.push("p.bio IS NOT NULL AND p.bio != ''");
    const from = `FROM person p JOIN database_membership dm ON dm.person_id = p.person_id
      WHERE ${conditions.join(' AND ')}`;
    const count = await store.queryOne<{ count: string }>(`SELECT COUNT(*) AS count ${from}`, values);
    const total = Number(count?.count ?? 0);
    const rows = await store.queryAll<{ person_id: string }>(`SELECT p.person_id ${from}
      ORDER BY p.display_name COLLATE "C", p.person_id COLLATE "C" LIMIT @limit OFFSET @offset`,
    { ...values, limit, offset: (page - 1) * limit });
    const results = await database.getPersonsBatch(rows.map(row => row.person_id));
    return { results, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async function quickSearch(dbId: string, q: string) {
    const query = personSearchQuery(q);
    if (q.trim().length < 2 || !query) return [];
    await store.initDb();
    const internalId = await database.resolveDbId(dbId);
    if (!internalId) return [];
    const rows = await store.queryAll<{
      person_id: string; display_name: string; gender: string; birth_name: string | null; birth_year: number | null;
    }>(`SELECT p.person_id, p.display_name, p.gender, p.birth_name,
        (SELECT MIN(date_year) FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth') AS birth_year
      FROM person p JOIN database_membership dm ON dm.person_id = p.person_id
      WHERE dm.db_id = @dbId AND ${PERSON_SEARCH_MATCH}
      ORDER BY p.display_name COLLATE "C", p.person_id COLLATE "C" LIMIT 20`, { dbId: internalId, query });
    return rows.map(row => ({ personId: row.person_id, displayName: row.display_name, gender: row.gender,
      birthName: row.birth_name, birthYear: row.birth_year }));
  }
  return { search, quickSearch };
}
