/**
 * Tree Auditor Agent Service
 *
 * Long-running background agent that BFS-walks a family tree from root,
 * validates data integrity, and logs issues for review. Supports
 * pause/resume via cursor serialization and cancellation.
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type {
  AuditRunConfig,
  AuditRun,
  AuditCursor,
  AuditIssue,
  AuditIssueType,
  AuditIssueSeverity,
  AuditProgress,
  AuditSummary,
  AuditRunStatus,
  BuiltInProvider,
} from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { resolveDbId } from './database.service.js';
import { logger } from '../lib/logger.js';
import { createOperationTracker } from '../utils/operationTracker.js';
import config from '../lib/config.js';

const tracker = createOperationTracker('auditor');
const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);

// Whitelist of table.field combinations the auditor is allowed to mutate/undo
const ALLOWED_UNDO_TARGETS: Record<string, Set<string>> = {
  person: new Set(['gender', 'display_name', 'birth_name']),
};

const COVERAGE_PROVIDERS: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree', '23andme'];

// ============================================================================
// PERSISTENCE: audit_run CRUD
// ============================================================================

type AuditRunRow = {
  run_id: string;
  db_id: string;
  root_person_id: string;
  status: AuditRunStatus;
  config: string;
  cursor: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  persons_checked: number;
  issues_found: number;
  fixes_applied: number;
  error_message: string | null;
};

function rowToRun(row: AuditRunRow): AuditRun {
  return {
    runId: row.run_id,
    dbId: row.db_id,
    rootPersonId: row.root_person_id,
    status: row.status,
    config: JSON.parse(row.config),
    cursor: row.cursor ? JSON.parse(row.cursor) : null,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    personsChecked: row.persons_checked,
    issuesFound: row.issues_found,
    fixesApplied: row.fixes_applied,
    errorMessage: row.error_message,
  };
}

type AuditIssueRow = {
  issue_id: string;
  run_id: string;
  person_id: string;
  display_name: string | null;
  issue_type: AuditIssueType;
  severity: AuditIssueSeverity;
  description: string;
  current_value: string | null;
  suggested_value: string | null;
  suggested_source: string | null;
  status: string;
  resolved_at: string | null;
  created_at: string;
};

function rowToIssue(row: AuditIssueRow): AuditIssue {
  return {
    issueId: row.issue_id,
    runId: row.run_id,
    personId: row.person_id,
    personName: row.display_name ?? undefined,
    issueType: row.issue_type,
    severity: row.severity,
    description: row.description,
    currentValue: row.current_value,
    suggestedValue: row.suggested_value,
    suggestedSource: row.suggested_source,
    status: row.status as AuditIssue['status'],
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

function createRun(dbId: string, rootPersonId: string, runConfig: AuditRunConfig): AuditRun {
  const runId = ulid();
  const now = new Date().toISOString();

  sqliteService.run(
    `INSERT INTO audit_run (run_id, db_id, root_person_id, status, config, started_at)
     VALUES (@runId, @dbId, @rootPersonId, 'queued', @config, @startedAt)`,
    {
      runId,
      dbId,
      rootPersonId,
      config: JSON.stringify(runConfig),
      startedAt: now,
    }
  );

  return {
    runId,
    dbId,
    rootPersonId,
    status: 'queued',
    config: runConfig,
    cursor: null,
    startedAt: now,
    pausedAt: null,
    completedAt: null,
    personsChecked: 0,
    issuesFound: 0,
    fixesApplied: 0,
    errorMessage: null,
  };
}

function updateRunStatus(runId: string, status: AuditRunStatus, extra?: Record<string, unknown>): void {
  const sets = ['status = @status'];
  const params: Record<string, unknown> = { runId, status };

  if (status === 'paused') {
    sets.push('paused_at = @pausedAt');
    params.pausedAt = new Date().toISOString();
  }
  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    sets.push('completed_at = @completedAt');
    params.completedAt = new Date().toISOString();
  }
  if (extra?.errorMessage) {
    sets.push('error_message = @errorMessage');
    params.errorMessage = extra.errorMessage;
  }
  if (extra?.cursor !== undefined) {
    sets.push('cursor = @cursor');
    params.cursor = extra.cursor ? JSON.stringify(extra.cursor) : null;
  }

  sqliteService.run(
    `UPDATE audit_run SET ${sets.join(', ')} WHERE run_id = @runId`,
    params
  );
}

function updateRunCounters(runId: string, personsChecked: number, issuesFound: number, fixesApplied: number): void {
  sqliteService.run(
    `UPDATE audit_run SET persons_checked = @personsChecked, issues_found = @issuesFound, fixes_applied = @fixesApplied
     WHERE run_id = @runId`,
    { runId, personsChecked, issuesFound, fixesApplied }
  );
}

function saveCursor(runId: string, cursor: AuditCursor): void {
  sqliteService.run(
    'UPDATE audit_run SET cursor = @cursor WHERE run_id = @runId',
    { runId, cursor: JSON.stringify(cursor) }
  );
}

function getRun(runId: string): AuditRun | undefined {
  const row = sqliteService.queryOne<AuditRunRow>(
    'SELECT * FROM audit_run WHERE run_id = @runId',
    { runId }
  );

  if (!row) return undefined;
  return rowToRun(row);
}

function getRunsByDb(dbId: string): AuditRun[] {
  const rows = sqliteService.queryAll<AuditRunRow>(
    'SELECT * FROM audit_run WHERE db_id = @dbId ORDER BY started_at DESC',
    { dbId }
  );

  return rows.map(rowToRun);
}

// ============================================================================
// PERSISTENCE: audit_issue CRUD
// ============================================================================

function insertIssue(issue: AuditIssue): void {
  sqliteService.run(
    `INSERT OR IGNORE INTO audit_issue
       (issue_id, run_id, person_id, issue_type, severity, description,
        current_value, suggested_value, suggested_source, status, created_at)
     VALUES
       (@issueId, @runId, @personId, @issueType, @severity, @description,
        @currentValue, @suggestedValue, @suggestedSource, @status, @createdAt)`,
    {
      issueId: issue.issueId,
      runId: issue.runId,
      personId: issue.personId,
      issueType: issue.issueType,
      severity: issue.severity,
      description: issue.description,
      currentValue: issue.currentValue,
      suggestedValue: issue.suggestedValue,
      suggestedSource: issue.suggestedSource,
      status: issue.status,
      createdAt: issue.createdAt,
    }
  );
}

function getIssues(
  dbId: string,
  filters?: { type?: AuditIssueType; severity?: AuditIssueSeverity; status?: string; runId?: string }
): AuditIssue[] {
  const conditions = ['ar.db_id = @dbId'];
  const params: Record<string, unknown> = { dbId };

  if (filters?.type) {
    conditions.push('ai.issue_type = @type');
    params.type = filters.type;
  }
  if (filters?.severity) {
    conditions.push('ai.severity = @severity');
    params.severity = filters.severity;
  }
  if (filters?.status) {
    conditions.push('ai.status = @status');
    params.status = filters.status;
  }
  if (filters?.runId) {
    conditions.push('ai.run_id = @runId');
    params.runId = filters.runId;
  }

  const rows = sqliteService.queryAll<AuditIssueRow>(
    `SELECT ai.*, p.display_name
     FROM audit_issue ai
     JOIN audit_run ar ON ai.run_id = ar.run_id
     LEFT JOIN person p ON ai.person_id = p.person_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE ai.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       ai.created_at DESC
     LIMIT 500`,
    params
  );

  return rows.map(rowToIssue);
}

function getIssue(issueId: string): AuditIssue | undefined {
  const row = sqliteService.queryOne<AuditIssueRow>(
    `SELECT ai.*, p.display_name
     FROM audit_issue ai
     LEFT JOIN person p ON ai.person_id = p.person_id
     WHERE ai.issue_id = @issueId`,
    { issueId }
  );

  if (!row) return undefined;
  return rowToIssue(row);
}

function getRunSummary(runId: string): AuditSummary | undefined {
  const run = getRun(runId);
  if (!run) return undefined;

  const byType = sqliteService.queryAll<{ issue_type: string; count: number }>(
    'SELECT issue_type, COUNT(*) as count FROM audit_issue WHERE run_id = @runId GROUP BY issue_type',
    { runId }
  );
  const bySeverity = sqliteService.queryAll<{ severity: string; count: number }>(
    'SELECT severity, COUNT(*) as count FROM audit_issue WHERE run_id = @runId GROUP BY severity',
    { runId }
  );
  const byStatus = sqliteService.queryAll<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM audit_issue WHERE run_id = @runId GROUP BY status',
    { runId }
  );

  return {
    run,
    issuesByType: Object.fromEntries(byType.map(r => [r.issue_type, r.count])),
    issuesBySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r.count])),
    issuesByStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
  };
}

// ============================================================================
// STRUCTURAL VALIDATION CHECKS (local data only, no API calls)
// ============================================================================

interface PersonVitals {
  personId: string;
  displayName: string;
  gender: string | null;
  birthYear: number | null;
  deathYear: number | null;
  burialYear: number | null;
  christeningYear: number | null;
}

function getPersonVitals(personId: string): PersonVitals | undefined {
  // Single JOIN query instead of two separate queries
  const rows = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    gender: string | null;
    event_type: string | null;
    date_year: number | null;
  }>(
    `SELECT p.person_id, p.display_name, p.gender, ve.event_type, ve.date_year
     FROM person p
     LEFT JOIN vital_event ve ON p.person_id = ve.person_id
     WHERE p.person_id = @personId`,
    { personId }
  );

  if (rows.length === 0) return undefined;

  const first = rows[0];
  const yearFor = (type: string) => rows.find(r => r.event_type === type)?.date_year ?? null;

  return {
    personId: first.person_id,
    displayName: first.display_name,
    gender: first.gender,
    birthYear: yearFor('birth'),
    deathYear: yearFor('death'),
    burialYear: yearFor('burial'),
    christeningYear: yearFor('christening'),
  };
}

function checkImpossibleDates(runId: string, vitals: PersonVitals): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const { personId, displayName, birthYear, deathYear, burialYear } = vitals;

  // Born after death
  if (birthYear && deathYear && birthYear > deathYear) {
    issues.push(makeIssue(runId, personId, 'impossible_date', 'error',
      `${displayName}: birth year (${birthYear}) is after death year (${deathYear})`,
      String(birthYear), String(deathYear)));
  }

  // Burial before death
  if (deathYear && burialYear && burialYear < deathYear) {
    issues.push(makeIssue(runId, personId, 'impossible_date', 'warning',
      `${displayName}: burial year (${burialYear}) is before death year (${deathYear})`,
      String(burialYear), String(deathYear)));
  }

  // Unreasonable lifespan (> 120 years)
  if (birthYear && deathYear && (deathYear - birthYear) > 120) {
    issues.push(makeIssue(runId, personId, 'impossible_date', 'warning',
      `${displayName}: lifespan of ${deathYear - birthYear} years seems unreasonable`,
      String(deathYear - birthYear), null));
  }

  return issues;
}

function checkParentAgeConflict(runId: string, personId: string, displayName: string, birthYear: number | null): AuditIssue[] {
  if (!birthYear) return [];

  // Single query with JOIN to get parent info + birth year
  const parents = sqliteService.queryAll<{
    parent_id: string;
    parent_role: string;
    display_name: string;
    parent_birth_year: number | null;
  }>(
    `SELECT pe.parent_id, pe.parent_role, p.display_name,
            ve.date_year as parent_birth_year
     FROM parent_edge pe
     JOIN person p ON pe.parent_id = p.person_id
     LEFT JOIN vital_event ve ON ve.person_id = pe.parent_id AND ve.event_type = 'birth'
     WHERE pe.child_id = @personId`,
    { personId }
  );

  const issues: AuditIssue[] = [];

  for (const parent of parents) {
    if (!parent.parent_birth_year) continue;

    const ageAtChildBirth = birthYear - parent.parent_birth_year;

    // Check negative age first (more specific) before < 12 (which also catches negatives)
    if (ageAtChildBirth < 0) {
      issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'error',
        `${parent.display_name} (${parent.parent_role}) born after ${displayName} — parent born ${parent.parent_birth_year}, child born ${birthYear}`,
        String(parent.parent_birth_year), String(birthYear)));
    } else if (ageAtChildBirth < 12) {
      issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'error',
        `${parent.display_name} (${parent.parent_role}) was ${ageAtChildBirth} at birth of ${displayName} — too young`,
        String(ageAtChildBirth), null));
    } else if (ageAtChildBirth > 80) {
      issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'warning',
        `${parent.display_name} (${parent.parent_role}) was ${ageAtChildBirth} at birth of ${displayName} — unusually old`,
        String(ageAtChildBirth), null));
    }
  }

  return issues;
}

function checkPlaceholderName(runId: string, personId: string, displayName: string): AuditIssue[] {
  const normalized = displayName.toLowerCase().trim();
  if (config.knownUnknowns.some(u => u.toLowerCase() === normalized)) {
    return [makeIssue(runId, personId, 'placeholder_name', 'info',
      `"${displayName}" is a placeholder name`,
      displayName, null)];
  }
  return [];
}

function checkMissingGender(runId: string, personId: string, displayName: string, gender: string | null): AuditIssue[] {
  if (gender && gender !== 'unknown') return [];

  const parentRole = sqliteService.queryOne<{ parent_role: string }>(
    'SELECT parent_role FROM parent_edge WHERE parent_id = @personId LIMIT 1',
    { personId }
  );

  if (parentRole?.parent_role === 'father' || parentRole?.parent_role === 'mother') {
    const implied = parentRole.parent_role === 'father' ? 'male' : 'female';
    return [makeIssue(runId, personId, 'missing_gender', 'info',
      `${displayName} has gender "${gender ?? 'null'}" but is listed as ${parentRole.parent_role} — should be ${implied}`,
      gender ?? 'unknown', implied)];
  }

  return [];
}

function checkOrphanedEdges(runId: string, personId: string): AuditIssue[] {
  const orphans = sqliteService.queryAll<{
    id: number;
    parent_id: string;
    parent_role: string;
  }>(
    `SELECT pe.id, pe.parent_id, pe.parent_role
     FROM parent_edge pe
     LEFT JOIN person p ON pe.parent_id = p.person_id
     WHERE pe.child_id = @personId AND p.person_id IS NULL`,
    { personId }
  );

  return orphans.map(o => makeIssue(runId, personId, 'orphaned_edge', 'error',
    `Parent edge references non-existent ${o.parent_role} (${o.parent_id})`,
    o.parent_id, null));
}

function checkCoverageGaps(runId: string, personId: string, displayName: string): AuditIssue[] {
  const linked = sqliteService.queryAll<{ source: string }>(
    'SELECT DISTINCT source FROM external_identity WHERE person_id = @personId',
    { personId }
  );

  const linkedSources = new Set(linked.map(l => l.source));

  // Only flag if person has at least one provider link (otherwise they're likely too old/mythological)
  if (linkedSources.size === 0) return [];

  const missing = COVERAGE_PROVIDERS.filter(p => !linkedSources.has(p));
  if (missing.length === 0) return [];

  return missing.map(provider => makeIssue(
    runId, personId, 'coverage_gap', 'info',
    `${displayName} is linked to ${[...linkedSources].join(', ')} but not ${provider}`,
    [...linkedSources].join(','), provider, provider,
  ));
}

function checkDateMismatches(runId: string, personId: string, displayName: string): AuditIssue[] {
  const events = sqliteService.queryAll<{
    event_type: string;
    date_year: number | null;
    source: string;
  }>(
    `SELECT event_type, date_year, source FROM vital_event
     WHERE person_id = @personId AND date_year IS NOT NULL
     ORDER BY event_type, source`,
    { personId }
  );

  const issues: AuditIssue[] = [];
  const byType = new Map<string, { year: number; source: string }[]>();

  for (const e of events) {
    if (!e.date_year) continue;
    const list = byType.get(e.event_type) ?? [];
    list.push({ year: e.date_year, source: e.source ?? 'unknown' });
    byType.set(e.event_type, list);
  }

  for (const [eventType, entries] of byType) {
    if (entries.length < 2) continue;
    const years = new Set(entries.map(e => e.year));
    if (years.size > 1) {
      const details = entries.map(e => `${e.source}: ${e.year}`).join(', ');
      issues.push(makeIssue(runId, personId, 'date_mismatch', 'warning',
        `${displayName}: ${eventType} date differs across sources (${details})`,
        details, null));
    }
  }

  return issues;
}

// ============================================================================
// ISSUE RESOLUTION ENGINE (Phase 18.5)
// ============================================================================

function acceptIssue(issueId: string): { success: boolean; error?: string } {
  const issue = getIssue(issueId);
  if (!issue) return { success: false, error: 'Issue not found' };
  if (issue.status !== 'open') return { success: false, error: `Issue is already ${issue.status}` };

  // Apply fix for issue types that have auto-fix handlers
  if (issue.suggestedValue && issue.issueType === 'missing_gender') {
    const changeId = ulid();
    const person = sqliteService.queryOne<{ gender: string | null }>(
      'SELECT gender FROM person WHERE person_id = @personId',
      { personId: issue.personId }
    );

    sqliteService.run(
      'UPDATE person SET gender = @gender WHERE person_id = @personId',
      { personId: issue.personId, gender: issue.suggestedValue }
    );

    sqliteService.run(
      `INSERT INTO audit_change (change_id, issue_id, person_id, table_name, field, old_value, new_value)
       VALUES (@changeId, @issueId, @personId, 'person', 'gender', @oldValue, @newValue)`,
      {
        changeId,
        issueId,
        personId: issue.personId,
        oldValue: person?.gender ?? null,
        newValue: issue.suggestedValue,
      }
    );

    sqliteService.run(
      'UPDATE audit_run SET fixes_applied = fixes_applied + 1 WHERE run_id = @runId',
      { runId: issue.runId }
    );
  }

  // Mark issue as accepted
  sqliteService.run(
    "UPDATE audit_issue SET status = 'accepted', resolved_at = @now WHERE issue_id = @issueId",
    { issueId, now: new Date().toISOString() }
  );

  return { success: true };
}

function rejectIssue(issueId: string): { success: boolean; error?: string } {
  const issue = getIssue(issueId);
  if (!issue) return { success: false, error: 'Issue not found' };
  if (issue.status !== 'open') return { success: false, error: `Issue is already ${issue.status}` };

  sqliteService.run(
    "UPDATE audit_issue SET status = 'rejected', resolved_at = @now WHERE issue_id = @issueId",
    { issueId, now: new Date().toISOString() }
  );

  return { success: true };
}

function bulkAcceptIssues(issueIds: string[]): { accepted: number; errors: string[] } {
  let accepted = 0;
  const errors: string[] = [];

  sqliteService.transaction(() => {
    for (const id of issueIds) {
      const result = acceptIssue(id);
      if (result.success) {
        accepted++;
      } else {
        errors.push(`${id}: ${result.error}`);
      }
    }
  });

  return { accepted, errors };
}

function bulkRejectIssues(issueIds: string[]): { rejected: number; errors: string[] } {
  let rejected = 0;
  const errors: string[] = [];

  sqliteService.transaction(() => {
    for (const id of issueIds) {
      const result = rejectIssue(id);
      if (result.success) {
        rejected++;
      } else {
        errors.push(`${id}: ${result.error}`);
      }
    }
  });

  return { rejected, errors };
}

function undoChange(changeId: string): { success: boolean; error?: string } {
  const change = sqliteService.queryOne<{
    change_id: string;
    issue_id: string | null;
    person_id: string;
    table_name: string;
    field: string;
    old_value: string | null;
  }>(
    'SELECT * FROM audit_change WHERE change_id = @changeId',
    { changeId }
  );

  if (!change) return { success: false, error: 'Change not found' };

  // Whitelist validation to prevent SQL injection from corrupted data
  const allowedFields = ALLOWED_UNDO_TARGETS[change.table_name];
  if (!allowedFields?.has(change.field)) {
    return { success: false, error: `Unsupported undo target: ${change.table_name}.${change.field}` };
  }

  // Restore old value (table_name and field are validated above)
  sqliteService.run(
    `UPDATE ${change.table_name} SET ${change.field} = @oldValue WHERE person_id = @personId`,
    { oldValue: change.old_value, personId: change.person_id }
  );

  // Reopen the issue if it exists
  if (change.issue_id) {
    sqliteService.run(
      "UPDATE audit_issue SET status = 'open', resolved_at = NULL WHERE issue_id = @issueId",
      { issueId: change.issue_id }
    );
  }

  // Remove the change record
  sqliteService.run('DELETE FROM audit_change WHERE change_id = @changeId', { changeId });

  // Decrement fix count
  if (change.issue_id) {
    const issue = getIssue(change.issue_id);
    if (issue) {
      sqliteService.run(
        'UPDATE audit_run SET fixes_applied = MAX(0, fixes_applied - 1) WHERE run_id = @runId',
        { runId: issue.runId }
      );
    }
  }

  return { success: true };
}

function getChanges(dbId: string): Array<{
  changeId: string;
  issueId: string | null;
  personId: string;
  personName: string | null;
  tableName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  appliedAt: string;
}> {
  return sqliteService.queryAll<{
    change_id: string;
    issue_id: string | null;
    person_id: string;
    display_name: string | null;
    table_name: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    applied_at: string;
  }>(
    `SELECT ac.*, p.display_name
     FROM audit_change ac
     JOIN audit_issue ai ON ac.issue_id = ai.issue_id
     JOIN audit_run ar ON ai.run_id = ar.run_id
     LEFT JOIN person p ON ac.person_id = p.person_id
     WHERE ar.db_id = @dbId
     ORDER BY ac.applied_at DESC
     LIMIT 500`,
    { dbId }
  ).map(r => ({
    changeId: r.change_id,
    issueId: r.issue_id,
    personId: r.person_id,
    personName: r.display_name,
    tableName: r.table_name,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    appliedAt: r.applied_at,
  }));
}

// ============================================================================
// HELPER
// ============================================================================

function makeIssue(
  runId: string,
  personId: string,
  issueType: AuditIssueType,
  severity: AuditIssueSeverity,
  description: string,
  currentValue: string | null,
  suggestedValue: string | null,
  suggestedSource?: string,
): AuditIssue {
  return {
    issueId: ulid(),
    runId,
    personId,
    issueType,
    severity,
    description,
    currentValue,
    suggestedValue,
    suggestedSource: suggestedSource ?? null,
    status: 'open',
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  };
}

const DEFAULT_CONFIG: AuditRunConfig = {
  depthLimit: null,
  checksEnabled: [
    'impossible_date',
    'parent_age_conflict',
    'placeholder_name',
    'missing_gender',
    'orphaned_edge',
    'coverage_gap',
    'date_mismatch',
  ],
  autoAccept: false,
  autoAcceptTypes: [],
  batchSize: 50,
  staleDays: 30,
};

// ============================================================================
// CORE AGENT LOOP
// ============================================================================

/**
 * Run structural checks on a single person.
 * Returns all issues found and the person's display name.
 */
