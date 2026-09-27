/** Explicit, one-time import of local metadata from a read-only SQLite snapshot. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { postgresService } from '../db/postgres.service.js';

type Store = typeof postgresService;
type LegacyRow = Record<string, unknown>;
const TABLES = ['person', 'external_identity', 'database_info', 'database_membership', 'vital_event',
  'claim', 'local_override', 'favorite', 'discovery_dismissed', 'blob', 'media', 'description',
  'provider_mapping', 'place_geocode', 'unusual_death_keyword', 'parent_edge', 'spouse_edge'] as const;
type LegacyTable = typeof TABLES[number];
type Snapshot = Record<LegacyTable, LegacyRow[]>;
export const LOCAL_DATA_IMPORT_MIGRATION = 'postgres_004_local_data_import';

export interface LocalDataImportResult {
  alreadyApplied: boolean;
  dryRun: boolean;
  imported: Record<string, number>;
  preserved: Record<string, number>;
}

export class LocalDataImportError extends Error {}

function required(row: LegacyRow, key: string): string {
  const value = row[key];
  if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') || String(value) === '') {
    throw new LocalDataImportError(`Legacy data has no valid ${key}; import aborted.`);
  }
  return String(value);
}

function flag(value: unknown): boolean {
  if (value === 1 || value === 1n || value === true) return true;
  if (value === 0 || value === 0n || value === false || value == null) return false;
  throw new LocalDataImportError('Legacy data contains an invalid boolean; import aborted.');
}

function timestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new LocalDataImportError('Legacy data contains an invalid timestamp; import aborted.');
  const utc = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime())) throw new LocalDataImportError('Legacy data contains an invalid timestamp; import aborted.');
  return date.toISOString();
}

function tags(value: unknown): string | null {
  if (value == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch {
    throw new LocalDataImportError('Legacy favorites or dismissals contain invalid JSON tags; import aborted.');
  }
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new LocalDataImportError('Legacy favorites or dismissals contain non-string tags; import aborted.');
  }
  return JSON.stringify(parsed);
}

function readSnapshot(filename: string): Snapshot {
  const exporter = path.resolve(import.meta.dirname, '../../../scripts/export-legacy-local-data.py');
  const output = spawnSync('python3', [exporter, filename], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (output.error || output.status !== 0) {
    throw new LocalDataImportError('Could not read the legacy SQLite snapshot. Install Python 3 with its standard sqlite3 module and verify the snapshot is readable.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.stdout);
  } catch {
    throw new LocalDataImportError('The legacy SQLite snapshot exporter returned invalid data; import aborted.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).person)) {
    throw new LocalDataImportError('The source is not a SparseTree SQLite database.');
  }
  return parsed as Snapshot;
}

class DryRunRollback extends Error {
  constructor(readonly result: LocalDataImportResult) { super('Rollback local-data dry run'); }
}

/**
 * Rebuild provider data first, stop local writes, then run this explicit import.
 * Existing PostgreSQL rows win conflicts. Missing/ambiguous references abort the
 * entire transaction; no source records, blob files, schema, or startup state are
 * changed. A committed marker makes reruns safe even after later user deletions.
 */
