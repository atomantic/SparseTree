#!/usr/bin/env npx tsx
/**
 * FamilySearch ancestry indexer CLI
 *
 * Usage:
 *   FS_ACCESS_TOKEN=YOUR_TOKEN npx tsx scripts/index.ts PERSON_ID [options]
 *
 * Options:
 *   --max=N          Limit to N generations
 *   --ignore=ID1,ID2 Skip specific person IDs
 *   --cache=all|complete|none  Cache behavior (default: all)
 *   --oldest=YEAR    Only include people born after YEAR (supports BC notation)
 *   --tsv=true       Also log to TSV file during indexing
 */

import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Import from server lib (run via tsx so we can import .ts directly)
import { fscget } from '../server/src/lib/familysearch/fetcher.js';
import { json2person } from '../server/src/lib/familysearch/transformer.js';
import { config } from '../server/src/lib/config.js';
import { sleep } from '../server/src/utils/sleep.js';
import { randInt } from '../server/src/utils/randInt.js';
import { sqliteWriter } from '../server/src/lib/sqlite-writer.js';
import { logPerson } from './utils/logPerson.js';
import type { Person, Database } from '@fsf/shared';

// Ensure provider cache directory exists
const PROVIDER_CACHE_DIR = './data/provider-cache/familysearch';
if (!fs.existsSync(PROVIDER_CACHE_DIR)) {
  fs.mkdirSync(PROVIDER_CACHE_DIR, { recursive: true });
}

const argv = yargs(hideBin(process.argv)).argv as {
  _: (string | number)[];
  max?: string | number;
  ignore?: string;
  cache?: string;
  oldest?: string;
  tsv?: boolean;
};

const [selfID] = argv._ as string[];
const maxGenerations = Number(argv.max || Infinity);
const ignoreIDs = (argv.ignore || '').split(',').filter(Boolean);
const cacheMode = argv.cache || 'all';
const oldest = argv.oldest;
const logToTSV = argv.tsv;

if (!selfID) {
  console.error('Usage: npx tsx scripts/index.ts PERSON_ID [options]');
  process.exit(1);
}

if (logToTSV) {
  fs.writeFileSync(
    `./data/${selfID}.tsv`,
    'Generation\tID\tParents\tLifespan\tName\tInstances\tLocation\tOccupation\tBio\n'
  );
}

const { minDelay, maxDelay } = config;

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 5000;

const icons = {
  cached: '💾',
  refreshed: '🔄',
  new: '✅',
};

const activity = {
  new: 0,
  cached: 0,
  refreshed: 0,
  generations: 0,
  deepest: '',
};

const db: Database = {};

// Initialize SQLite for dual-write
sqliteWriter.init();

