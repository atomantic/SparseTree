/**
 * SQLite Writer for the Indexer
 *
 * Provides functions to write indexed person data to SQLite database
 * in addition to the JSON files. This enables dual-write during indexing.
 *
 * Supports expanded schema (Phase 15.6+):
 * - life_event table for all GEDCOM-X fact types
 * - note table for life sketches and stories
 */

import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from '../services/id-mapping.service.js';
import { logger } from './logger.js';
import { ulid } from 'ulid';

// Source identifier for all FamilySearch data
const SOURCE = 'familysearch';

// Track which FamilySearch IDs have been written in this session
const sessionWritten = new Set<string>();

interface Person {
  name: string;
  birthName?: string;
  living?: boolean;
  bio?: string;
  lifespan?: string;
  location?: string;
  occupation?: string;
  religion?: string;
  titleOfNobility?: string;
  militaryService?: string;
  causeOfDeath?: string;
  aliases?: string[];
  alternateNames?: string[];
  marriedNames?: string[];
  occupations?: string[];
  parents: (string | null)[];
  allLifeEvents?: LifeEvent[];
  notes?: Note[];
}

interface LifeEvent {
  eventType: string;
  eventRole?: string;
  sourceId?: string;
  dateOriginal?: string;
  dateFormal?: string;
  dateYear?: number;
  dateMonth?: number;
  dateDay?: number;
  dateEndYear?: number;
  placeOriginal?: string;
  placeNormalized?: string;
  placeId?: string;
  value?: string;
  description?: string;
  cause?: string;
}

interface Note {
  noteType?: string;
  title?: string;
  content: string;
  contentType?: string;
  language?: string;
  sourceId?: string;
  author?: string;
}

interface Database {
  [id: string]: Person;
}

/**
 * Parse birth/death year from lifespan string
 * Handles BC notation and various formats
 */
function parseYear(lifespan: string | undefined, type: 'birth' | 'death'): number | null {
  if (!lifespan) return null;
  const parts = lifespan.split('-');
  const dateStr = type === 'birth' ? parts[0] : parts[1];
  if (!dateStr || dateStr === '?') return null;

  const bcMatch = dateStr.match(/(\d+)\s*BC/i);
  if (bcMatch) return -parseInt(bcMatch[1], 10);

  const yearMatch = dateStr.match(/\d{3,4}/);
  if (yearMatch) return parseInt(yearMatch[0], 10);

  return null;
}

/**
 * Get or create canonical ULID for a FamilySearch ID
 */
function getOrCreatePersonId(
  fsId: string,
  displayName: string,
  options: {
    birthName?: string;
    gender?: 'male' | 'female' | 'unknown';
    living?: boolean;
    bio?: string;
    url?: string;
  } = {}
): string {
  return idMappingService.getOrCreateCanonicalId(
    'familysearch',
    fsId,
    displayName,
    options
  );
}

/**
 * Get canonical ULID for a FamilySearch ID (returns undefined if not found)
 */
function getPersonId(fsId: string): string | undefined {
  return idMappingService.getCanonicalId('familysearch', fsId);
}

/**
 * Write a person to SQLite
 * Called after getPerson() fetches/parses the data
 *
 * @param fsId - FamilySearch person ID
 * @param person - Person object from json2person
 * @param generation - Generation distance from root
 */
