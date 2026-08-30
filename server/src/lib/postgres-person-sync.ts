/** Provider-owned person rows synchronized during a PostgreSQL JSON rebuild. */

import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import { parseYear } from '../utils/parseYear.js';
import type {
  CanonicalIds,
  PostgresTransaction,
  ProviderLifeEvent,
  ProviderNote,
  WritableDatabase,
  WritablePerson,
} from './postgres-writer.types.js';

const SOURCE = 'familysearch';
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export interface ExistingIdentityRow extends QueryResultRow {
  external_id: string;
  person_id: string;
}

interface ExistingClaimRow extends QueryResultRow {
  claim_id: string;
  predicate: string;
  value_text: string | null;
  value_date: string | null;
}

interface ExistingSourceRow extends QueryResultRow {
  row_id: string;
  source_id: string | null;
}

function preferredCanonicalId(
  canonicalIds: CanonicalIds | undefined,
  externalId: string
): string | undefined {
  if (!canonicalIds) return undefined;
  const map = canonicalIds as ReadonlyMap<string, string>;
  return typeof map.get === 'function'
    ? map.get(externalId)
    : (canonicalIds as Readonly<Record<string, string>>)[externalId];
}

export function resolvePersonIds(
  externalIds: string[],
  existingRows: ExistingIdentityRow[],
  canonicalIds?: CanonicalIds
): Map<string, string> {
  const existing = new Map(existingRows.map((row) => [row.external_id, row.person_id]));
  const result = new Map<string, string>();

  for (const externalId of externalIds) {
    const current = existing.get(externalId);
    const preferred = preferredCanonicalId(canonicalIds, externalId);
    if (preferred && !ULID_PATTERN.test(preferred)) {
      throw new Error(`Canonical ID for ${externalId} is not a ULID: ${preferred}`);
    }
    result.set(externalId, current ?? preferred ?? ulid());
  }

  return result;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function claimKey(predicate: string, valueText: string | null, valueDate: string | null): string {
  return JSON.stringify([predicate, valueText, valueDate]);
}

function derivedSourceId(kind: 'fact' | 'note', values: unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return `derived-${kind}-${digest}`;
}

function indexIdsBySource(rows: ExistingSourceRow[]): Map<string, string[]> {
  const idsBySource = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.source_id) continue;
    idsBySource.set(row.source_id, [...(idsBySource.get(row.source_id) ?? []), row.row_id]);
  }
  return idsBySource;
}

function collectClaims(person: WritablePerson): Array<{
  predicate: string;
  valueText: string;
  valueDate: null;
}> {
  const claims = new Map<string, { predicate: string; valueText: string; valueDate: null }>();
  const add = (predicate: string, value: string | undefined): void => {
    const valueText = value?.trim();
    if (!valueText) return;
    claims.set(claimKey(predicate, valueText, null), { predicate, valueText, valueDate: null });
  };

  for (const occupation of uniqueStrings([...(person.occupations ?? []), person.occupation])) {
    add('occupation', occupation);
  }
  for (const alias of uniqueStrings([
    ...(person.aliases ?? []),
    ...(person.alternateNames ?? []),
    ...(person.marriedNames ?? []),
  ])) {
    add('alias', alias);
  }
  add('religion', person.religion);
  add('titleOfNobility', person.titleOfNobility);
  add('militaryService', person.militaryService);
  add('causeOfDeath', person.causeOfDeath);

  return [...claims.values()];
}

async function upsertPerson(
  tx: PostgresTransaction,
  externalId: string,
  personId: string,
  person: WritablePerson
): Promise<void> {
  await tx.run(
    `INSERT INTO person (person_id, display_name, birth_name, gender, living, bio)
     VALUES (@personId, @displayName, @birthName, @gender, @living, @bio)
     ON CONFLICT (person_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       birth_name = EXCLUDED.birth_name,
       gender = EXCLUDED.gender,
       living = EXCLUDED.living,
       bio = EXCLUDED.bio`,
    {
      personId,
      displayName: person.name,
      birthName: person.birthName ?? null,
      gender: person.gender ?? 'unknown',
      living: person.living,
      bio: person.bio ?? null,
    }
  );

  await tx.run(
    `INSERT INTO external_identity
       (person_id, source, external_id, url, confidence, last_seen_at)
     VALUES (@personId, @source, @externalId, @url, 1.0, CURRENT_TIMESTAMP)
     ON CONFLICT (source, external_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       url = EXCLUDED.url,
       confidence = EXCLUDED.confidence,
       last_seen_at = EXCLUDED.last_seen_at`,
    {
      personId,
      source: SOURCE,
      externalId,
      url: `https://www.familysearch.org/tree/person/details/${externalId}`,
    }
  );

  const aliases = uniqueStrings([
    ...(person.aliases ?? []),
    ...(person.alternateNames ?? []),
    ...(person.marriedNames ?? []),
  ]);
  const occupations = uniqueStrings([...(person.occupations ?? []), person.occupation]);
  await tx.run(
    `INSERT INTO person_search
       (person_id, display_name, birth_name, aliases, bio, occupations)
     VALUES (@personId, @displayName, @birthName, @aliases, @bio, @occupations)
     ON CONFLICT (person_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       birth_name = EXCLUDED.birth_name,
       aliases = EXCLUDED.aliases,
       bio = EXCLUDED.bio,
       occupations = EXCLUDED.occupations`,
    {
      personId,
      displayName: person.name,
      birthName: person.birthName ?? '',
      aliases: aliases.join(' '),
      bio: person.bio ?? '',
      occupations: occupations.join(' '),
    }
  );
}

