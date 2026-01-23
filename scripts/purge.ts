#!/usr/bin/env npx tsx
/**
 * Purge records pertaining to specific IDs from cache
 *
 * If you have fixed a record in the FamilySearch database
 * (e.g. you have pruned a cyclic relationship that was invalid)
 * then you can use this script to remove records pertaining to that id
 * which will then allow you to re-run the index script to generate a new local graph
 *
 * Usage:
 *   npx tsx scripts/purge.ts ID1,ID2,...
 */

import chalk from 'chalk';
import fs from 'fs';

const idsArg = process.argv[2];

if (!idsArg) {
  console.error('Usage: npx tsx scripts/purge.ts ID1,ID2,...');
  process.exit(1);
}

const ids = idsArg.split(',');

console.log(`purging ${chalk.blue(ids.length)} ids...`, ids);

const purgeFile = (file: string): void => {
  console.log(`purging ${chalk.blue(file)}...`);
  fs.unlinkSync(file);
};

fs.readdirSync('./data').forEach((file) => {
  if (['.', '..'].includes(file)) return;

  const fileID = file.replace('.json', '').replace('.tsv', '');
  const filePath = `./data/${file}`;

  if (fs.lstatSync(filePath).isDirectory()) {
    fs.readdirSync(filePath).forEach((file2) => {
      if (['.', '..'].includes(file2)) return;

      const file2ID = file2.replace('.json', '');
      const file2Path = `${filePath}/${file2}`;

      if (ids.includes(file2ID)) {
        return purgeFile(file2Path);
      }

      const content = fs.readFileSync(file2Path).toString();
      for (let i = 0; i < ids.length; i++) {
        if (content.includes(ids[i])) {
          return purgeFile(file2Path);
        }
      }
    });
    return;
  }

  if (ids.includes(fileID)) {
    return purgeFile(filePath);
  }

  const content = fs.readFileSync(filePath).toString();
  for (let i = 0; i < ids.length; i++) {
    if (content.includes(ids[i])) {
      return purgeFile(filePath);
    }
  }
});
