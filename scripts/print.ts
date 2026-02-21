#!/usr/bin/env npx tsx
/**
 * Print out the graph in a flat list, ordered by birth/death dates
 *
 * Usage:
 *   npx tsx scripts/print.ts DB_ID [--bio]
 */

import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { config } from '../server/src/lib/config.js';
import { logPerson } from './utils/logPerson.js';
import type { Person, Database } from '@fsf/shared';

interface SortedPerson extends Person {
  id: string;
  birth: number;
  death: number;
  year: number;
}

const argv = yargs(hideBin(process.argv)).argv as {
  _: (string | number)[];
  bio?: boolean;
};

const [id] = argv._ as string[];
const bio = !!argv.bio;

if (!id) {
  console.error('Usage: npx tsx scripts/print.ts DB_ID [--bio]');
  process.exit(1);
}

const dbPath = `data/db-${id}.json`;
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db: Database = JSON.parse(fs.readFileSync(dbPath).toString());

const sortedPeople: SortedPerson[] = [];

// lifespan can be Living, Deceased, BIRTH-DEATH or BIRTH- or -DEATH, BIRTH-Deceased
// it can also contain a BC notation
const fixYear = (year: string): number => {
  if (year.includes('BC')) return Number(year.replace('BC', '')) * -1;
  const n = Number(year);
  return isNaN(n) ? 0 : n;
};

Object.keys(db).forEach((personId) => {
  const dates = db[personId].lifespan.split('-');
  const birth = fixYear(dates[0] || '');
  const death = fixYear(dates[1] || '');
  const year = birth || death;
  sortedPeople.push({ ...db[personId], id: personId, birth, death, year });
});

sortedPeople.sort((a, b) => (a.year < b.year ? -1 : 1));

sortedPeople.forEach((person) =>
  !config.knownUnknowns.includes(person.name.toLowerCase())
    ? logPerson({ person, bio })
    : false
);