async function syncVitalEvents(
  tx: PostgresTransaction,
  personId: string,
  person: WritablePerson
): Promise<void> {
  const events = [
    ['birth', person.birth],
    ['death', person.death],
    ['burial', person.burial],
  ] as const;
  const presentTypes: string[] = [];

  for (const [eventType, event] of events) {
    if (!event) continue;
    presentTypes.push(eventType);
    await tx.run(
      `INSERT INTO vital_event
         (person_id, event_type, date_original, date_formal, date_year, place, place_id, source, confidence)
       VALUES
         (@personId, @eventType, @dateOriginal, @dateFormal, @dateYear, @place, @placeId, @source, 1.0)
       ON CONFLICT (person_id, event_type, source) DO UPDATE SET
         date_original = EXCLUDED.date_original,
         date_formal = EXCLUDED.date_formal,
         date_year = EXCLUDED.date_year,
         place = EXCLUDED.place,
         place_id = EXCLUDED.place_id,
         confidence = EXCLUDED.confidence`,
      {
        personId,
        eventType,
        dateOriginal: event.date?.trim() || null,
        dateFormal: event.dateFormal ?? null,
        dateYear: parseYear(event.dateFormal ?? event.date),
        place: event.place ?? null,
        placeId: event.placeId ?? null,
        source: SOURCE,
      }
    );
  }

  await tx.run(
    `DELETE FROM vital_event
     WHERE person_id = @personId AND source = @source
       AND NOT (event_type = ANY(@presentTypes::text[]))`,
    { personId, source: SOURCE, presentTypes }
  );
}

async function syncClaims(
  tx: PostgresTransaction,
  personId: string,
  person: WritablePerson
): Promise<void> {
  const existing = await tx.queryAll<ExistingClaimRow>(
    `SELECT claim_id, predicate, value_text, value_date
     FROM claim WHERE person_id = @personId AND source = @source
     ORDER BY created_at, claim_id`,
    { personId, source: SOURCE }
  );
  const idsByKey = new Map<string, string[]>();
  for (const row of existing) {
    const key = claimKey(row.predicate, row.value_text, row.value_date);
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), row.claim_id]);
  }

  const retainedIds: string[] = [];
  for (const claim of collectClaims(person)) {
    const key = claimKey(claim.predicate, claim.valueText, claim.valueDate);
    const claimId = idsByKey.get(key)?.shift() ?? ulid();
    retainedIds.push(claimId);
    await tx.run(
      `INSERT INTO claim
         (claim_id, person_id, predicate, value_text, value_date, source, confidence)
       VALUES (@claimId, @personId, @predicate, @valueText, @valueDate, @source, 1.0)
       ON CONFLICT (claim_id) DO UPDATE SET
         predicate = EXCLUDED.predicate,
         value_text = EXCLUDED.value_text,
         value_date = EXCLUDED.value_date,
         source = EXCLUDED.source,
         confidence = EXCLUDED.confidence`,
      { claimId, personId, ...claim, source: SOURCE }
    );
  }

  await tx.run(
    `DELETE FROM claim
     WHERE person_id = @personId AND source = @source
       AND NOT (claim_id = ANY(@retainedIds::text[]))`,
    { personId, source: SOURCE, retainedIds }
  );
}

