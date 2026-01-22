/**
 * SQLite Writer for the Indexer
 *
 * Provides functions to write indexed person data to SQLite database
 * in addition to the JSON files. This enables dual-write during indexing.
 */

import { sqliteService } from '../server/dist/db/sqlite.service.js';
import { idMappingService } from '../server/dist/services/id-mapping.service.js';
import { ulid } from 'ulid';

// Track which FamilySearch IDs have been written in this session
const sessionWritten = new Set();

/**
 * Parse birth/death year from lifespan string
 * Handles BC notation and various formats
 */
function parseYear(lifespan, type) {
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
function getOrCreatePersonId(fsId, displayName, options = {}) {
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
function getPersonId(fsId) {
  return idMappingService.getCanonicalId('familysearch', fsId);
}

/**
 * Write a person to SQLite
 * Called after getPerson() fetches/parses the data
 *
 * @param {string} fsId - FamilySearch person ID
 * @param {object} person - Person object from json2person
 * @param {number} generation - Generation distance from root
 */
function writePerson(fsId, person, generation) {
  if (!person || !fsId) return null;

  // Avoid duplicate writes in same session
  if (sessionWritten.has(fsId)) {
    return getPersonId(fsId);
  }

  // Determine gender from name patterns or default to unknown
  let gender = 'unknown';
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

  // Insert occupation as claim
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

  // Update FTS index
  sqliteService.updatePersonFts(
    personId,
    person.name,
    person.birthName,
    [],  // aliases
    person.bio,
    person.occupation ? [person.occupation] : []
  );

  return personId;
}

/**
 * Write parent-child relationship to SQLite
 */
function writeParentEdge(childFsId, parentFsId, parentRole) {
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
function writeDatabaseMembership(dbId, fsId, isRoot, generation) {
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
function writeDatabaseInfo(dbId, rootFsId, rootName, maxGenerations) {
  const rootId = getPersonId(rootFsId);
  if (!rootId) return;

  sqliteService.run(
    `INSERT OR REPLACE INTO database_info
     (db_id, root_id, root_name, source_provider, max_generations, is_sample, updated_at)
     VALUES (@dbId, @rootId, @rootName, 'familysearch', @maxGenerations, 0, datetime('now'))`,
    {
      dbId,
      rootId,
      rootName,
      maxGenerations: maxGenerations === Infinity ? null : maxGenerations,
    }
  );
}

/**
 * Finalize database after indexing
 * - Writes all parent edges from the db object
 * - Writes database membership for all persons
 * - Creates database_info record
 */
function finalizeDatabase(dbId, rootFsId, db, maxGenerations) {
  const rootPerson = db[rootFsId];
  if (!rootPerson) return;

  // Calculate generations via BFS
  const generations = new Map();
  const queue = [{ id: rootFsId, gen: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const { id, gen } = queue.shift();
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

    // Database info (after all persons exist)
    writeDatabaseInfo(dbId, rootFsId, rootPerson.name, maxGenerations);
  });

  console.log(`SQLite: finalized database ${dbId} with ${Object.keys(db).length} persons`);
}

/**
 * Initialize SQLite connection
 */
function init() {
  sqliteService.initDb();
}

/**
 * Close SQLite connection
 */
function close() {
  sqliteService.closeDb();
}

/**
 * Clear session tracking (for testing/restart)
 */
function clearSession() {
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