const getPerson = async (id: string, generation: number): Promise<void> => {
  if (generation > maxGenerations) return;
  if (generation > activity.generations) {
    activity.generations = generation;
    activity.deepest = id;
  }
  if (ignoreIDs.includes(id)) {
    console.log(`skipping ${id}...`);
    return;
  }
  if (db[id]) return; // already indexed

  const file = `./data/provider-cache/familysearch/${id}.json`;
  let apidata: unknown;
  let contents = '';
  const cached = fs.existsSync(file);
  let icon = cached ? icons.cached : icons.new;
  let getAPIData = !cached;

  if (cacheMode === 'all' && !cached) getAPIData = true;
  if (cacheMode === 'none') getAPIData = true;
  if (cacheMode === 'complete' && cached) {
    contents = fs.readFileSync(file).toString();
    apidata = JSON.parse(contents);
    const person = json2person(apidata);
    if (person && person.parents.length !== 2) getAPIData = true;
  }

  if (getAPIData) {
    if (icon === icons.cached) {
      icon = icons.refreshed;
      activity.refreshed++;
    } else {
      activity.new++;
    }

    // Fetch with retry logic for transient errors
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await fscget(`/platform/tree/persons/${id}`).catch(
        (err: { _error?: unknown }) => ({ _error: err })
      );

      // Success - got data
      if (!(result as { _error?: unknown })?._error) {
        apidata = result;
        break;
      }

      const error = (result as { _error: {
        errors?: Array<{ message?: string }>;
        isTransient?: boolean;
        code?: string;
        isNetworkError?: boolean;
        message?: string;
        statusCode?: number;
      } })._error;

      // Handle "person deleted" API error - not retryable
      if (
        error.errors &&
        error.errors[0]?.message?.includes(`Unable to read Person`)
      ) {
        console.log(`purging ${id} from cache and reloading children...`);
        if (cached) fs.unlinkSync(file);
        delete db[id];
        const dbIds = Object.keys(db);
        for (let i = 0; i < dbIds.length; i++) {
          const child = dbIds[i];
          if (db[child].parents.includes(id)) {
            console.log(`refreshing child ${child}...`);
            await getPerson(child, generation - 1);
          }
        }
        return;
      }

      // Check if error is transient and retryable
      if (error.isTransient && attempt < MAX_RETRIES) {
        const retryDelay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.log(
          `⚠️ ${error.code || 'Network error'} for ${id}, retrying in ${
            retryDelay / 1000
          }s (attempt ${attempt + 1}/${MAX_RETRIES})...`
        );
        await sleep(retryDelay);
        continue;
      }

      // Non-transient error or exhausted retries
      const errorMsg = error.isNetworkError
        ? `Network error: ${error.code || error.message}`
        : `API error: ${error.errors?.[0]?.message || error.statusCode || 'Unknown'}`;

      console.error(
        `❌ Failed to fetch ${id} after ${attempt + 1} attempts: ${errorMsg}`
      );
      console.error(`   You may want to run: npx tsx scripts/purge.ts ${id}`);

      return;
    }

    if (apidata) {
      const jsondata = JSON.stringify(apidata, null, 2);
      if (contents !== jsondata) {
        fs.writeFileSync(file, jsondata);
      }
    } else {
      console.log(`no apidata for ${id}`);
      return;
    }

    const sleepInt = randInt(minDelay, maxDelay);
    await sleep(sleepInt);
  } else {
    activity.cached++;
  }

  const json = apidata || JSON.parse(fs.readFileSync(file).toString());
  const person = json2person(json);

  if (!person) {
    console.log(`no person for ${id}`);
    return;
  }

  // Check if person is too old
  if (oldest) {
    const oldestYear =
      Number(String(oldest).replace('BC', '')) *
      (String(oldest).includes('BC') ? -1 : 1);
    const [birth] = (person.lifespan || '').split('-');
    let birthYear = Number.MAX_SAFE_INTEGER;
    if (birth) {
      birthYear =
        Number(birth.replace('BC', '')) * (birth.includes('BC') ? -1 : 1);
    }
    if (birthYear < oldestYear) {
      console.log(
        `skipping ${id} (${person.lifespan}) because it is older than ${oldest}...`
      );
      return;
    }
  }

  db[id] = person;

  // Write to SQLite (dual-write)
  sqliteWriter.writePerson(id, person, generation);

  logPerson({ person: { ...db[id], id }, icon, generation, logToTSV, selfID });

  if (person.parents[0]) await getPerson(person.parents[0], generation + 1);
  if (person.parents[1]) await getPerson(person.parents[1], generation + 1);
};

const saveDB = async (): Promise<void> => {
  // Add children to db for each member
  Object.keys(db).forEach((id) => {
    const person = db[id];
    if (!person.parents || !person.parents.length) return;
    person.parents.forEach((parentId) => {
      if (!parentId || !db[parentId]) return;
      if (!db[parentId].children) db[parentId].children = [];
      if (db[parentId].children.includes(id)) return;
      db[parentId].children.push(id);
    });
  });

  const fileName = `./data/db-${selfID}${
    maxGenerations < Infinity ? `-${maxGenerations}` : ''
  }.json`;
  fs.writeFileSync(fileName, JSON.stringify(db, null, 2));

  // Finalize SQLite database
  const dbId = sqliteWriter.getOrCreatePersonId(selfID, db[selfID]?.name || 'Unknown');
  sqliteWriter.finalizeDatabase(dbId, selfID, db, maxGenerations);

  console.log(
    `finished building ${fileName} with ${
      Object.keys(db).length
    } people, cached: ${activity.cached}, refreshed: ${
      activity.refreshed
    }, new: ${activity.new}, max generation: ${activity.generations} with ${
      activity.deepest
    }`
  );
};

process.on('SIGINT', async () => {
  await saveDB();
  sqliteWriter.close();
  process.exit();
});

(async () => {
  await getPerson(selfID, 0);
  await saveDB();
  sqliteWriter.close();
})();
