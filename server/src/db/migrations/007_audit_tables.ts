/**
 * Migration 007: Add audit tables for Tree Auditor Agent
 *
 * Creates tables for tracking audit runs, issues found,
 * and changes applied. Supports pause/resume via cursor
 * serialization and undo via change logging.
 */

import { sqliteService } from '../sqlite.service.js';
import { logger } from '../../lib/logger.js';

export const name = '007_audit_tables';

export async function up(): Promise<void> {
  logger.db('migration-007', 'Creating audit tables');
  sqliteService.getDb().exec(`
    -- Track audit runs (persistent job state)
    CREATE TABLE IF NOT EXISTS audit_run (
      run_id TEXT PRIMARY KEY,
      db_id TEXT NOT NULL,
      root_person_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'running', 'paused', 'completed', 'cancelled', 'error')),
      config JSON NOT NULL,
      cursor JSON,
      started_at TEXT,
      paused_at TEXT,
      completed_at TEXT,
      persons_checked INTEGER DEFAULT 0,
      issues_found INTEGER DEFAULT 0,
      fixes_applied INTEGER DEFAULT 0,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_run_db ON audit_run(db_id);
    CREATE INDEX IF NOT EXISTS idx_audit_run_status ON audit_run(status);

    -- Issues found by the auditor (review queue)
    CREATE TABLE IF NOT EXISTS audit_issue (
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

    CREATE INDEX IF NOT EXISTS idx_audit_issue_run ON audit_issue(run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_issue_person ON audit_issue(person_id);
    CREATE INDEX IF NOT EXISTS idx_audit_issue_type ON audit_issue(issue_type);
    CREATE INDEX IF NOT EXISTS idx_audit_issue_status ON audit_issue(status);
    CREATE INDEX IF NOT EXISTS idx_audit_issue_severity ON audit_issue(severity);

    -- Log of changes applied (undo support)
    CREATE TABLE IF NOT EXISTS audit_change (
      change_id TEXT PRIMARY KEY,
      issue_id TEXT REFERENCES audit_issue(issue_id) ON DELETE SET NULL,
      person_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_change_issue ON audit_change(issue_id);
    CREATE INDEX IF NOT EXISTS idx_audit_change_person ON audit_change(person_id);
  `);
  logger.db('migration-007', 'Audit tables created');
}

export async function down(): Promise<void> {
  sqliteService.getDb().exec(`
    DROP INDEX IF EXISTS idx_audit_change_person;
    DROP INDEX IF EXISTS idx_audit_change_issue;
    DROP TABLE IF EXISTS audit_change;

    DROP INDEX IF EXISTS idx_audit_issue_severity;
    DROP INDEX IF EXISTS idx_audit_issue_status;
    DROP INDEX IF EXISTS idx_audit_issue_type;
    DROP INDEX IF EXISTS idx_audit_issue_person;
    DROP INDEX IF EXISTS idx_audit_issue_run;
    DROP TABLE IF EXISTS audit_issue;

    DROP INDEX IF EXISTS idx_audit_run_status;
    DROP INDEX IF EXISTS idx_audit_run_db;
    DROP TABLE IF EXISTS audit_run;
  `);
}
