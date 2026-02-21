#!/usr/bin/env npx tsx
/**
 * Find a path back from a particular person id to the root
 *
 * Usage:
 *   npx tsx scripts/find.ts ROOT_ID ANCESTOR_ID [options]
 *
 * Options:
 *   --method=s|l|r   shortest/longest/random path (default: s)
 *   --max=N          Use database with N generations limit
 */

import chalk from 'chalk';
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { pathShortest, pathLongest, pathRandom } from '../server/src/lib/graph/index.js';
import { logPerson } from './utils/logPerson.js';
import type { Database } from '@fsf/shared';

type PathMethod = 'l' | 's' | 'r';

const methods = {
  l: pathLongest,
  s: pathShortest,
  r: pathRandom,
} as const;

const methodName: Record<PathMethod, string> = {
  l: 'longest',
  s: 'shortest',
  r: 'random',
};

const argv = yargs(hideBin(process.argv)).argv as {
  _: (string | number)[];
  max?: string | number;
  method?: string | string[];
};

const [selfID, searchID] = argv._ as string[];
const maxGenerations = argv.max || '';
const methodKey = ((argv.method || [])[0] || 's') as PathMethod;
const method = methods[methodKey];

if (!selfID || !searchID) {
  console.error('Usage: npx tsx scripts/find.ts ROOT_ID ANCESTOR_ID [--method=s|l|r]');
  process.exit(1);
}

const dbPath = `./data/db-${selfID}${maxGenerations ? `-${maxGenerations}` : ''}.json`;
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const graph: Database = JSON.parse(fs.readFileSync(dbPath).toString());

(async () => {
  console.log(
    `finding ${methodName[methodKey]} path to ${chalk.blue(
      searchID
    )} in ${chalk.blue(selfID)}...`
  );

  if (!graph[searchID]) {
    console.log(`could not find ${searchID} in graph`);
    process.exit(1);
  }

  const path = await method(graph, searchID, selfID);

  if (!path || path.length === 0) {
    console.log(`no path found from ${searchID} to ${selfID}`);
    process.exit(1);
  }

  path.forEach((id, i) =>
    logPerson({ person: { ...graph[id], id }, icon: '', generation: i })
  );

  console.log(
    `found path from ${searchID} (${graph[searchID]?.name}) to ${selfID} (${
      graph[selfID]?.name
    }) in ${chalk.inverse(` ${path.length - 1} `)} direct generations`
  );
})();
