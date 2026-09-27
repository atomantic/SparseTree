import type { Database, DatabaseInfo, OnThisDayEvent, Person, PersonWithId } from '@fsf/shared';
import type { createPostgresService } from '../db/postgres.service.js';
import { buildLifespan } from '../utils/lifespan.js';
import { getPostgresTreeStats } from './postgres-database-stats.js';
import { matchesAnniversary, sortAnniversaries } from './database-stats.js';

export type PostgresStore = ReturnType<typeof createPostgresService>;

export class DatabaseNotFoundError extends Error {}

interface RootRow {
  db_id: string;
  root_id: string;
  root_name: string | null;
  source_provider: string | null;
  max_generations: number | null;
  is_sample: boolean;
  person_count: number;
}

export function createPostgresDatabase(
  store: PostgresStore,
  applyOverrides: (person: Person, id: string) => void = () => {},
  hasPhoto: (id: string) => boolean = () => false,
) {
  const resolvePersonId = async (id: string): Promise<string | null> => {
    const row = await store.queryOne<{ person_id: string }>(
      `SELECT person_id FROM person WHERE person_id = @id
       UNION ALL SELECT person_id FROM external_identity WHERE source = 'familysearch' AND external_id = @id
       LIMIT 1`, { id },
    );
    return row?.person_id ?? null;
  };

  const resolveDbId = async (id: string): Promise<string | null> => {
    const row = await store.queryOne<{ db_id: string }>(
      `SELECT db_id FROM database_info WHERE db_id = @id
       UNION ALL SELECT db_id FROM database_info WHERE root_id = @id
       UNION ALL SELECT di.db_id FROM database_info di
         JOIN external_identity ei ON ei.person_id = di.root_id
         WHERE ei.source = 'familysearch' AND ei.external_id = @id
       LIMIT 1`, { id },
    );
    return row?.db_id ?? null;
  };

  const getDatabaseInfo = async (id: string): Promise<DatabaseInfo> => {
    const dbId = await resolveDbId(id);
    const row = await store.queryOne<RootRow>('SELECT * FROM database_info WHERE db_id = @dbId', { dbId });
    if (!row) throw new DatabaseNotFoundError(`Database ${id} not found`);
    const identities = await store.queryAll<{ source: string; external_id: string }>(
      'SELECT source, external_id FROM external_identity WHERE person_id = @personId ORDER BY source, confidence ASC',
      { personId: row.root_id },
    );
    const externalIds = Object.fromEntries(identities.map(identity => [identity.source, identity.external_id]));
    return {
      id: row.root_id, filename: `root-${row.root_id}.json`, rootId: row.root_id,
      personCount: row.person_count || 1, rootName: row.root_name ?? undefined,
      rootExternalId: externalIds.familysearch,
      externalIds: identities.length ? externalIds : undefined,
      maxGenerations: row.max_generations ?? undefined,
      sourceProvider: row.source_provider ?? undefined, isSample: row.is_sample,
      hasPhoto: hasPhoto(row.root_id),
    };
  };

  // UNION bounds duplicate pedigree paths at each depth, including cyclic graphs.
  const ancestorIds = async (rootId: string, depth: number): Promise<string[]> => {
    const rows = await store.queryAll<{ person_id: string }>(
      `WITH RECURSIVE ancestors AS (
         SELECT person_id, 0 AS depth FROM person WHERE person_id = @rootId
         UNION
         SELECT pe.parent_id, a.depth + 1 FROM ancestors a
         JOIN parent_edge pe ON pe.child_id = a.person_id WHERE a.depth < @depth
       ) SELECT DISTINCT person_id FROM ancestors`, { rootId, depth },
    );
    return rows.map(row => row.person_id);
  };

  const personsToDatabase = (persons: PersonWithId[]): Database => Object.fromEntries(persons.map(({ id, ...person }) => [id, person]));

  async function buildPersonsBatch(personIds: string[]): Promise<PersonWithId[]> {
    if (personIds.length === 0) return [];

    // One array parameter also supports graphs larger than PostgreSQL's bind limit.
    const params = { personIds };

    // Batch: Base person info
    const persons = await store.queryAll<{
      person_id: string;
      display_name: string;
      birth_name: string | null;
      gender: string | null;
      living: boolean;
      bio: string | null;
    }>(`SELECT person_id, display_name, birth_name, gender, living, bio FROM person WHERE person_id = ANY(@personIds::text[])`, params);

    // Batch: Vital events
    const vitalEvents = await store.queryAll<{
      person_id: string;
      event_type: string;
      date_original: string | null;
      date_year: number | null;
      date_formal: string | null;
      place: string | null;
      place_id: string | null;
    }>(`SELECT person_id, event_type, date_original, date_year, date_formal, place, place_id FROM vital_event WHERE person_id = ANY(@personIds::text[])`, params);

    // Batch: Parent edges
    const parentEdges = await store.queryAll<{
      child_id: string;
      parent_id: string;
      parent_role: string | null;
    }>(`SELECT child_id, parent_id, parent_role FROM parent_edge WHERE child_id = ANY(@personIds::text[]) ORDER BY child_id, CASE parent_role WHEN 'father' THEN 0 WHEN 'mother' THEN 1 ELSE 2 END`, params);

    // Batch: Child edges
    const childEdges = await store.queryAll<{
      parent_id: string;
      child_id: string;
    }>(`SELECT parent_id, child_id FROM parent_edge WHERE parent_id = ANY(@personIds::text[])`, params);

    // Batch: Spouse edges
    const spouseEdges = await store.queryAll<{
      person1_id: string;
      person2_id: string;
    }>(`SELECT person1_id, person2_id FROM spouse_edge WHERE person1_id = ANY(@personIds::text[]) OR person2_id = ANY(@personIds::text[])`, params);

    // Batch: Claims
    const claims = await store.queryAll<{
      person_id: string;
      predicate: string;
      value_text: string | null;
    }>(`SELECT person_id, predicate, value_text FROM claim WHERE person_id = ANY(@personIds::text[])`, params);

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

    // A SQL `WHERE person_id IN (...)` does not guarantee rows are returned
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
        living: row.living,
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
      applyOverrides(person, pid);

      results.push(person);
    }

    return results;
  }


  const getDatabase = async (id: string): Promise<Database> => {
    const dbId = await resolveDbId(id);
    const root = await store.queryOne<RootRow>('SELECT * FROM database_info WHERE db_id = @dbId', { dbId });
    if (!root) throw new DatabaseNotFoundError(`Database ${id} not found`);
    const rows = await store.queryAll<{ person_id: string }>(
      'SELECT person_id FROM database_membership WHERE db_id = @dbId', { dbId },
    );
    const ids = rows.length ? rows.map(row => row.person_id) : await ancestorIds(root.root_id, root.max_generations ?? 100);
    return personsToDatabase(await buildPersonsBatch(ids));
  };

  const addExternalIds = async (persons: PersonWithId[]): Promise<PersonWithId[]> => {
    if (!persons.length) return [];
    const rows = await store.queryAll<{ person_id: string; external_id: string }>(
      `SELECT person_id, external_id FROM external_identity
       WHERE source = 'familysearch' AND person_id = ANY(@ids::text[]) ORDER BY confidence ASC`,
      { ids: persons.map(person => person.id) },
    );
    const identities = new Map(rows.map(row => [row.person_id, row.external_id]));
    return persons.map(person => ({ ...person, externalId: identities.get(person.id) }));
  };

  const refreshRootCount = async (rootId: string): Promise<DatabaseInfo> => {
    const dbId = await resolveDbId(rootId);
    const root = await store.queryOne<RootRow>('SELECT * FROM database_info WHERE db_id = @dbId', { dbId });
    if (!root) throw new Error('Root not found');
    const count = await store.queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM database_membership WHERE db_id = @dbId', { dbId },
    );
    const personCount = count?.count || (await ancestorIds(root.root_id, Math.min(root.max_generations ?? 50, 50))).length;
    await store.run('UPDATE database_info SET person_count = @personCount, updated_at = CURRENT_TIMESTAMP WHERE db_id = @dbId', { personCount, dbId });
    return getDatabaseInfo(dbId!);
  };

  return {
    resolveDbId,
    async listDatabases(): Promise<DatabaseInfo[]> {
      const rows = await store.queryAll<{ db_id: string }>('SELECT db_id FROM database_info ORDER BY updated_at DESC');
      const result: DatabaseInfo[] = [];
      for (const row of rows) result.push(await getDatabaseInfo(row.db_id));
      return result;
    },
    getDatabaseInfo,
    getDatabase,
    async getPerson(dbId: string, personId: string): Promise<PersonWithId | null> {
      if (!await resolveDbId(dbId)) throw new DatabaseNotFoundError(`Database ${dbId} not found`);
      const canonical = await resolvePersonId(personId);
      if (!canonical) return null;
      return (await addExternalIds(await buildPersonsBatch([canonical])))[0] ?? null;
    },
    getPersonsBatch: buildPersonsBatch,
    async getAncestorsLimited(dbId: string, personId: string, depth: number): Promise<Database> {
      if (!await resolveDbId(dbId)) throw new DatabaseNotFoundError(`Database ${dbId} not found`);
      const canonical = await resolvePersonId(personId);
      if (!canonical) return {};
      return personsToDatabase(await buildPersonsBatch(await ancestorIds(canonical, depth)));
    },
    async listPersons(dbId: string, options?: { page?: number; limit?: number }): Promise<{ persons: PersonWithId[]; total: number }> {
      const internalId = await resolveDbId(dbId);
      if (!internalId) throw new DatabaseNotFoundError(`Database ${dbId} not found`);
      const limit = options?.limit ?? 100;
      const offset = ((options?.page ?? 1) - 1) * limit;
      const count = await store.queryOne<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM database_membership WHERE db_id = @dbId', { dbId: internalId },
      );
      const rows = await store.queryAll<{ person_id: string }>(
        `SELECT dm.person_id FROM database_membership dm JOIN person p ON p.person_id = dm.person_id
         WHERE dm.db_id = @dbId ORDER BY p.display_name, p.person_id LIMIT @limit OFFSET @offset`,
        { dbId: internalId, limit, offset },
      );
      return { persons: await addExternalIds(await buildPersonsBatch(rows.map(row => row.person_id))), total: count?.count ?? 0 };
    },
    async personExists(dbId: string, personId: string): Promise<boolean> {
      const internalId = await resolveDbId(dbId);
      if (!internalId) throw new DatabaseNotFoundError(`Database ${dbId} not found`);
      const canonical = await resolvePersonId(personId);
      return Boolean(await store.queryOne('SELECT person_id FROM database_membership WHERE db_id = @dbId AND person_id = @personId', { dbId: internalId, personId: canonical }));
    },
    async isRoot(personId: string): Promise<boolean> {
      return Boolean(await resolveDbId(personId));
    },
    async createRoot(personId: string, options?: { maxGenerations?: number }): Promise<DatabaseInfo> {
      const canonical = await resolvePersonId(personId);
      if (!canonical) throw new Error('Person not found in database');
      if (await resolveDbId(canonical)) throw new Error('Person is already a root');
      const person = await store.queryOne<{ display_name: string }>('SELECT display_name FROM person WHERE person_id = @canonical', { canonical });
      const ids = await ancestorIds(canonical, options?.maxGenerations ?? 100);
      await store.run(
        `INSERT INTO database_info (db_id, root_id, root_name, max_generations, person_count, is_sample)
         VALUES (@canonical, @canonical, @name, @depth, @count, FALSE)`,
        { canonical, name: person!.display_name, depth: options?.maxGenerations ?? null, count: ids.length },
      );
      return getDatabaseInfo(canonical);
    },
    async updateRoot(rootId: string, options?: { maxGenerations?: number | null }): Promise<DatabaseInfo> {
      const dbId = await resolveDbId(rootId);
      if (!dbId) throw new Error('Root not found');
      if (options?.maxGenerations !== undefined) {
        await store.run('UPDATE database_info SET max_generations = @depth, updated_at = CURRENT_TIMESTAMP WHERE db_id = @dbId', { depth: options.maxGenerations, dbId });
      }
      return refreshRootCount(dbId);
    },
    refreshRootCount,
    async calculateMaxGenerations(rootId: string): Promise<DatabaseInfo> {
      const dbId = await resolveDbId(rootId);
      if (!dbId) throw new Error('Root not found');
      const row = await store.queryOne<{ count: number; max_gen: number | null }>(
        'SELECT COUNT(*)::int AS count, MAX(generation) AS max_gen FROM database_membership WHERE db_id = @dbId', { dbId },
      );
      if (!row?.count) throw new Error('This root was created before generation tracking. Please re-index to calculate generations.');
      await store.run('UPDATE database_info SET max_generations = @depth, updated_at = CURRENT_TIMESTAMP WHERE db_id = @dbId', { depth: row.max_gen ?? 0, dbId });
      return getDatabaseInfo(dbId);
    },
    async deleteDatabase(id: string): Promise<void> {
      const dbId = await resolveDbId(id);
      if (!dbId) return;
      await store.transaction(async tx => {
        const info = await tx.queryOne<RootRow>('SELECT * FROM database_info WHERE db_id = @dbId FOR UPDATE', { dbId });
        if (info?.is_sample) throw new Error(`Cannot delete sample database ${id}`);
        await tx.run('DELETE FROM database_membership WHERE db_id = @dbId', { dbId });
        await tx.run('DELETE FROM favorite WHERE db_id = @dbId', { dbId });
        await tx.run('DELETE FROM database_info WHERE db_id = @dbId', { dbId });
      });
    },
    async getTreeStats(rootId: string) {
      const dbId = await resolveDbId(rootId);
      if (!dbId) throw new Error('Root not found');
      return getPostgresTreeStats(store, dbId);
    },
    async getOnThisDay(rootId: string, month: number, day: number): Promise<OnThisDayEvent[]> {
      const dbId = await resolveDbId(rootId);
      if (!dbId) return [];
      const rows = await store.queryAll<{
        person_id: string; display_name: string; gender: OnThisDayEvent['gender'];
        event_type: 'birth' | 'death'; date_original: string; date_year: number | null; place: string | null; has_photo: boolean;
      }>(
        `SELECT ve.person_id, p.display_name, p.gender, ve.event_type, ve.date_original, ve.date_year, ve.place,
           EXISTS (SELECT 1 FROM media m WHERE m.person_id = p.person_id) AS has_photo
         FROM vital_event ve JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
         JOIN person p ON ve.person_id = p.person_id
         WHERE ve.event_type IN ('birth', 'death') AND ve.date_original IS NOT NULL`, { dbId },
      );
      const events = new Map<string, OnThisDayEvent>();
      for (const row of rows) {
        if (!matchesAnniversary(row.date_original, month, day)) continue;
        const key = `${row.person_id}:${row.event_type}`;
        if (events.has(key)) continue;
        events.set(key, { personId: row.person_id, displayName: row.display_name, gender: row.gender ?? undefined,
          eventType: row.event_type, dateOriginal: row.date_original, year: row.date_year, place: row.place ?? undefined, hasPhoto: row.has_photo });
      }
      return sortAnniversaries([...events.values()]);
    },
  };
}
