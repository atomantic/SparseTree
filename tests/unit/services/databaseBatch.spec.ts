/**
 * Unit tests for databaseService.getPersonsBatch ordering.
 *
 * Regression guard: SQLite's `WHERE person_id IN (...)` returns rows in table
 * (rowid) order, not in the order of the IN list. The search service relies on
 * the batch loader to preserve the order it computed via `ORDER BY display_name`,
 * so the loader must re-index results back into the caller's requested order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface PersonRow {
  person_id: string;
  display_name: string;
  birth_name: string | null;
  gender: string | null;
  living: number;
  bio: string | null;
}

// Rows the mocked `person` table query will return — deliberately in a different
// order than any caller would request, to prove the loader re-orders.
let personRows: PersonRow[] = [];

const makeRow = (id: string, name: string): PersonRow => ({
  person_id: id,
  display_name: name,
  birth_name: null,
  gender: 'unknown',
  living: 0,
  bio: null,
});

// Mock the SQLite layer: the base `person` query returns `personRows`; every
// other batch query (vital_event, parent_edge, spouse_edge, claim) returns [].
vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: {
    initDb: vi.fn(),
    closeDb: vi.fn(),
    getStats: vi.fn(() => ({ persons: 0 })),
    queryOne: vi.fn(() => undefined),
    queryAll: vi.fn((sql: string) => {
      if (sql.includes('FROM person WHERE person_id IN')) return personRows;
      return [];
    }),
  },
}));

// Local overrides are exercised elsewhere; make them a no-op here so the batch
// loader can run without a real DB.
vi.mock('../../../server/src/utils/applyOverrides.js', () => ({
  applyLocalOverrides: vi.fn(),
}));

const { databaseService } = await import('../../../server/src/services/database.service.js');

describe('databaseService.getPersonsBatch', () => {
  beforeEach(() => {
    personRows = [];
  });

  it('returns persons in the caller-requested order, not SQLite table order', () => {
    // Table order (what the mock returns) differs from the requested order.
    personRows = [makeRow('P1', 'Alice'), makeRow('P2', 'Bob'), makeRow('P3', 'Carol')];

    const result = databaseService.getPersonsBatch(['P3', 'P1', 'P2']);

    expect(result.map((p) => p.id)).toEqual(['P3', 'P1', 'P2']);
  });

  it('drops requested ids that have no matching person row', () => {
    personRows = [makeRow('P1', 'Alice'), makeRow('P3', 'Carol')];

    const result = databaseService.getPersonsBatch(['P3', 'MISSING', 'P1']);

    expect(result.map((p) => p.id)).toEqual(['P3', 'P1']);
  });

  it('returns an empty array for an empty id list', () => {
    expect(databaseService.getPersonsBatch([])).toEqual([]);
  });
});
