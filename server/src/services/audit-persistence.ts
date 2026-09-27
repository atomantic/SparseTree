import { ulid } from 'ulid';
import type { AuditCursor, AuditIssue, AuditIssueSeverity, AuditIssueType, AuditRun, AuditRunConfig, AuditRunStatus } from '@fsf/shared';
import type { createPostgresService } from '../db/postgres.service.js';
import { createPostgresDatabase } from './postgres-database.js';

export type AuditStore = ReturnType<typeof createPostgresService>;
export type AuditQuery = Parameters<Parameters<AuditStore['transaction']>[0]>[0];
export type AuditCheckpoint = AuditCursor & {
  nextGenerationPersonIds?: string[];
  childAncestryReachable?: string[];
};

export class AuditStartError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

interface RunRow {
  run_id: string; db_id: string; root_person_id: string; status: AuditRunStatus;
  config: AuditRunConfig; cursor: AuditCheckpoint | null;
  started_at: Date | null; paused_at: Date | null; completed_at: Date | null;
  persons_checked: number; issues_found: number; fixes_applied: number;
  error_message: string | null; owner_token: string | null; control_request: 'paused' | 'cancelled' | null;
}

export interface IssueRow {
  issue_id: string; run_id: string; person_id: string; display_name?: string | null;
  issue_type: AuditIssueType; severity: AuditIssueSeverity; description: string;
  current_value: string | null; suggested_value: string | null; suggested_source: string | null;
  status: AuditIssue['status']; resolved_at: Date | null; created_at: Date;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;
const rowToRun = (r: RunRow): AuditRun => ({
  runId: r.run_id, dbId: r.db_id, rootPersonId: r.root_person_id, status: r.status,
  config: r.config, cursor: r.cursor, startedAt: iso(r.started_at), pausedAt: iso(r.paused_at),
  completedAt: iso(r.completed_at), personsChecked: r.persons_checked,
  issuesFound: r.issues_found, fixesApplied: r.fixes_applied, errorMessage: r.error_message,
});
const rowToIssue = (r: IssueRow): AuditIssue => ({
  issueId: r.issue_id, runId: r.run_id, personId: r.person_id, personName: r.display_name ?? undefined,
  issueType: r.issue_type, severity: r.severity, description: r.description,
  currentValue: r.current_value, suggestedValue: r.suggested_value, suggestedSource: r.suggested_source,
  status: r.status, resolvedAt: iso(r.resolved_at), createdAt: r.created_at.toISOString(),
});

export function createAuditPersistence(store: AuditStore) {
  const { resolveDbId } = createPostgresDatabase(store);
  const dbKey = async (dbId: string) => await resolveDbId(dbId) ?? dbId;

  const acquireWorker = async () => {
    const client = await store.getPool().connect();
    const key = "hashtext(current_schema()), hashtext('sparsetree:audit:worker')";
    const result = await client.query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(${key}) AS acquired`)
      .catch(error => { client.release(); throw error; });
    if (!result.rows[0].acquired) {
      client.release();
      throw new AuditStartError('An audit is already running', 409);
    }
    // Session ownership outlives individual transactions and vanishes on process exit.
    return () => client.query(`SELECT pg_advisory_unlock(${key})`).finally(() => client.release());
  };

  const getRun = async (runId: string) => {
    const row = await store.queryOne<RunRow>('SELECT * FROM audit_run WHERE run_id = @runId', { runId });
    return row && rowToRun(row);
  };

  const getRunsByDb = async (dbId: string) => (await store.queryAll<RunRow>(
    'SELECT * FROM audit_run WHERE db_id = @dbId ORDER BY started_at DESC', { dbId: await dbKey(dbId) },
  )).map(rowToRun);

  const claimRun = async (dbId: string, config: AuditRunConfig, owner: string, resumeRunId?: string) => {
    const internalDbId = await dbKey(dbId);
    return store.transaction(async tx => {
      // acquireWorker proved that no live worker owns this schema. Recover an
      // interrupted process at its last complete checkpoint before claiming.
      await tx.run(`UPDATE audit_run SET status = COALESCE(control_request, 'paused'),
        paused_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN control_request = 'cancelled' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        owner_token = NULL, control_request = NULL WHERE status = 'running'`);
      if (resumeRunId) {
        const row = await tx.queryOne<RunRow>(
          `UPDATE audit_run SET status = 'running', owner_token = @owner, control_request = NULL,
             paused_at = NULL, completed_at = NULL, error_message = NULL
           WHERE run_id = @resumeRunId AND db_id = @dbId AND status = 'paused' AND owner_token IS NULL
           RETURNING *`, { resumeRunId, dbId: internalDbId, owner },
        );
        if (!row) throw new AuditStartError('Run not found or not paused', 404);
        return rowToRun(row);
      }
      const root = await tx.queryOne<{ root_id: string | null }>(
        'SELECT root_id FROM database_info WHERE db_id = @dbId', { dbId: internalDbId },
      );
      if (!root?.root_id) throw new AuditStartError(`Database ${dbId} not found`, 404);
      const cursor: AuditCheckpoint = {
        currentGeneration: 0, pendingPersonIds: [root.root_id], checkedPersonIds: [],
        nextGenerationPersonIds: [], childAncestryReachable: [],
      };
      const row = await tx.queryOne<RunRow>(
        `INSERT INTO audit_run (run_id, db_id, root_person_id, status, config, cursor, started_at, owner_token)
         VALUES (@runId, @dbId, @rootId, 'running', @config, @cursor, CURRENT_TIMESTAMP, @owner) RETURNING *`,
        { runId: ulid(), dbId: internalDbId, rootId: root.root_id, config: JSON.stringify(config), cursor: JSON.stringify(cursor), owner },
      );
      return rowToRun(row!);
    });
  };

  const insertIssue = (tx: AuditQuery, issue: AuditIssue) => tx.run(
    `INSERT INTO audit_issue (issue_id, run_id, person_id, issue_type, severity, description,
       current_value, suggested_value, suggested_source, status, created_at)
     VALUES (@issueId, @runId, @personId, @issueType, @severity, @description,
       @currentValue, @suggestedValue, @suggestedSource, @status, @createdAt)
     ON CONFLICT (issue_id) DO NOTHING`, { ...issue },
  );

  const checkpoint = (runId: string, owner: string, progress?: {
    cursor: AuditCheckpoint; issues: AuditIssue[]; personsChecked: number; complete?: boolean;
  }) => store.transaction(async tx => {
    const row = await tx.queryOne<RunRow>('SELECT * FROM audit_run WHERE run_id = @runId FOR UPDATE', { runId });
    if (!row || row.owner_token !== owner || row.status !== 'running') throw new Error('Audit ownership lost');
    // Finish a requested handoff using the last committed cursor. In-flight checks are retried on resume.
    const status = row.control_request ?? (progress?.complete ? 'completed' : 'running');
    let inserted = 0;
    if (!row.control_request && progress) {
      for (const issue of progress.issues) inserted += (await insertIssue(tx, issue)).rowCount ?? 0;
    }
    const updated = await tx.queryOne<RunRow>(
      `UPDATE audit_run SET status = @status, control_request = NULL,
         owner_token = CASE WHEN @status = 'running' THEN owner_token ELSE NULL END,
         paused_at = CASE WHEN @status = 'paused' THEN CURRENT_TIMESTAMP ELSE paused_at END,
         completed_at = CASE WHEN @status IN ('completed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE completed_at END,
         cursor = @cursor, persons_checked = persons_checked + @persons, issues_found = issues_found + @issues
       WHERE run_id = @runId RETURNING *`,
      { runId, status, cursor: JSON.stringify(!row.control_request && progress ? progress.cursor : row.cursor),
        persons: !row.control_request && progress ? progress.personsChecked : 0, issues: inserted },
    );
    return rowToRun(updated!);
  });

  const pauseAudit = async (runId: string) => (await store.run(
    `UPDATE audit_run SET control_request = 'paused'
     WHERE run_id = @runId AND status = 'running' AND control_request IS NULL`, { runId },
  )).rowCount === 1;

  const cancelAudit = async (runId: string) => (await store.run(
    `UPDATE audit_run SET
       control_request = CASE WHEN status = 'running' THEN 'cancelled' ELSE NULL END,
       completed_at = CASE WHEN status = 'paused' THEN CURRENT_TIMESTAMP ELSE completed_at END,
       status = CASE WHEN status = 'paused' THEN 'cancelled' ELSE status END
     WHERE run_id = @runId AND status IN ('running', 'paused')`, { runId },
  )).rowCount === 1;

  const releaseRun = (runId: string, owner: string, error?: string) => store.run(
    `UPDATE audit_run SET status = COALESCE(control_request, @status), owner_token = NULL, control_request = NULL,
       paused_at = CASE WHEN control_request = 'paused' OR (control_request IS NULL AND @status = 'paused') THEN CURRENT_TIMESTAMP ELSE paused_at END,
       completed_at = CASE WHEN control_request = 'cancelled' OR @status = 'error' THEN CURRENT_TIMESTAMP ELSE completed_at END,
       error_message = @error
     WHERE run_id = @runId AND status = 'running' AND owner_token = @owner`,
    { runId, owner, status: error ? 'error' : 'paused', error: error ?? null },
  );

  const getIssues = async (dbId: string, filters: { type?: AuditIssueType; severity?: AuditIssueSeverity; status?: string; runId?: string } = {}) => {
    const conditions = ['ar.db_id = @dbId'];
    const params: Record<string, unknown> = { dbId: await dbKey(dbId) };
    for (const [key, column] of [['type', 'issue_type'], ['severity', 'severity'], ['status', 'status'], ['runId', 'run_id']] as const) {
      if (filters[key]) { conditions.push(`ai.${column} = @${key}`); params[key] = filters[key]; }
    }
    return (await store.queryAll<IssueRow>(
      `SELECT ai.*, p.display_name FROM audit_issue ai JOIN audit_run ar ON ai.run_id = ar.run_id
       LEFT JOIN person p ON ai.person_id = p.person_id WHERE ${conditions.join(' AND ')}
       ORDER BY CASE ai.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, ai.created_at DESC LIMIT 500`, params,
    )).map(rowToIssue);
  };

  const getIssue = async (issueId: string) => {
    const row = await store.queryOne<IssueRow>(
      `SELECT ai.*, p.display_name FROM audit_issue ai LEFT JOIN person p ON ai.person_id = p.person_id
       WHERE ai.issue_id = @issueId`, { issueId },
    );
    return row && rowToIssue(row);
  };

  const getRunSummary = async (runId: string) => {
    const run = await getRun(runId);
    if (!run) return undefined;
    const rows = await store.queryAll<{ issue_type: string; severity: string; status: string; count: number }>(
      `SELECT issue_type, severity, status, COUNT(*)::integer AS count FROM audit_issue
       WHERE run_id = @runId GROUP BY issue_type, severity, status`, { runId },
    );
    const counts = (field: 'issue_type' | 'severity' | 'status') => {
      const result: Record<string, number> = {};
      for (const row of rows) result[row[field]] = (result[row[field]] ?? 0) + row.count;
      return result;
    };
    return { run, issuesByType: counts('issue_type'), issuesBySeverity: counts('severity'), issuesByStatus: counts('status') };
  };

  const getIssueOverlay = async (dbId: string) => {
    const params = { dbId: await dbKey(dbId) };
    const rows = await store.queryAll<{ person_id: string; count: number; max_severity: number; types: AuditIssueType[] }>(
      `SELECT ai.person_id, COUNT(*)::integer AS count,
         MIN(CASE ai.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END) AS max_severity,
         array_agg(DISTINCT ai.issue_type) AS types
       FROM audit_issue ai JOIN audit_run ar ON ai.run_id = ar.run_id
       WHERE ar.db_id = @dbId AND ai.status = 'open' GROUP BY ai.person_id`, params,
    );
    const severities = ['error', 'warning', 'info', 'hint'] as const;
    const latest = await store.queryOne<{ cursor: AuditCheckpoint | null }>(
      `SELECT cursor FROM audit_run WHERE db_id = @dbId AND status IN ('completed', 'running', 'paused')
       ORDER BY started_at DESC LIMIT 1`, params,
    );
    return {
      issues: Object.fromEntries(rows.map(r => [r.person_id, { count: r.count, maxSeverity: severities[r.max_severity], types: r.types }])),
      auditedPersonIds: latest?.cursor?.checkedPersonIds ?? [],
    };
  };

  return { acquireWorker, dbKey, getRun, getRunsByDb, claimRun, checkpoint, pauseAudit, cancelAudit, releaseRun, getIssues, getIssue, getRunSummary, getIssueOverlay };
}
