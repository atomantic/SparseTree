import { ulid } from 'ulid';
import { postgresService, type createPostgresService } from '../db/postgres.service.js';

type Store = ReturnType<typeof createPostgresService>;
export type IdentityTransaction = Parameters<Parameters<Store['transaction']>[0]>[0];
interface PersonOptions {
  birthName?: string;
  gender?: 'male' | 'female' | 'unknown';
  living?: boolean;
  bio?: string;
  url?: string;
}

/**
 * Read committed identities directly so no process cache can retain a reassigned
 * identity or a rolled-back stub. Composed mutations pass their transaction
 * through to the helpers; the outer caller owns the commit.
 */
export function createIdMappingService(store: Store = postgresService) {
  const getCanonicalId = async (source: string, externalId: string, tx: IdentityTransaction = store): Promise<string | undefined> => {
    const row = await tx.queryOne<{ person_id: string }>(
      'SELECT person_id FROM external_identity WHERE source = @source AND external_id = @externalId',
      { source, externalId },
    );
    return row?.person_id;
  };

  const getExternalIds = async (personId: string): Promise<Map<string, string>> => {
    const rows = await store.queryAll<{ source: string; external_id: string }>(
      `SELECT source, external_id FROM external_identity WHERE person_id = @personId
       ORDER BY source, confidence ASC NULLS FIRST, id`, { personId },
    );
    return new Map(rows.map(row => [row.source, row.external_id]));
  };

  const getExternalId = async (personId: string, source: string): Promise<string | undefined> =>
    (await getExternalIds(personId)).get(source);

  const insertPerson = async (tx: IdentityTransaction, displayName: string, options?: PersonOptions): Promise<string> => {
    const personId = ulid();
    // The schema's person trigger refreshes person_search in this transaction.
    await tx.run(
      `INSERT INTO person (person_id, display_name, birth_name, gender, living, bio)
       VALUES (@personId, @displayName, @birthName, @gender, @living, @bio)`,
      { personId, displayName, birthName: options?.birthName ?? null, gender: options?.gender ?? 'unknown',
        living: options?.living ?? false, bio: options?.bio ?? null },
    );
    return personId;
  };

  const createPersonStub = async (displayName: string, options?: PersonOptions, tx?: IdentityTransaction): Promise<string> =>
    tx ? insertPerson(tx, displayName, options) : store.transaction(inner => insertPerson(inner, displayName, options));

  const createPerson = async (
    displayName: string, source: string, externalId: string, options?: PersonOptions, tx?: IdentityTransaction,
  ): Promise<string> => {
    const create = async (inner: IdentityTransaction) => {
      const personId = await insertPerson(inner, displayName, options);
      await inner.run(
        `INSERT INTO external_identity (person_id, source, external_id, url, last_seen_at)
         VALUES (@personId, @source, @externalId, @url, CURRENT_TIMESTAMP)`,
        { personId, source, externalId, url: options?.url ?? null },
      );
      return personId;
    };
    return tx ? create(tx) : store.transaction(create);
  };

  const registerExternalId = async (
    personId: string, source: string, externalId: string,
    options?: { url?: string; confidence?: number }, tx: IdentityTransaction = store,
  ): Promise<void> => {
    await tx.run(
      `INSERT INTO external_identity (person_id, source, external_id, url, confidence, last_seen_at)
       VALUES (@personId, @source, @externalId, @url, @confidence, CURRENT_TIMESTAMP)
       ON CONFLICT (source, external_id) DO UPDATE SET person_id = EXCLUDED.person_id,
         url = EXCLUDED.url, confidence = EXCLUDED.confidence, last_seen_at = EXCLUDED.last_seen_at`,
      { personId, source, externalId, url: options?.url ?? null, confidence: options?.confidence ?? 1.0 },
    );
  };

  const removeExternalId = async (source: string, externalId: string, tx: IdentityTransaction = store): Promise<boolean> => {
    const result = await tx.run(
      'DELETE FROM external_identity WHERE source = @source AND external_id = @externalId', { source, externalId },
    );
    return (result.rowCount ?? 0) > 0;
  };

  const getOrCreateCanonicalId = async (
    source: string, externalId: string, displayName: string, options?: PersonOptions, tx?: IdentityTransaction,
  ): Promise<string> => {
    const findOrCreate = async (inner: IdentityTransaction) => {
      // Serialize the absent-row case so concurrent imports cannot create orphans.
      await inner.run('SELECT pg_advisory_xact_lock(hashtextextended(@identity, 0))', { identity: JSON.stringify([source, externalId]) });
      return await getCanonicalId(source, externalId, inner)
        ?? createPerson(displayName, source, externalId, options, inner);
    };
    return tx ? findOrCreate(tx) : store.transaction(findOrCreate);
  };

  const resolveId = async (id: string, source?: string): Promise<string | undefined> => {
    if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) {
      const exists = await store.queryOne<{ person_id: string }>('SELECT person_id FROM person WHERE person_id = @id', { id });
      if (exists) return id;
    }
    if (source) return getCanonicalId(source, id);
    for (const provider of ['23andme', 'ancestry', 'familysearch', 'geni', 'wikitree']) {
      const canonical = await getCanonicalId(provider, id);
      if (canonical) return canonical;
    }
    return undefined;
  };

  const batchGetCanonicalIds = async (source: string, externalIds: string[]): Promise<Map<string, string>> => {
    if (!externalIds.length) return new Map();
    const rows = await store.queryAll<{ external_id: string; person_id: string }>(
      `SELECT external_id, person_id FROM external_identity
       WHERE source = @source AND external_id = ANY(@externalIds::text[])`, { source, externalIds },
    );
    return new Map(rows.map(row => [row.external_id, row.person_id]));
  };

  const getAllExternalIds = async (source: string): Promise<{ externalId: string; personId: string }[]> => {
    const rows = await store.queryAll<{ external_id: string; person_id: string }>(
      'SELECT external_id, person_id FROM external_identity WHERE source = @source ORDER BY id', { source },
    );
    return rows.map(row => ({ externalId: row.external_id, personId: row.person_id }));
  };

  return { getCanonicalId, getExternalIds, getExternalId, createPerson, createPersonStub,
    registerExternalId, removeExternalId, getOrCreateCanonicalId, resolveId, batchGetCanonicalIds, getAllExternalIds };
}

export const idMappingService = createIdMappingService();