async function syncLifeEvents(
  tx: PostgresTransaction,
  personId: string,
  events: ProviderLifeEvent[]
): Promise<void> {
  const existing = await tx.queryAll<ExistingSourceRow>(
    `SELECT event_id AS row_id, source_id
     FROM life_event
     WHERE person_id = @personId AND source = @source
     ORDER BY created_at, event_id`,
    { personId, source: SOURCE }
  );
  const idsBySource = indexIdsBySource(existing);

  const retainedIds: string[] = [];
  for (const event of events) {
    if (!event.eventType) continue;
    const sourceId = event.sourceId?.trim() || derivedSourceId('fact', [
      event.eventType,
      event.eventRole,
      event.dateOriginal,
      event.dateFormal,
      event.dateYear,
      event.dateMonth,
      event.dateDay,
      event.dateEndYear,
      event.placeOriginal,
      event.placeNormalized,
      event.placeId,
      event.value,
      event.description,
      event.cause,
    ]);
    const eventId = idsBySource.get(sourceId)?.shift() ?? ulid();
    retainedIds.push(eventId);
    await tx.run(
      `INSERT INTO life_event (
         event_id, person_id, event_type, event_role,
         date_original, date_formal, date_year, date_month, date_day, date_end_year,
         place_original, place_normalized, place_id,
         value, description, cause, source, source_id, confidence
       ) VALUES (
         @eventId, @personId, @eventType, @eventRole,
         @dateOriginal, @dateFormal, @dateYear, @dateMonth, @dateDay, @dateEndYear,
         @placeOriginal, @placeNormalized, @placeId,
         @value, @description, @cause, @source, @sourceId, 1.0
       )
       ON CONFLICT (event_id) DO UPDATE SET
         event_type = EXCLUDED.event_type,
         event_role = EXCLUDED.event_role,
         date_original = EXCLUDED.date_original,
         date_formal = EXCLUDED.date_formal,
         date_year = EXCLUDED.date_year,
         date_month = EXCLUDED.date_month,
         date_day = EXCLUDED.date_day,
         date_end_year = EXCLUDED.date_end_year,
         place_original = EXCLUDED.place_original,
         place_normalized = EXCLUDED.place_normalized,
         place_id = EXCLUDED.place_id,
         value = EXCLUDED.value,
         description = EXCLUDED.description,
         cause = EXCLUDED.cause,
         source = EXCLUDED.source,
         source_id = EXCLUDED.source_id,
         confidence = EXCLUDED.confidence`,
      {
        eventId,
        personId,
        eventType: event.eventType,
        eventRole: event.eventRole ?? 'principal',
        dateOriginal: event.dateOriginal ?? null,
        dateFormal: event.dateFormal ?? null,
        dateYear: event.dateYear ?? null,
        dateMonth: event.dateMonth ?? null,
        dateDay: event.dateDay ?? null,
        dateEndYear: event.dateEndYear ?? null,
        placeOriginal: event.placeOriginal ?? null,
        placeNormalized: event.placeNormalized ?? null,
        placeId: event.placeId ?? null,
        value: event.value ?? null,
        description: event.description ?? null,
        cause: event.cause ?? null,
        source: SOURCE,
        sourceId,
      }
    );
  }

  await tx.run(
    `DELETE FROM life_event
     WHERE person_id = @personId AND source = @source
       AND NOT (event_id = ANY(@retainedIds::text[]))`,
    { personId, source: SOURCE, retainedIds }
  );
}

async function syncNotes(
  tx: PostgresTransaction,
  personId: string,
  notes: ProviderNote[]
): Promise<void> {
  const existing = await tx.queryAll<ExistingSourceRow>(
    `SELECT note_id AS row_id, source_id
     FROM note
     WHERE person_id = @personId AND source = @source
     ORDER BY created_at, note_id`,
    { personId, source: SOURCE }
  );
  const idsBySource = indexIdsBySource(existing);

  const retainedIds: string[] = [];
  for (const note of notes) {
    if (!note.content) continue;
    const sourceId = note.sourceId?.trim() || derivedSourceId('note', [
      note.noteType,
      note.title,
      note.content,
      note.contentType,
      note.language,
      note.author,
    ]);
    const noteId = idsBySource.get(sourceId)?.shift() ?? ulid();
    retainedIds.push(noteId);
    await tx.run(
      `INSERT INTO note (
         note_id, person_id, note_type, title, content, content_type,
         language, source, source_id, author
       ) VALUES (
         @noteId, @personId, @noteType, @title, @content, @contentType,
         @language, @source, @sourceId, @author
       )
       ON CONFLICT (note_id) DO UPDATE SET
         note_type = EXCLUDED.note_type,
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         content_type = EXCLUDED.content_type,
         language = EXCLUDED.language,
         source = EXCLUDED.source,
         source_id = EXCLUDED.source_id,
         author = EXCLUDED.author`,
      {
        noteId,
        personId,
        noteType: note.noteType ?? 'custom',
        title: note.title ?? null,
        content: note.content,
        contentType: note.contentType ?? 'text',
        language: note.language ?? 'en',
        source: SOURCE,
        sourceId,
        author: note.author ?? null,
      }
    );
  }

  await tx.run(
    `DELETE FROM note
     WHERE person_id = @personId AND source = @source
       AND NOT (note_id = ANY(@retainedIds::text[]))`,
    { personId, source: SOURCE, retainedIds }
  );
}

export async function syncPeople(
  tx: PostgresTransaction,
  externalIds: string[],
  database: WritableDatabase,
  personIds: Map<string, string>
): Promise<void> {
  for (const externalId of externalIds) {
    await upsertPerson(tx, externalId, personIds.get(externalId)!, database[externalId]);
  }
  for (const externalId of externalIds) {
    const personId = personIds.get(externalId)!;
    const person = database[externalId];
    await syncVitalEvents(tx, personId, person);
    await syncClaims(tx, personId, person);
    await syncLifeEvents(tx, personId, person.allLifeEvents ?? []);
    await syncNotes(tx, personId, person.notes ?? []);
  }
}