function auditPerson(runId: string, personId: string, checksEnabled: AuditIssueType[]): { issues: AuditIssue[]; displayName?: string } {
  const vitals = getPersonVitals(personId);
  if (!vitals) return { issues: [] };

  const issues: AuditIssue[] = [];

  if (checksEnabled.includes('impossible_date')) {
    issues.push(...checkImpossibleDates(runId, vitals));
  }
  if (checksEnabled.includes('parent_age_conflict')) {
    issues.push(...checkParentAgeConflict(runId, vitals.personId, vitals.displayName, vitals.birthYear));
  }
  if (checksEnabled.includes('placeholder_name')) {
    issues.push(...checkPlaceholderName(runId, vitals.personId, vitals.displayName));
  }
  if (checksEnabled.includes('missing_gender')) {
    issues.push(...checkMissingGender(runId, vitals.personId, vitals.displayName, vitals.gender));
  }
  if (checksEnabled.includes('orphaned_edge')) {
    issues.push(...checkOrphanedEdges(runId, vitals.personId));
  }
  if (checksEnabled.includes('coverage_gap')) {
    issues.push(...checkCoverageGaps(runId, vitals.personId, vitals.displayName));
  }
  if (checksEnabled.includes('date_mismatch')) {
    issues.push(...checkDateMismatches(runId, vitals.personId, vitals.displayName));
  }

  return { issues, displayName: vitals.displayName };
}

