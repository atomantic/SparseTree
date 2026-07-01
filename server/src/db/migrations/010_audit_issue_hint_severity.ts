/**
 * Migration 010: allow 'hint' severity on audit_issue
 *
 * `checkUnlinkedProviders` (auditor-agent.service.ts) has always emitted 'hint'
 * severity for optional-provider suggestions (wikitree/23andme) — a value the
 * shared AuditIssueSeverity type has always declared — but the audit_issue CHECK
 * constraint from migration 007 only allowed ('error', 'warning', 'info'). This
 * was previously unreachable: 'unlinked_provider' was never in DEFAULT_CONFIG and
 * the audit config UI had no way to opt into non-default checks. Now that the
 * config panel exposes a checksEnabled toggle, enabling 'unlinked_provider' would
 * hit the CHECK constraint and crash the audit run the first time it tries to
 * insert a 'hint' issue.
 *
 * SQLite has no ALTER TABLE ... ALTER CONSTRAINT, so this rebuilds the table with
 * the widened CHECK, following SQLite's documented 12-step table-rebuild
 * procedure (disable FK enforcement outside the transaction, since PRAGMA
 * foreign_keys is a no-op once a transaction has begun).
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '010_audit_issue_hint_severity';

export function up(): void {
  logger.db('migration-010', "Widening audit_issue.severity CHECK to allow 'hint'");
  const db = sqliteService.getDb();

  db.pragma('foreign_keys = OFF');
  sqliteService.transaction(() => {
    db.exec(`
      CREATE TABLE audit_issue_new (
        issue_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES audit_run(run_id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('error', 'warning', 'info', 'hint')),
        description TEXT NOT NULL,
        current_value TEXT,
        suggested_value TEXT,
        suggested_source TEXT,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'accepted', 'rejected', 'auto_applied')),
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO audit_issue_new SELECT * FROM audit_issue;

      DROP TABLE audit_issue;
      ALTER TABLE audit_issue_new RENAME TO audit_issue;

      CREATE INDEX IF NOT EXISTS idx_audit_issue_run ON audit_issue(run_id);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_person ON audit_issue(person_id);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_type ON audit_issue(issue_type);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_status ON audit_issue(status);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_severity ON audit_issue(severity);
    `);
  });
  db.pragma('foreign_keys = ON');

  logger.db('migration-010', "audit_issue.severity now accepts 'hint'");
}

export function down(): void {
  const db = sqliteService.getDb();

  db.pragma('foreign_keys = OFF');
  sqliteService.transaction(() => {
    db.exec(`
      CREATE TABLE audit_issue_new (
        issue_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES audit_run(run_id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('error', 'warning', 'info')),
        description TEXT NOT NULL,
        current_value TEXT,
        suggested_value TEXT,
        suggested_source TEXT,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'accepted', 'rejected', 'auto_applied')),
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 'hint' rows can't satisfy the narrower CHECK — drop them rather than fail the rollback.
      INSERT INTO audit_issue_new SELECT * FROM audit_issue WHERE severity != 'hint';

      DROP TABLE audit_issue;
      ALTER TABLE audit_issue_new RENAME TO audit_issue;

      CREATE INDEX IF NOT EXISTS idx_audit_issue_run ON audit_issue(run_id);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_person ON audit_issue(person_id);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_type ON audit_issue(issue_type);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_status ON audit_issue(status);
      CREATE INDEX IF NOT EXISTS idx_audit_issue_severity ON audit_issue(severity);
    `);
  });
  db.pragma('foreign_keys = ON');
}
