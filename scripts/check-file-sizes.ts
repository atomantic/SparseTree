#!/usr/bin/env npx tsx

/**
 * File Size Guard
 *
 * Fails CI when any tracked god-file (or its successor) exceeds its line
 * limit. This is the regression alarm for the "Reverse god-file regression"
 * item in PLAN.md — once a file is split or shrunk, we lock in the win by
 * lowering its budget here.
 *
 * Add new entries to FILE_LIMITS as god-files are extracted into smaller
 * modules. The "limit" is intentionally a hair above the current line count
 * so an accidental ten-line drift trips the guard and forces a conversation
 * before it grows back into the four-figure range.
 *
 * Usage:
 *   npx tsx scripts/check-file-sizes.ts          # fail on any over-limit file
 *   npx tsx scripts/check-file-sizes.ts --json   # machine-readable report
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FileLimit {
  path: string;
  limit: number;
  note?: string;
}

export interface FileLimitResult {
  path: string;
  limit: number;
  lines: number;
  status: 'ok' | 'over' | 'missing' | 'shrinkable';
  note?: string;
  /** How much room (or overage) there is. Negative = over limit. */
  slack: number;
}

/**
 * Files we have actively been shrinking, and the cap above which CI fails.
 *
 * When a file is split, lower its limit to (current lines + small buffer)
 * so the next regression is loud. When a file is fully retired, remove it.
 */
export const FILE_LIMITS: readonly FileLimit[] = [
  {
    path: 'client/src/components/person/PersonDetail.tsx',
    limit: 1400,
    note: 'extract usePersonData / usePersonOverrides hooks + sub-components',
  },
  {
    path: 'client/src/components/person/ProviderDataTable.tsx',
    limit: 1280,
    note: 'extract PhotoThumbnail / ComparisonCell / ProviderRow',
  },
  {
    path: 'server/src/services/database.service.ts',
    limit: 1480,
    note: 'split along entity lines (person, edges, events, overrides)',
  },
  {
    path: 'server/src/services/auditor-agent.service.ts',
    limit: 1280,
    note: 'split into walker + per-check modules',
  },
  {
    path: 'server/src/services/multi-platform-comparison.service.ts',
    limit: 1140,
  },
  {
    path: 'client/src/services/api.ts',
    limit: 1290,
    note: 'collapse per-platform link/photo helpers into generics',
  },
  {
    path: 'client/src/components/ancestry-tree/views/VerticalFamilyView.tsx',
    limit: 1020,
  },
  {
    path: 'server/src/services/favorites.service.ts',
    limit: 920,
  },
  {
    path: 'server/src/routes/person.routes.ts',
    limit: 1010,
    note: 'standardize on asyncHandler, drop ad-hoc .catch(next)',
  },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const SHRINK_BUFFER = 50;

function countLines(absolutePath: string): number {
  const content = readFileSync(absolutePath, 'utf8');
  if (content.length === 0) return 0;
  // Count newlines + 1 unless the file ends with a newline (then just newlines).
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

export function evaluateFile(entry: FileLimit, repoRoot: string = REPO_ROOT): FileLimitResult {
  const abs = join(repoRoot, entry.path);
  if (!existsSync(abs)) {
    return {
      path: entry.path,
      limit: entry.limit,
      lines: 0,
      status: 'missing',
      note: entry.note,
      slack: entry.limit,
    };
  }
  const lines = countLines(abs);
  const slack = entry.limit - lines;
  let status: FileLimitResult['status'] = 'ok';
  if (lines > entry.limit) status = 'over';
  else if (slack > SHRINK_BUFFER) status = 'shrinkable';
  return { path: entry.path, limit: entry.limit, lines, status, note: entry.note, slack };
}

export function evaluateAll(
  limits: readonly FileLimit[] = FILE_LIMITS,
  repoRoot: string = REPO_ROOT,
): FileLimitResult[] {
  return limits.map(entry => evaluateFile(entry, repoRoot));
}

function formatRow(r: FileLimitResult): string {
  const icon =
    r.status === 'over' ? '❌' :
    r.status === 'missing' ? '⚠️ ' :
    r.status === 'shrinkable' ? '🔽' : '✅';
  const slack = r.status === 'over' ? `+${r.lines - r.limit}` : `${r.slack}`;
  return `${icon} ${r.path.padEnd(64)} ${String(r.lines).padStart(5)}/${String(r.limit).padEnd(5)}  slack=${slack}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  const results = evaluateAll();

  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    console.log('📏 File size guard');
    for (const r of results) console.log(formatRow(r));
  }

  const over = results.filter(r => r.status === 'over');
  const missing = results.filter(r => r.status === 'missing');
  const shrinkable = results.filter(r => r.status === 'shrinkable');

  if (over.length > 0) {
    console.error(
      `\n❌ ${over.length} file(s) exceed their line budget. Either split the file or, if growth is justified, raise the limit in scripts/check-file-sizes.ts (with rationale in PR description).`,
    );
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(
      `\n⚠️  ${missing.length} tracked file(s) are missing — they may have been moved or deleted. Update FILE_LIMITS to match the new path or remove the entry.`,
    );
    process.exit(1);
  }
  if (!asJson && shrinkable.length > 0) {
    console.log(
      `\n🔽 ${shrinkable.length} file(s) are well under their limit — consider lowering the limit to lock in the win.`,
    );
  }
  if (!asJson) console.log(`\n✅ All ${results.length} files within budget.`);
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) main();
