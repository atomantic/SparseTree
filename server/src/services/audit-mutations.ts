import { ulid } from 'ulid';
import type { AuditQuery, AuditStore, IssueRow } from './audit-persistence.js';

const ALLOWED_UNDO_TARGETS: Record<string, Set<string>> = {
  person: new Set(['gender', 'display_name', 'birth_name']),
};
type MutationResult = { success: boolean; error?: string };
interface ChangeRow {
  change_id: string; issue_id: string | null; person_id: string; display_name?: string | null;
  table_name: string; field: string; old_value: string | null; new_value: string | null; applied_at: Date;
}

export function createAuditMutations(store: AuditStore, dbKey: (id: string) => Promise<string>) {
  // Serialize mutation batches across processes. This also avoids lock inversions
  // when separate runs contain issues for the same people in different orders.
  const mutate = <T>(work: (tx: AuditQuery) => Promise<T>) => store.transaction(async tx => {
    await tx.run("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('sparsetree:audit:mutations'))");
    return work(tx);
  });
  const resolveIssue = async (tx: AuditQuery, issueId: string, status: 'accepted' | 'rejected'): Promise<MutationResult> => {
    const issue = await tx.queryOne<IssueRow>(
      'SELECT * FROM audit_issue WHERE issue_id = @issueId FOR UPDATE', { issueId },
    );
    if (!issue) return { success: false, error: 'Issue not found' };
    if (issue.status !== 'open') return { success: false, error: `Issue is already ${issue.status}` };
    if (status === 'accepted' && issue.suggested_value && issue.issue_type === 'missing_gender') {
      const person = await tx.queryOne<{ gender: string | null }>(
        'SELECT gender FROM person WHERE person_id = @personId FOR UPDATE', { personId: issue.person_id },
      );
      if (!person) return { success: false, error: 'Person not found' };
      await tx.run('UPDATE person SET gender = @gender WHERE person_id = @personId',
        { personId: issue.person_id, gender: issue.suggested_value });
      await tx.run(
        `INSERT INTO audit_change (change_id, issue_id, person_id, table_name, field, old_value, new_value)
         VALUES (@changeId, @issueId, @personId, 'person', 'gender', @oldValue, @newValue)`,
        { changeId: ulid(), issueId, personId: issue.person_id, oldValue: person.gender, newValue: issue.suggested_value },
      );
      await tx.run('UPDATE audit_run SET fixes_applied = fixes_applied + 1 WHERE run_id = @runId', { runId: issue.run_id });
    }
    await tx.run(
      'UPDATE audit_issue SET status = @status, resolved_at = CURRENT_TIMESTAMP WHERE issue_id = @issueId', { issueId, status },
    );
    return { success: true };
  };

  const acceptIssue = (id: string) => mutate(tx => resolveIssue(tx, id, 'accepted'));
  const rejectIssue = (id: string) => mutate(tx => resolveIssue(tx, id, 'rejected'));
  const bulkResolve = (ids: string[], status: 'accepted' | 'rejected') => mutate(async tx => {
    let resolved = 0;
    const errors: string[] = [];
    // Stable lock order avoids two overlapping bulk requests locking issues in reverse.
    for (const id of [...ids].sort()) {
      const result = await resolveIssue(tx, id, status);
      if (result.success) resolved++;
      else errors.push(`${id}: ${result.error}`);
    }
    return { resolved, errors };
  });
  const bulkAcceptIssues = async (ids: string[]) => {
    const { resolved, errors } = await bulkResolve(ids, 'accepted');
    return { accepted: resolved, errors };
  };
  const bulkRejectIssues = async (ids: string[]) => {
    const { resolved, errors } = await bulkResolve(ids, 'rejected');
    return { rejected: resolved, errors };
  };

  const undoChange = (changeId: string): Promise<MutationResult> => mutate(async tx => {
    const initial = await tx.queryOne<ChangeRow>('SELECT * FROM audit_change WHERE change_id = @changeId', { changeId });
    if (!initial) return { success: false, error: 'Change not found' };
    // Match accept/reject lock order, then re-read the change in case another undo won.
    const issue = initial.issue_id ? await tx.queryOne<IssueRow>(
      'SELECT * FROM audit_issue WHERE issue_id = @issueId FOR UPDATE', { issueId: initial.issue_id },
    ) : undefined;
    const change = await tx.queryOne<ChangeRow>(
      'SELECT * FROM audit_change WHERE change_id = @changeId FOR UPDATE', { changeId },
    );
    if (!change) return { success: false, error: 'Change not found' };
    if (!ALLOWED_UNDO_TARGETS[change.table_name]?.has(change.field)) {
      return { success: false, error: `Unsupported undo target: ${change.table_name}.${change.field}` };
    }
    const person = await tx.queryOne<{ value: string | null }>(
      `SELECT ${change.field} AS value FROM ${change.table_name} WHERE person_id = @personId FOR UPDATE`,
      { personId: change.person_id },
    );
    if (!person) return { success: false, error: 'Person not found' };
    if (person.value !== change.new_value) return { success: false, error: 'Person value has changed since this fix' };
    await tx.run(
      `UPDATE ${change.table_name} SET ${change.field} = @oldValue WHERE person_id = @personId`,
      { oldValue: change.old_value, personId: change.person_id },
    );
    if (issue) {
      await tx.run("UPDATE audit_issue SET status = 'open', resolved_at = NULL WHERE issue_id = @issueId", { issueId: issue.issue_id });
      await tx.run('UPDATE audit_run SET fixes_applied = GREATEST(0, fixes_applied - 1) WHERE run_id = @runId', { runId: issue.run_id });
    }
    await tx.run('DELETE FROM audit_change WHERE change_id = @changeId', { changeId });
    return { success: true };
  });

  const getChanges = async (dbId: string) => (await store.queryAll<ChangeRow>(
    `SELECT ac.*, p.display_name FROM audit_change ac JOIN audit_issue ai ON ac.issue_id = ai.issue_id
     JOIN audit_run ar ON ai.run_id = ar.run_id LEFT JOIN person p ON ac.person_id = p.person_id
     WHERE ar.db_id = @dbId ORDER BY ac.applied_at DESC LIMIT 500`, { dbId: await dbKey(dbId) },
  )).map(r => ({
    changeId: r.change_id, issueId: r.issue_id, personId: r.person_id, personName: r.display_name ?? null,
    tableName: r.table_name, field: r.field, oldValue: r.old_value, newValue: r.new_value, appliedAt: r.applied_at.toISOString(),
  }));

  return { acceptIssue, rejectIssue, bulkAcceptIssues, bulkRejectIssues, undoChange, getChanges };
}