/**
 * BFS walk from root person, auditing each person.
 * Yields progress events for SSE streaming.
 * Supports pause/resume via cursor and cancellation via operation tracker.
 */
async function* runAudit(
  dbId: string,
  inputConfig?: Partial<AuditRunConfig>,
  resumeRunId?: string,
): AsyncGenerator<AuditProgress> {
  const internalDbId = resolveDbId(dbId) ?? dbId;

  // Resume or create new run
  let run: AuditRun;
  let cursor: AuditCursor;

  if (resumeRunId) {
    const existing = getRun(resumeRunId);
    if (!existing || existing.status !== 'paused') {
      yield {
        type: 'error', runId: resumeRunId ?? '', current: 0, total: 0,
        generation: 0, personsChecked: 0, issuesFound: 0, fixesApplied: 0,
        message: resumeRunId ? `Run ${resumeRunId} not found or not paused` : 'No run ID provided',
      };
      return;
    }
    run = existing;
    cursor = run.cursor ?? { currentGeneration: 0, pendingPersonIds: [], checkedPersonIds: [] };
    updateRunStatus(run.runId, 'running');
    run.status = 'running';
  } else {
    // Find root person for this database
    const rootInfo = sqliteService.queryOne<{ root_id: string }>(
      'SELECT root_id FROM database_info WHERE db_id = @dbId',
      { dbId: internalDbId }
    );
    if (!rootInfo) {
      yield {
        type: 'error', runId: '', current: 0, total: 0,
        generation: 0, personsChecked: 0, issuesFound: 0, fixesApplied: 0,
        message: `Database ${dbId} not found`,
      };
      return;
    }

    const runConfig = { ...DEFAULT_CONFIG, ...inputConfig };
    run = createRun(internalDbId, rootInfo.root_id, runConfig);
    cursor = {
      currentGeneration: 0,
      pendingPersonIds: [rootInfo.root_id],
      checkedPersonIds: [],
    };
    updateRunStatus(run.runId, 'running');
    run.status = 'running';
  }

  const operationId = tracker.generateId();
  tracker.start(operationId);

  // Count total persons in this database for progress
  const totalRow = sqliteService.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM database_membership WHERE db_id = @dbId',
    { dbId: internalDbId }
  );
  const totalPersons = totalRow?.count ?? 0;

  logger.start('auditor', `Audit ${run.runId} started for db ${internalDbId} (${totalPersons} persons)`);

  yield {
    type: 'started',
    runId: run.runId,
    current: 0,
    total: totalPersons,
    generation: cursor.currentGeneration,
    personsChecked: run.personsChecked,
    issuesFound: run.issuesFound,
    fixesApplied: run.fixesApplied,
    message: `Audit started. ${totalPersons} persons to check.`,
  };

  const checkedSet = new Set(cursor.checkedPersonIds);
  let { personsChecked, issuesFound, fixesApplied } = run;
  let batchCount = 0;

  // BFS loop: process current generation, then queue next
  while (cursor.pendingPersonIds.length > 0) {
    const currentGen = cursor.currentGeneration;
    const genPersonIds = [...cursor.pendingPersonIds];
    const nextGenPersonIds: string[] = [];

    // Check depth limit
    if (run.config.depthLimit !== null && currentGen > run.config.depthLimit) {
      logger.data('auditor', `Depth limit ${run.config.depthLimit} reached at generation ${currentGen}`);
      break;
    }

    for (let i = 0; i < genPersonIds.length; i++) {
      const personId = genPersonIds[i];

      // Check cancellation — read DB status to distinguish pause from cancel
      if (tracker.isCancelled(operationId)) {
        const currentRun = getRun(run.runId);
        const isPaused = currentRun?.status === 'paused';

        cursor.pendingPersonIds = genPersonIds.slice(i);
        cursor.checkedPersonIds = [...checkedSet];
        saveCursor(run.runId, cursor);
        updateRunCounters(run.runId, personsChecked, issuesFound, fixesApplied);

        if (!isPaused) {
          updateRunStatus(run.runId, 'cancelled');
        }
        tracker.finish();

        const eventType = isPaused ? 'paused' as const : 'cancelled' as const;
        logger.warn('auditor', `Audit ${run.runId} ${eventType} at gen ${currentGen}, ${personsChecked}/${totalPersons} checked`);

        yield {
          type: eventType, runId: run.runId,
          current: personsChecked, total: totalPersons,
          generation: currentGen, personsChecked, issuesFound, fixesApplied,
          message: `Audit ${eventType} after checking ${personsChecked} persons.`,
        };
        return;
      }

      if (checkedSet.has(personId)) continue;

      // Run checks (also returns display name, avoiding redundant query)
      const { issues, displayName } = auditPerson(run.runId, personId, run.config.checksEnabled);

      // Persist issues
      if (issues.length > 0) {
        sqliteService.transaction(() => {
          for (const issue of issues) {
            insertIssue(issue);
          }
        });
      }

      checkedSet.add(personId);
      personsChecked++;
      issuesFound += issues.length;
      batchCount++;

      // Yield progress every batchSize persons
      if (batchCount >= run.config.batchSize) {
        batchCount = 0;
        cursor.checkedPersonIds = [...checkedSet];
        cursor.pendingPersonIds = genPersonIds.slice(i + 1);
        saveCursor(run.runId, cursor);
        updateRunCounters(run.runId, personsChecked, issuesFound, fixesApplied);

        yield {
          type: 'progress', runId: run.runId,
          current: personsChecked, total: totalPersons,
          generation: currentGen, personsChecked, issuesFound, fixesApplied,
          currentPerson: displayName,
          message: `Gen ${currentGen}: checked ${personsChecked}/${totalPersons}. ${issuesFound} issues found.`,
        };
      }

      // Queue parents for next generation
      const parents = sqliteService.queryAll<{ parent_id: string }>(
        'SELECT parent_id FROM parent_edge WHERE child_id = @personId',
        { personId }
      );
      for (const p of parents) {
        if (!checkedSet.has(p.parent_id)) {
          nextGenPersonIds.push(p.parent_id);
        }
      }
    }

    // Generation complete
    yield {
      type: 'generation_complete', runId: run.runId,
      current: personsChecked, total: totalPersons,
      generation: currentGen, personsChecked, issuesFound, fixesApplied,
      message: `Generation ${currentGen} complete. ${genPersonIds.length} persons checked.`,
    };

    // Move to next generation
    cursor.currentGeneration = currentGen + 1;
    cursor.pendingPersonIds = [...new Set(nextGenPersonIds)];
    cursor.checkedPersonIds = [...checkedSet];
    saveCursor(run.runId, cursor);

    // Allow event loop to breathe between generations
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // Complete
  updateRunStatus(run.runId, 'completed');
  updateRunCounters(run.runId, personsChecked, issuesFound, fixesApplied);
  saveCursor(run.runId, cursor);
  tracker.finish();

  logger.done('auditor', `Audit ${run.runId} complete: ${personsChecked} checked, ${issuesFound} issues`);

  yield {
    type: 'completed', runId: run.runId,
    current: personsChecked, total: totalPersons,
    generation: cursor.currentGeneration, personsChecked, issuesFound, fixesApplied,
    message: `Audit complete. ${personsChecked} persons checked, ${issuesFound} issues found.`,
  };
}