function writePerson(fsId: string, person: Person, generation: number): string | null {
  if (!person || !fsId) return null;

  // Avoid duplicate writes in same session
  if (sessionWritten.has(fsId)) {
    return getPersonId(fsId) || null;
  }

  // Determine gender from name patterns or default to unknown
  const gender: 'male' | 'female' | 'unknown' = 'unknown';
  // Could be enhanced with name analysis

  // Get or create canonical ID
  const personId = getOrCreatePersonId(fsId, person.name, {
    birthName: person.birthName,
    gender,
    living: person.living || false,
    bio: person.bio,
    url: `https://www.familysearch.org/tree/person/details/${fsId}`,
  });

  sessionWritten.add(fsId);

  // Update person record with latest data
  sqliteService.run(
    `UPDATE person SET
      display_name = @displayName,
      bio = @bio,
      updated_at = datetime('now')
     WHERE person_id = @personId`,
    {
      personId,
      displayName: person.name,
      bio: person.bio || null,
    }
  );

  // Insert vital events
  const birthYear = parseYear(person.lifespan, 'birth');
  const deathYear = parseYear(person.lifespan, 'death');
  const [birthDate, deathDate] = (person.lifespan || '').split('-');

  if (birthDate && birthDate !== '?') {
    sqliteService.run(
      `INSERT OR REPLACE INTO vital_event
       (person_id, event_type, date_original, date_year, place, source)
       VALUES (@personId, 'birth', @dateOriginal, @dateYear, @place, 'familysearch')`,
      {
        personId,
        dateOriginal: birthDate.trim() || null,
        dateYear: birthYear,
        place: person.location || null,
      }
    );
  }

  if (deathDate && deathDate !== '?') {
    sqliteService.run(
      `INSERT OR REPLACE INTO vital_event
       (person_id, event_type, date_original, date_year, source)
       VALUES (@personId, 'death', @dateOriginal, @dateYear, 'familysearch')`,
      {
        personId,
        dateOriginal: deathDate.trim() || null,
        dateYear: deathYear,
      }
    );
  }

  // Insert occupation as claim (backwards compat)
  if (person.occupation) {
    sqliteService.run(
      `INSERT OR IGNORE INTO claim (claim_id, person_id, predicate, value_text, source)
       VALUES (@claimId, @personId, 'occupation', @value, 'familysearch')`,
      {
        claimId: ulid(),
        personId,
        value: person.occupation,
      }
    );
  }

  // =========================================================================
  // EXPANDED DATA WRITES (Phase 15.6+)
  // =========================================================================

  // Write all life events to the new life_event table
  if (person.allLifeEvents && person.allLifeEvents.length > 0) {
    writeLifeEvents(personId, person.allLifeEvents);
  }

  // Write notes to the note table
  if (person.notes && person.notes.length > 0) {
    writeNotes(personId, person.notes);
  }

  // Write additional claims for quick-access fields
  if (person.religion) {
    sqliteService.run(
      `INSERT OR IGNORE INTO claim (claim_id, person_id, predicate, value_text, source)
       VALUES (@claimId, @personId, 'religion', @value, 'familysearch')`,
      { claimId: ulid(), personId, value: person.religion }
    );
  }

  if (person.titleOfNobility) {
    sqliteService.run(
      `INSERT OR IGNORE INTO claim (claim_id, person_id, predicate, value_text, source)
       VALUES (@claimId, @personId, 'titleOfNobility', @value, 'familysearch')`,
      { claimId: ulid(), personId, value: person.titleOfNobility }
    );
  }

  if (person.militaryService) {
    sqliteService.run(
      `INSERT OR IGNORE INTO claim (claim_id, person_id, predicate, value_text, source)
       VALUES (@claimId, @personId, 'militaryService', @value, 'familysearch')`,
      { claimId: ulid(), personId, value: person.militaryService }
    );
  }

  if (person.causeOfDeath) {
    sqliteService.run(
      `INSERT OR IGNORE INTO claim (claim_id, person_id, predicate, value_text, source)
       VALUES (@claimId, @personId, 'causeOfDeath', @value, 'familysearch')`,
      { claimId: ulid(), personId, value: person.causeOfDeath }
    );
  }

  // Update FTS index with all aliases
  const allAliases = [
    ...(person.aliases || []),
    ...(person.alternateNames || []),
    ...(person.marriedNames || []),
  ];

  const allOccupations = person.occupations || (person.occupation ? [person.occupation] : []);

  sqliteService.updatePersonFts(
    personId,
    person.name,
    person.birthName,
    allAliases,
    person.bio,
    allOccupations
  );

  return personId;
}

/**
 * Write all life events for a person to the life_event table
 */
function writeLifeEvents(personId: string, events: LifeEvent[]): void {
  for (const event of events) {
    // Generate stable event ID based on person + type + source ID
    const eventId = ulid();

    sqliteService.run(
      `INSERT OR REPLACE INTO life_event (
        event_id, person_id, event_type, event_role,
        date_original, date_formal, date_year, date_month, date_day, date_end_year,
        place_original, place_normalized, place_id,
        value, description, cause,
        source, source_id, confidence,
        created_at, updated_at
      ) VALUES (
        @eventId, @personId, @eventType, @eventRole,
        @dateOriginal, @dateFormal, @dateYear, @dateMonth, @dateDay, @dateEndYear,
        @placeOriginal, @placeNormalized, @placeId,
        @value, @description, @cause,
        @source, @sourceId, @confidence,
        datetime('now'), datetime('now')
      )`,
      {
        eventId,
        personId,
        eventType: event.eventType,
        eventRole: event.eventRole || 'principal',
        dateOriginal: event.dateOriginal || null,
        dateFormal: event.dateFormal || null,
        dateYear: event.dateYear ?? null,
        dateMonth: event.dateMonth ?? null,
        dateDay: event.dateDay ?? null,
        dateEndYear: event.dateEndYear ?? null,
        placeOriginal: event.placeOriginal || null,
        placeNormalized: event.placeNormalized || null,
        placeId: event.placeId || null,
        value: event.value || null,
        description: event.description || null,
        cause: event.cause || null,
        source: SOURCE,
        sourceId: event.sourceId || null,
        confidence: 1.0,
      }
    );
  }
}

/**
 * Write notes for a person to the note table
 */
