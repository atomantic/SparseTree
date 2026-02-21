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

const BINARY_EXTENSIONS = ['.db', '.db-wal', '.db-shm'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const idsArg = args.find((a) => !a.startsWith('--'));

if (!idsArg) {
  console.error('Usage: npx tsx scripts/purge.ts ID1,ID2,... [--dry-run]');
  process.exit(1);
}

const ids = idsArg.split(',');
// Build word-boundary regexes for each ID to avoid partial matches
const idPatterns = ids.map((id) => new RegExp(`"${id}"`));

console.log(`purging ${chalk.blue(ids.length)} ids...`, ids);
if (dryRun) console.log(chalk.yellow('[DRY RUN] No files will be deleted'));

const purgeFile = (file: string): void => {
  if (dryRun) {
    console.log(`${chalk.yellow('[DRY RUN]')} would purge ${chalk.blue(file)}`);
  } else {
    console.log(`purging ${chalk.blue(file)}...`);
    fs.unlinkSync(file);
  }
};

const isBinaryFile = (filename: string): boolean =>
  BINARY_EXTENSIONS.some((ext) => filename.endsWith(ext));

const contentMatchesId = (content: string): boolean =>
  idPatterns.some((pattern) => pattern.test(content));

fs.readdirSync('./data').forEach((file) => {
  if (['.', '..'].includes(file)) return;
  if (isBinaryFile(file)) return;

  const fileID = file.replace('.json', '').replace('.tsv', '');
  const filePath = `./data/${file}`;

  if (fs.lstatSync(filePath).isDirectory()) {
    fs.readdirSync(filePath).forEach((file2) => {
      if (['.', '..'].includes(file2)) return;
      if (isBinaryFile(file2)) return;

      const file2ID = file2.replace('.json', '');
      const file2Path = `${filePath}/${file2}`;

      if (ids.includes(file2ID)) {
        return purgeFile(file2Path);
      }

      const content = fs.readFileSync(file2Path).toString();
      if (contentMatchesId(content)) {
        return purgeFile(file2Path);
      }
    });
    return;
  }

  if (ids.includes(fileID)) {
    return purgeFile(filePath);
  }

  const content = fs.readFileSync(filePath).toString();
  if (contentMatchesId(content)) {
    return purgeFile(filePath);
  }
});