export async function importPostgresLocalData(
  filename: string,
  options: { store?: Store; dryRun?: boolean } = {},
): Promise<LocalDataImportResult> {
  const snapshot = readSnapshot(filename);
  const store = options.store ?? postgresService;
  const result: LocalDataImportResult = { alreadyApplied: false, dryRun: options.dryRun ?? false, imported: {}, preserved: {} };
  const count = (table: string, imported: boolean) => {
    const counts = imported ? result.imported : result.preserved;
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const index = (table: LegacyTable, key: string) => new Map(snapshot[table].map(row => [required(row, key), row]));
  const people = index('person', 'person_id');
  const databases = index('database_info', 'db_id');
  const events = index('vital_event', 'id');
  const claims = index('claim', 'claim_id');

  return store.transaction(async tx => {
    // Prevent another import or provider rebuild from changing identity mappings.
    await tx.run('SELECT pg_advisory_xact_lock(hashtext(@key))', { key: 'sparsetree:json-rebuild' });
    if (await tx.queryOne('SELECT name FROM migration WHERE name = @name', { name: LOCAL_DATA_IMPORT_MIGRATION })) {
      return { ...result, alreadyApplied: true };
    }

    const insert = async (table: LegacyTable, columns: string[], row: LegacyRow, conflict: string[]) => {
      const values = columns.map(column => column.endsWith('_at') ? timestamp(row[column]) : row[column] ?? null);
      const inserted = await tx.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (${conflict.join(', ')}) DO NOTHING`, values,
      );
      count(table, (inserted.rowCount ?? 0) > 0);
    };

    const remember = (mapping: Map<string, string>, reverse: Map<string, string>, oldId: string, target: string, kind: string): string => {
      if (reverse.has(target) && reverse.get(target) !== oldId) {
        throw new LocalDataImportError(`Multiple SQLite ${kind} map to one PostgreSQL entity; reconcile them before importing.`);
      }
      mapping.set(oldId, target);
      reverse.set(target, oldId);
      return target;
    };
    const mappedPeople = new Map<string, string>();
    const reversePeople = new Map<string, string>();
    const mapPerson = async (oldId: string): Promise<string> => {
      const cached = mappedPeople.get(oldId);
      if (cached) return cached;
      if (!people.has(oldId)) throw new LocalDataImportError('Local data references a person missing from the SQLite source; import aborted.');
      const targets = new Set<string>();
      for (const identity of snapshot.external_identity.filter(row => row.person_id === oldId)) {
        const target = await tx.queryOne<{ person_id: string }>(
          'SELECT person_id FROM external_identity WHERE source = @source AND external_id = @externalId',
          { source: required(identity, 'source'), externalId: required(identity, 'external_id') },
        );
        if (target) targets.add(target.person_id);
      }
      if (!targets.size) {
        const sameId = await tx.queryOne<{ person_id: string }>('SELECT person_id FROM person WHERE person_id = @oldId', { oldId });
        if (sameId) targets.add(sameId.person_id);
      }
      if (targets.size !== 1) throw new LocalDataImportError('Local data has an unmapped or ambiguous person identity. Rebuild or reconcile provider identities before importing.');
      const target = [...targets][0];
      await tx.run('SELECT person_id FROM person WHERE person_id = @personId FOR NO KEY UPDATE', { personId: target });
      return remember(mappedPeople, reversePeople, oldId, target, 'people');
    };

    const mappedDatabases = new Map<string, string>();
    const reverseDatabases = new Map<string, string>();
    const mapDatabase = async (oldId: string): Promise<string> => {
      const cached = mappedDatabases.get(oldId);
      if (cached) return cached;
      const legacy = databases.get(oldId);
      const root = legacy?.root_id ?? snapshot.database_membership.find(row => row.db_id === oldId && flag(row.is_root))?.person_id;
      if (!root) throw new LocalDataImportError('A favorite or dismissal references an unmapped database root; import aborted.');
      const rootId = await mapPerson(String(root));
      const targets = await tx.queryAll<{ db_id: string; source_provider: string | null }>(
        'SELECT db_id, source_provider FROM database_info WHERE root_id = @rootId', { rootId },
      );
      const sameId = targets.find(row => row.db_id === oldId);
      const matching = legacy?.source_provider ? targets.filter(row => row.source_provider === legacy.source_provider) : targets;
      const target = sameId ?? (matching.length === 1 ? matching[0] : undefined);
      if (!target) throw new LocalDataImportError('A favorite or dismissal has an unmapped or ambiguous PostgreSQL database; rebuild its root before importing.');
      return remember(mappedDatabases, reverseDatabases, oldId, target.db_id, 'databases');
    };

    const mappedEvents = new Map<string, string>();
    const reverseEvents = new Map<string, string>();
    const mapEvent = async (row: LegacyRow): Promise<string> => {
      const oldId = required(row, 'id');
      const cached = mappedEvents.get(oldId);
      if (cached) return cached;
      const personId = await mapPerson(required(row, 'person_id'));
      const params = { personId, type: required(row, 'event_type'), source: row.source ?? null };
      const matches = await tx.queryAll<{ id: string }>(
        'SELECT id::text FROM vital_event WHERE person_id = @personId AND event_type = @type AND source IS NOT DISTINCT FROM @source', params,
      );
      if (matches.length > 1) throw new LocalDataImportError('An overridden vital event has ambiguous target matches; import aborted.');
      let eventId: string | undefined = matches[0]?.id;
      if (!eventId) {
        await insert('vital_event', ['person_id', 'event_type', 'date_original', 'date_formal', 'date_year', 'place', 'place_id', 'source', 'confidence'],
          { ...row, person_id: personId, source: 'local' }, ['person_id', 'event_type', 'source']);
        eventId = (await tx.queryOne<{ id: string }>(
          "SELECT id::text FROM vital_event WHERE person_id = @personId AND event_type = @type AND source = 'local'", params,
        ))?.id;
      } else {
        count('vital_event', false);
      }
      if (!eventId) throw new LocalDataImportError('Could not preserve a local vital event; import aborted.');
      return remember(mappedEvents, reverseEvents, oldId, eventId, 'vital events');
    };

    const mappedClaims = new Map<string, string>();
    const reverseClaims = new Map<string, string>();
    const mapClaim = async (row: LegacyRow): Promise<string> => {
      const oldId = required(row, 'claim_id');
      const cached = mappedClaims.get(oldId);
      if (cached) return cached;
      const personId = await mapPerson(required(row, 'person_id'));
      const predicate = required(row, 'predicate');
      const sameId = await tx.queryOne<{ claim_id: string; person_id: string; predicate: string }>(
        'SELECT claim_id, person_id, predicate FROM claim WHERE claim_id = @oldId', { oldId },
      );
      if (sameId && (sameId.person_id !== personId || sameId.predicate !== predicate)) {
        throw new LocalDataImportError('A legacy claim ID conflicts with a different PostgreSQL claim; import aborted.');
      }
      const exact = !sameId && row.source !== 'local' ? await tx.queryAll<{ claim_id: string }>(
        `SELECT claim_id FROM claim WHERE person_id = @personId AND predicate = @predicate
         AND source IS NOT DISTINCT FROM @source AND value_text IS NOT DISTINCT FROM @text AND value_date IS NOT DISTINCT FROM @date`,
        { personId, predicate, source: row.source ?? null, text: row.value_text ?? null, date: row.value_date ?? null },
      ) : [];
      if (exact.length > 1) throw new LocalDataImportError('An overridden claim has ambiguous target matches; import aborted.');
      const targetId = sameId?.claim_id ?? exact[0]?.claim_id ?? oldId;
      if (!sameId && !exact.length) {
        await insert('claim', ['claim_id', 'person_id', 'predicate', 'value_text', 'value_date', 'source', 'confidence', 'created_at'],
          { ...row, person_id: personId, source: 'local' }, ['claim_id']);
      } else {
        count('claim', false);
      }
      return remember(mappedClaims, reverseClaims, oldId, targetId, 'claims');
    };

    for (const row of snapshot.vital_event.filter(row => row.source === 'local')) await mapEvent(row);
    for (const row of snapshot.claim.filter(row => row.source === 'local')) await mapClaim(row);
    for (const row of snapshot.local_override) {
      const oldId = required(row, 'entity_id');
      let entityId: string;
      if (row.entity_type === 'person') entityId = await mapPerson(oldId);
      else if (row.entity_type === 'vital_event' && events.has(oldId)) entityId = await mapEvent(events.get(oldId)!);
      else if (row.entity_type === 'claim' && claims.has(oldId)) entityId = await mapClaim(claims.get(oldId)!);
      else throw new LocalDataImportError('An override has an unsupported or missing source entity; import aborted without dropping it.');
      await insert('local_override', ['override_id', 'entity_type', 'entity_id', 'field_name', 'original_value', 'override_value', 'reason', 'source', 'created_at', 'updated_at'],
        { ...row, entity_id: entityId, source: row.source ?? 'local' }, ['entity_type', 'entity_id', 'field_name']);
    }

    for (const table of ['favorite', 'discovery_dismissed'] as const) {
      for (const row of snapshot[table]) {
        const personId = await mapPerson(required(row, 'person_id'));
        const dbId = await mapDatabase(required(row, 'db_id'));
        const columns = table === 'favorite' ? ['db_id', 'person_id', 'why_interesting', 'tags', 'added_at']
          : ['db_id', 'person_id', 'ai_reason', 'ai_tags', 'dismissed_at'];
        await insert(table, columns, { ...row, person_id: personId, db_id: dbId,
          tags: tags(row.tags), ai_tags: tags(row.ai_tags) }, ['db_id', 'person_id']);
      }
    }
    for (const row of snapshot.blob) {
      const relative = required(row, 'path');
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
        throw new LocalDataImportError('A legacy blob has a path outside the data directory; import aborted.');
      }
      await insert('blob', ['blob_hash', 'path', 'mime_type', 'size_bytes', 'width', 'height', 'created_at'], row, ['blob_hash']);
    }
    // If legacy duplicates exist, preserve the photo chosen by the old reader.
    const mediaRows = [...snapshot.media].sort((a, b) => Number(flag(b.is_primary)) - Number(flag(a.is_primary))
      || (timestamp(a.created_at) ?? '').localeCompare(timestamp(b.created_at) ?? '')
      || required(a, 'media_id').localeCompare(required(b, 'media_id')));
    for (const row of mediaRows) {
      const personId = await mapPerson(required(row, 'person_id'));
      const sameId = await tx.queryOne<{ person_id: string }>('SELECT person_id FROM media WHERE media_id = @id', { id: required(row, 'media_id') });
      if (sameId && sameId.person_id !== personId) throw new LocalDataImportError('A legacy media ID belongs to another PostgreSQL person; import aborted.');
      const sameMedia = sameId ?? await tx.queryOne(
        `SELECT media_id FROM media WHERE person_id = @personId
         AND blob_hash IS NOT DISTINCT FROM @blobHash AND source = @source LIMIT 1`,
        { personId, blobHash: row.blob_hash ?? null, source: required(row, 'source') },
      );
      if (sameMedia) {
        count('media', false);
        continue;
      }
      const primary = flag(row.is_primary) && !await tx.queryOne(
        'SELECT media_id FROM media WHERE person_id = @personId AND is_primary = TRUE', { personId },
      );
      await insert('media', ['media_id', 'person_id', 'blob_hash', 'source', 'source_url', 'is_primary', 'caption', 'created_at'],
        { ...row, person_id: personId, is_primary: primary }, ['media_id']);
    }
    for (const table of ['description', 'provider_mapping'] as const) {
      for (const row of snapshot[table]) {
        const personId = await mapPerson(required(row, 'person_id'));
        const columns = table === 'description' ? ['person_id', 'text', 'source', 'language', 'created_at']
          : ['person_id', 'provider', 'account_id', 'match_method', 'match_confidence', 'created_at'];
        await insert(table, columns, { ...row, person_id: personId }, ['person_id', table === 'description' ? 'source' : 'provider']);
      }
    }
    for (const table of ['parent_edge', 'spouse_edge'] as const) {
      for (const row of snapshot[table].filter(row => row.source === 'local')) {
        const keys = table === 'parent_edge' ? ['child_id', 'parent_id'] : ['person1_id', 'person2_id'];
        const ids: string[] = [];
        for (const key of keys) ids.push(await mapPerson(required(row, key)));
        if (table === 'spouse_edge') ids.sort();
        const columns = table === 'parent_edge' ? [...keys, 'parent_role', 'confidence', 'source']
          : [...keys, 'marriage_date', 'marriage_place', 'divorce_date', 'confidence', 'source'];
        await insert(table, columns, { ...row, [keys[0]]: ids[0], [keys[1]]: ids[1] }, keys);
      }
    }
    for (const row of snapshot.person.filter(row => flag(row.is_unusual_death))) {
      const personId = await mapPerson(required(row, 'person_id'));
      const target = await tx.queryOne<{ is_unusual_death: boolean; untouched: boolean }>(
        'SELECT is_unusual_death, updated_at = created_at AS untouched FROM person WHERE person_id = @personId', { personId },
      );
      if (!target?.is_unusual_death && !target?.untouched) {
        throw new LocalDataImportError('A manual unusual-death flag conflicts with a PostgreSQL person changed after creation. Preserve or reconcile the newer flag explicitly before importing; no rows were committed.');
      }
      if (!target.is_unusual_death) await tx.run('UPDATE person SET is_unusual_death = TRUE WHERE person_id = @personId', { personId });
      count('unusual_death_flag', !target.is_unusual_death);
    }
    for (const row of snapshot.unusual_death_keyword) {
      await insert('unusual_death_keyword', ['keyword', 'created_at'], row, ['keyword']);
    }
    for (const row of snapshot.place_geocode) {
      await insert('place_geocode', ['place_text', 'lat', 'lng', 'display_name', 'geocode_status', 'geocoded_at', 'source'], row, ['place_text']);
    }
    await tx.run('INSERT INTO migration (name) VALUES (@name)', { name: LOCAL_DATA_IMPORT_MIGRATION });
    if (options.dryRun) throw new DryRunRollback(result);
    return result;
  }).catch(error => {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  });
}
