/**
 * Unit tests for scripts/check-file-sizes.ts
 *
 * The script is the CI guard that fails when god-files grow beyond their
 * recorded budget. These tests pin its evaluation logic against a fixture
 * tree built in a temp directory so they don't break when real source files
 * change line counts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateFile,
  evaluateAll,
  FILE_LIMITS,
} from '../../../scripts/check-file-sizes.js';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sparsetree-filesize-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });

  // 100 lines, no trailing newline
  writeFileSync(
    join(tmpRoot, 'src', 'tight.ts'),
    Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`).join('\n'),
  );

  // 100 lines, with trailing newline (line count should still be 100)
  writeFileSync(
    join(tmpRoot, 'src', 'trailing-newline.ts'),
    Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n',
  );

  // 200 lines — well under any reasonable limit
  writeFileSync(
    join(tmpRoot, 'src', 'shrinkable.ts'),
    Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`).join('\n'),
  );

  // 0 lines — empty file
  writeFileSync(join(tmpRoot, 'src', 'empty.ts'), '');
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('evaluateFile', () => {
  it('returns ok when within limit', () => {
    const result = evaluateFile({ path: 'src/tight.ts', limit: 100 }, tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.lines).toBe(100);
    expect(result.slack).toBe(0);
  });

  it('does not double-count a trailing newline', () => {
    const result = evaluateFile({ path: 'src/trailing-newline.ts', limit: 100 }, tmpRoot);
    expect(result.lines).toBe(100);
    expect(result.status).toBe('ok');
  });

  it('flags files over the limit', () => {
    const result = evaluateFile({ path: 'src/tight.ts', limit: 50 }, tmpRoot);
    expect(result.status).toBe('over');
    expect(result.slack).toBeLessThan(0);
    expect(result.lines).toBe(100);
    expect(result.limit).toBe(50);
  });

  it('flags files significantly under the limit as shrinkable', () => {
    const result = evaluateFile({ path: 'src/shrinkable.ts', limit: 1000 }, tmpRoot);
    expect(result.status).toBe('shrinkable');
    expect(result.slack).toBeGreaterThan(50);
  });

  it('reports missing files with status "missing"', () => {
    const result = evaluateFile({ path: 'src/does-not-exist.ts', limit: 100 }, tmpRoot);
    expect(result.status).toBe('missing');
    expect(result.lines).toBe(0);
  });

  it('treats empty files as 0 lines', () => {
    const result = evaluateFile({ path: 'src/empty.ts', limit: 200 }, tmpRoot);
    expect(result.lines).toBe(0);
    expect(result.status).toBe('shrinkable');
  });

  it('preserves the note from the limit entry', () => {
    const result = evaluateFile(
      { path: 'src/tight.ts', limit: 200, note: 'extract submodule X' },
      tmpRoot,
    );
    expect(result.note).toBe('extract submodule X');
  });
});

describe('evaluateAll', () => {
  it('evaluates each entry exactly once and preserves order', () => {
    const limits = [
      { path: 'src/tight.ts', limit: 100 },
      { path: 'src/shrinkable.ts', limit: 1000 },
    ];
    const results = evaluateAll(limits, tmpRoot);
    expect(results).toHaveLength(2);
    expect(results[0].path).toBe('src/tight.ts');
    expect(results[1].path).toBe('src/shrinkable.ts');
  });
});

describe('FILE_LIMITS configuration', () => {
  it('declares unique paths', () => {
    const paths = FILE_LIMITS.map(e => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('has positive integer limits', () => {
    for (const entry of FILE_LIMITS) {
      expect(entry.limit).toBeGreaterThan(0);
      expect(Number.isInteger(entry.limit)).toBe(true);
    }
  });

  it('has all current files under their declared limit', () => {
    // This is the contract: every tracked file must be at or under its
    // budget at HEAD. If this fails, either split the file or raise the
    // limit (with rationale in the PR).
    const results = evaluateAll();
    const over = results.filter(r => r.status === 'over');
    const missing = results.filter(r => r.status === 'missing');
    expect(over).toEqual([]);
    expect(missing).toEqual([]);
  });
});
