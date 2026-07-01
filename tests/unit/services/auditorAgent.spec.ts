/**
 * Unit tests for the Phase 18 audit checks added on top of the structural
 * validation checks: missing_parents, stale_record, duplicate_suspect.
 *
 * The sqlite layer is mocked with a lightweight query router keyed on
 * distinctive SQL substrings, matching the pattern in databaseBatch.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Params = Record<string, unknown> | undefined;

let personVitalsRows: Record<string, any[]> = {};
let externalIdentityRows: Record<string, { source: string; last_seen_at: string | null }[]> = {};
let parentEdgesByPerson: Record<string, { parent_id: string }[]> = {};
let duplicateCandidateRows: { person_id: string; display_name: string; birth_year: number | null }[] = [];
let runCalls: { sql: string; params: any }[] = [];

vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: {
    queryOne: vi.fn((sql: string) => {
      if (sql.includes('SELECT root_id FROM database_info')) return { root_id: 'ROOT1' };
      if (sql.includes('SELECT COUNT(*) as count FROM database_membership')) return { count: 1 };
      return undefined;
    }),
    queryAll: vi.fn((sql: string, params?: Params) => {
      const personId = (params?.personId as string) ?? '';
      if (sql.includes('FROM person p') && sql.includes('LEFT JOIN vital_event ve')) {
        return personVitalsRows[personId] ?? [];
      }
      // Both the unlinked_provider fallback (auditor-agent.service.ts) and
      // checkStaleRecord's default query share this exact SQL text.
      if (sql.includes('SELECT source, last_seen_at FROM external_identity')) {
        return externalIdentityRows[personId] ?? [];
      }
      if (sql.includes('JOIN database_membership dm')) {
        return duplicateCandidateRows;
      }
      if (sql.includes('SELECT parent_id FROM parent_edge WHERE child_id')) {
        return parentEdgesByPerson[personId] ?? [];
      }
      return [];
    }),
    run: vi.fn((sql: string, params?: any) => {
      runCalls.push({ sql, params });
    }),
    transaction: vi.fn((fn: () => void) => fn()),
  },
}));

vi.mock('../../../server/src/services/database.service.js', () => ({
  resolveDbId: vi.fn((id: string) => id),
}));

const { auditorService } = await import('../../../server/src/services/auditor-agent.service.js');

function insertedIssues(issueType?: string) {
  return runCalls
    .filter(c => c.sql.includes('INSERT OR IGNORE INTO audit_issue'))
    .map(c => c.params)
    .filter(p => !issueType || p.issueType === issueType);
}

const vitalsRow = (id: string, name: string) => ([{
  person_id: id, display_name: name, gender: null, event_type: null, date_year: null,
}]);

describe('auditorService new checks', () => {
  beforeEach(() => {
    personVitalsRows = {};
    externalIdentityRows = {};
    parentEdgesByPerson = {};
    duplicateCandidateRows = [];
    runCalls = [];
  });

  describe('missing_parents', () => {
    it('flags a linked person with no recorded parents', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      externalIdentityRows.P1 = [{ source: 'ancestry', last_seen_at: null }];
      parentEdgesByPerson.P1 = [];

      const result = auditorService.auditPath('DB1', ['P1'], ['missing_parents']);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].issueType).toBe('missing_parents');
      expect(result.issues[0].personId).toBe('P1');
    });

    it('does not flag an unlinked person with no recorded parents', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      externalIdentityRows.P1 = [];
      parentEdgesByPerson.P1 = [];

      const result = auditorService.auditPath('DB1', ['P1'], ['missing_parents']);

      expect(result.issues).toHaveLength(0);
    });

    it('does not flag a linked person who already has recorded parents', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      externalIdentityRows.P1 = [{ source: 'ancestry', last_seen_at: null }];
      parentEdgesByPerson.P1 = [{ parent_id: 'MOTHER1' }, { parent_id: 'FATHER1' }];

      const result = auditorService.auditPath('DB1', ['P1'], ['missing_parents']);

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('stale_record', () => {
    it('flags a provider link older than the stale threshold', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      externalIdentityRows.P1 = [{ source: 'ancestry', last_seen_at: old }];

      const result = auditorService.auditPath('DB1', ['P1'], ['stale_record']);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].issueType).toBe('stale_record');
      expect(result.issues[0].suggestedSource).toBe('ancestry');
    });

    it('does not flag a provider link within the stale threshold', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      externalIdentityRows.P1 = [{ source: 'ancestry', last_seen_at: recent }];

      const result = auditorService.auditPath('DB1', ['P1'], ['stale_record']);

      expect(result.issues).toHaveLength(0);
    });

    it('ignores links with no last_seen_at recorded', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');
      externalIdentityRows.P1 = [{ source: 'ancestry', last_seen_at: null }];

      const result = auditorService.auditPath('DB1', ['P1'], ['stale_record']);

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('duplicate_suspect', () => {
    it('flags two persons with matching normalized names and close birth years', async () => {
      personVitalsRows.ROOT1 = vitalsRow('ROOT1', 'Root Person');
      duplicateCandidateRows = [
        { person_id: 'P1', display_name: 'John Smith', birth_year: 1900 },
        { person_id: 'P2', display_name: '  john   smith ', birth_year: 1901 },
        { person_id: 'P3', display_name: 'Jane Doe', birth_year: 1900 },
      ];

      const events = [];
      for await (const event of auditorService.runAudit('DB1', { checksEnabled: ['duplicate_suspect'] })) {
        events.push(event);
      }

      expect(events.at(-1)?.type).toBe('completed');
      const inserted = insertedIssues('duplicate_suspect');
      expect(inserted).toHaveLength(1);
      expect([inserted[0].personId, inserted[0].currentValue].sort()).toEqual(['P1', 'P2']);
    });

    it('does not flag persons with the same name but distant birth years', async () => {
      personVitalsRows.ROOT1 = vitalsRow('ROOT1', 'Root Person');
      duplicateCandidateRows = [
        { person_id: 'P1', display_name: 'John Smith', birth_year: 1900 },
        { person_id: 'P2', display_name: 'John Smith', birth_year: 1950 },
      ];

      for await (const _event of auditorService.runAudit('DB1', { checksEnabled: ['duplicate_suspect'] })) {
        // drain
      }

      expect(insertedIssues('duplicate_suspect')).toHaveLength(0);
    });

    it('does not run the duplicate pass on resume', async () => {
      // A resumed run has no matching audit_run row in this mock (getRun returns
      // undefined), so runAudit should error out before reaching the duplicate pass.
      duplicateCandidateRows = [
        { person_id: 'P1', display_name: 'John Smith', birth_year: 1900 },
        { person_id: 'P2', display_name: 'John Smith', birth_year: 1900 },
      ];

      const events = [];
      for await (const event of auditorService.runAudit('DB1', { checksEnabled: ['duplicate_suspect'] }, 'nonexistent-run')) {
        events.push(event);
      }

      expect(events.at(-1)?.type).toBe('error');
      expect(insertedIssues('duplicate_suspect')).toHaveLength(0);
    });

    it('is dropped from checksEnabled by auditPath since it is a whole-database check', () => {
      personVitalsRows.P1 = vitalsRow('P1', 'Alice Smith');

      const result = auditorService.auditPath('DB1', ['P1'], ['duplicate_suspect']);

      expect(result.issues).toHaveLength(0);
      expect(insertedIssues('duplicate_suspect')).toHaveLength(0);
    });
  });
});