/**
 * Pause a running audit. Sets DB status to 'paused' then triggers
 * the cancel signal so the generator loop stops and reads the paused status.
 */
function pauseAudit(runId: string): boolean {
  const run = getRun(runId);
  if (!run || run.status !== 'running') return false;

  updateRunStatus(runId, 'paused');
  tracker.requestCancel();
  return true;
}

/**
 * Cancel a running audit.
 */
function cancelAudit(runId: string): boolean {
  const run = getRun(runId);
  if (!run || (run.status !== 'running' && run.status !== 'paused')) return false;

  if (run.status === 'paused') {
    updateRunStatus(runId, 'cancelled');
    return true;
  }

  // Running — request cancel via tracker, the generator will set status
  tracker.requestCancel();
  return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const auditorService = {
  // Run management
  runAudit,
  pauseAudit,
  cancelAudit,
  getRun,
  getRunsByDb,
  getRunSummary,

  // Issues
  getIssues,
  getIssue,

  // Resolution
  acceptIssue,
  rejectIssue,
  bulkAcceptIssues,
  bulkRejectIssues,
  undoChange,
  getChanges,

  // Status
  isRunning: () => tracker.isRunning(),
  getActiveRunId: () => tracker.getActiveId(),

  // Config defaults
  DEFAULT_CONFIG,

  // Event bus for SSE subscribers
  eventBus,
};