function writeNotes(personId: string, notes: Note[]): void {
  for (const note of notes) {
    const noteId = ulid();

    sqliteService.run(
      `INSERT OR REPLACE INTO note (
        note_id, person_id, note_type, title, content, content_type, language,
        source, source_id, author,
        created_at, updated_at
      ) VALUES (
        @noteId, @personId, @noteType, @title, @content, @contentType, @language,
        @source, @sourceId, @author,
        datetime('now'), datetime('now')
      )`,
      {
        noteId,
        personId,
        noteType: note.noteType || 'custom',
        title: note.title || null,
        content: note.content,
        contentType: note.contentType || 'text',
        language: note.language || 'en',
        source: SOURCE,
        sourceId: note.sourceId || null,
        author: note.author || null,
      }
    );
  }
}

/**
 * Write parent-child relationship to SQLite
 */
function writeParentEdge(childFsId: string, parentFsId: string, parentRole: string): void {
  const childId = getPersonId(childFsId);
  const parentId = getPersonId(parentFsId);

  if (!childId || !parentId) return;

  sqliteService.run(
    `INSERT OR IGNORE INTO parent_edge (child_id, parent_id, parent_role, source)
     VALUES (@childId, @parentId, @parentRole, 'familysearch')`,
    { childId, parentId, parentRole }
  );
}

/**
 * Write database membership for a person
 */
function writeDatabaseMembership(dbId: string, fsId: string, isRoot: boolean, generation: number): void {
  const personId = getPersonId(fsId);
  if (!personId) return;

  sqliteService.run(
    `INSERT OR REPLACE INTO database_membership (db_id, person_id, is_root, generation)
     VALUES (@dbId, @personId, @isRoot, @generation)`,
    {
      dbId,
      personId,
      isRoot: isRoot ? 1 : 0,
      generation,
    }
  );
}

/**
 * Write database info record
 */
function writeDatabaseInfo(
  dbId: string,
  rootFsId: string,
  rootName: string,
  maxGenerations: number,
  personCount: number
): void {
  const rootId = getPersonId(rootFsId);
  if (!rootId) return;

  // Delete any existing database_info entries with the same root_id (different db_id formats)
  // This handles the case where a root was previously indexed with a different db_id format
  sqliteService.run(
    `DELETE FROM database_info WHERE root_id = @rootId AND db_id != @dbId`,
    { rootId, dbId }
  );

  sqliteService.run(
    `INSERT OR REPLACE INTO database_info
     (db_id, root_id, root_name, source_provider, max_generations, is_sample, person_count, updated_at)
     VALUES (@dbId, @rootId, @rootName, 'familysearch', @maxGenerations, 0, @personCount, datetime('now'))`,
    {
      dbId,
      rootId,
      rootName,
      maxGenerations: maxGenerations === Infinity ? null : maxGenerations,
      personCount,
    }
  );
}

/**
 * Finalize database after indexing
 * - Writes all parent edges from the db object
 * - Writes database membership for all persons
 * - Creates database_info record
 */
function finalizeDatabase(dbId: string, rootFsId: string, db: Database, maxGenerations: number): void {
  const rootPerson = db[rootFsId];
  if (!rootPerson) return;

  // Calculate generations via BFS
  const generations = new Map<string, number>();
  const queue: { id: string; gen: number }[] = [{ id: rootFsId, gen: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, gen } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    generations.set(id, gen);

    const person = db[id];
    if (person?.parents) {
      for (const parentId of person.parents) {
        if (parentId && db[parentId] && !visited.has(parentId)) {
          queue.push({ id: parentId, gen: gen + 1 });
        }
      }
    }
  }

  // Find the actual max generation depth from the calculated generations
  const actualMaxGen = Math.max(...generations.values(), 0);

  // Write memberships and parent edges
  sqliteService.transaction(() => {
    for (const fsId of Object.keys(db)) {
      const person = db[fsId];
      const generation = generations.get(fsId) ?? 0;

      // Database membership
      writeDatabaseMembership(dbId, fsId, fsId === rootFsId, generation);

      // Parent edges
      if (person.parents) {
        if (person.parents[0]) {
          writeParentEdge(fsId, person.parents[0], 'father');
        }
        if (person.parents[1]) {
          writeParentEdge(fsId, person.parents[1], 'mother');
        }
      }
    }

    // Database info (after all persons exist) - use actual max generations found
    writeDatabaseInfo(dbId, rootFsId, rootPerson.name, actualMaxGen, Object.keys(db).length);
  });

  // Checkpoint WAL to prevent bloat after large batch writes
  const checkpoint = sqliteService.checkpoint('PASSIVE');
  logger.db('sqlite', `Finalized ${dbId} with ${Object.keys(db).length} persons (WAL checkpointed: ${checkpoint.checkpointed} pages)`);
}

/**
 * Initialize SQLite connection
 */
function init(): void {
  sqliteService.initDb();
}

/**
 * Close SQLite connection
 */
function close(): void {
  sqliteService.closeDb();
}

/**
 * Clear session tracking (for testing/restart)
 */
function clearSession(): void {
  sessionWritten.clear();
}

export const sqliteWriter = {
  init,
  close,
  clearSession,
  getPersonId,
  getOrCreatePersonId,
  writePerson,
  writeParentEdge,
  writeDatabaseMembership,
  writeDatabaseInfo,
  finalizeDatabase,
};
