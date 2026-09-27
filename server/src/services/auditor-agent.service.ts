/** PostgreSQL-backed tree auditor with durable checkpoints and explicit worker ownership. */
import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type { AuditIssue, AuditIssueType, AuditProgress, AuditRun, AuditRunConfig } from '@fsf/shared';
import { postgresService } from '../db/postgres.service.js';
import { logger } from '../lib/logger.js';
import { createAuditChecks } from './audit-checks.js';
import { createAuditMutations } from './audit-mutations.js';
import { AuditStartError, createAuditPersistence, type AuditCheckpoint, type AuditStore } from './audit-persistence.js';

export { AuditStartError } from './audit-persistence.js';

const DEFAULT_CONFIG: AuditRunConfig = {
  depthLimit: null,
  checksEnabled: ['impossible_date', 'parent_age_conflict', 'placeholder_name', 'missing_gender', 'orphaned_edge', 'date_mismatch', 'place_mismatch'],
  autoAccept: false, autoAcceptTypes: [], batchSize: 50, staleDays: 30,
};

export function createAuditorService(store: AuditStore = postgresService) {
  const persistence = createAuditPersistence(store);
  const { auditPerson } = createAuditChecks(store);
  const mutations = createAuditMutations(store, persistence.dbKey);
  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(20);
  let activeOwner: string | null = null;
  let activeRunId: string | null = null;

  const reserve = () => {
    if (activeOwner) throw new AuditStartError('An audit is already running', 409);
    activeOwner = ulid();
    return activeOwner;
  };
  const release = (owner: string) => {
    if (activeOwner === owner) { activeOwner = null; activeRunId = null; }
  };
  const configure = (input?: Partial<AuditRunConfig>): AuditRunConfig => {
    const config = { ...DEFAULT_CONFIG, ...input };
    config.batchSize = Number.isFinite(config.batchSize) ? Math.max(1, Math.floor(config.batchSize)) : DEFAULT_CONFIG.batchSize;
    return config;
  };
  const progress = (run: AuditRun, total: number, type: AuditProgress['type'], message: string, currentPerson?: string): AuditProgress => ({
    type, runId: run.runId, current: run.personsChecked, total, generation: run.cursor?.currentGeneration ?? 0,
    personsChecked: run.personsChecked, issuesFound: run.issuesFound, fixesApplied: run.fixesApplied, message, currentPerson,
  });
  const stopped = (run: AuditRun, total: number) => progress(run, total, run.status === 'paused' ? 'paused' : 'cancelled',
    `Audit ${run.status} after checking ${run.personsChecked} persons.`);

  async function* runAudit(dbId: string, inputConfig?: Partial<AuditRunConfig>, resumeRunId?: string): AsyncGenerator<AuditProgress> {
    // Reserve before the first await: concurrent HTTP starts cannot both pass isRunning().
    const owner = reserve();
    let run: AuditRun | undefined;
    let releaseWorker: Awaited<ReturnType<typeof persistence.acquireWorker>> | undefined;
    let total = 0;
    try {
      releaseWorker = await persistence.acquireWorker();
      run = await persistence.claimRun(dbId, configure(inputConfig), owner, resumeRunId);
      activeRunId = run.runId;
      const count = await store.queryOne<{ count: number }>(
        'SELECT COUNT(*)::integer AS count FROM database_membership WHERE db_id = @dbId', { dbId: run.dbId },
      );
      total = count?.count ?? 0;
      yield progress(run, total, 'started', `Audit started. ${total} persons to check.`);

      while (true) {
        run = await persistence.checkpoint(run.runId, owner);
        if (run.status !== 'running') { yield stopped(run, total); return; }
        let cursor: AuditCheckpoint = run.cursor ?? { currentGeneration: 0, pendingPersonIds: [], checkedPersonIds: [] };
        if (!cursor.pendingPersonIds.length && cursor.nextGenerationPersonIds?.length) {
          cursor = { ...cursor, currentGeneration: cursor.currentGeneration + 1,
            pendingPersonIds: cursor.nextGenerationPersonIds, nextGenerationPersonIds: [] };
          run = await persistence.checkpoint(run.runId, owner, { cursor, issues: [], personsChecked: 0 });
          if (run.status !== 'running') { yield stopped(run, total); return; }
        }
        if (!cursor.pendingPersonIds.length || (run.config.depthLimit !== null && cursor.currentGeneration > run.config.depthLimit)) {
          run = await persistence.checkpoint(run.runId, owner, { cursor, issues: [], personsChecked: 0, complete: true });
          if (run.status !== 'completed') { yield stopped(run, total); return; }
          yield progress(run, total, 'completed', `Audit complete. ${run.personsChecked} persons checked, ${run.issuesFound} issues found.`);
          return;
        }

        const [personId, ...remaining] = cursor.pendingPersonIds;
        const checked = new Set(cursor.checkedPersonIds);
        const reachable = new Set(cursor.childAncestryReachable ?? []);
        let issues: AuditIssue[] = [];
        let displayName: string | undefined;
        const next = new Set(cursor.nextGenerationPersonIds ?? []);
        const alreadyChecked = checked.has(personId);
        if (!alreadyChecked) {
          const result = await auditPerson(run.runId, personId, run.config.checksEnabled,
            cursor.currentGeneration === 0 || reachable.has(personId));
          issues = result.issues;
          displayName = result.displayName;
          checked.add(personId);
          const parents = await store.queryAll<{ parent_id: string }>(
            'SELECT parent_id FROM parent_edge WHERE child_id = @personId ORDER BY parent_id', { personId },
          );
          for (const parent of parents) {
            if (!checked.has(parent.parent_id)) next.add(parent.parent_id);
            if (result.linkedSources.has('ancestry')) reachable.add(parent.parent_id);
          }
        }
        cursor = { ...cursor, pendingPersonIds: remaining, checkedPersonIds: [...checked],
          nextGenerationPersonIds: [...next], childAncestryReachable: [...reachable] };
        // Issues, counters, next-generation frontier and chain reachability commit together.
        run = await persistence.checkpoint(run.runId, owner, { cursor, issues, personsChecked: alreadyChecked ? 0 : 1 });
        if (run.status !== 'running') { yield stopped(run, total); return; }
        if (!alreadyChecked && run.personsChecked % run.config.batchSize === 0) {
          yield progress(run, total, 'progress',
            `Gen ${cursor.currentGeneration}: checked ${run.personsChecked}/${total}. ${run.issuesFound} issues found.`, displayName);
        }
        if (!remaining.length) {
          yield progress(run, total, 'generation_complete', `Generation ${cursor.currentGeneration} complete.`);
        }
      }
    } catch (error) {
      if (!run) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await persistence.releaseRun(run.runId, owner, message);
      yield progress(run, total, 'error', message);
    } finally {
      // Generator.return(), disconnects and exceptions must also release the persisted claim.
      // No terminal transition is overwritten because releaseRun checks the ownership token.
      try { if (run) await persistence.releaseRun(run.runId, owner); }
      finally {
        try { await releaseWorker?.(); }
        finally { release(owner); }
      }
    }
  }

  async function auditPath(dbId: string, personIds: string[], checksEnabled: AuditIssueType[] = DEFAULT_CONFIG.checksEnabled) {
    const owner = reserve();
    let run: AuditRun | undefined;
    let releaseWorker: Awaited<ReturnType<typeof persistence.acquireWorker>> | undefined;
    try {
      releaseWorker = await persistence.acquireWorker();
      run = await persistence.claimRun(dbId, configure({ checksEnabled }), owner);
      activeRunId = run.runId;
      const allIssues: AuditIssue[] = [];
      let childHasAncestry = true;
      for (const personId of personIds) {
        const result = await auditPerson(run.runId, personId, checksEnabled, childHasAncestry);
        childHasAncestry = result.linkedSources.has('ancestry');
        allIssues.push(...result.issues);
      }
      run = await persistence.checkpoint(run.runId, owner, {
        cursor: { currentGeneration: 0, pendingPersonIds: [], checkedPersonIds: [...new Set(personIds)] },
        issues: allIssues, personsChecked: personIds.length, complete: true,
      });
      return { runId: run.runId, issues: run.status === 'completed' ? allIssues : [], personsChecked: run.personsChecked };
    } catch (error) {
      if (run) await persistence.releaseRun(run.runId, owner, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      try { if (run) await persistence.releaseRun(run.runId, owner); }
      finally {
        try { await releaseWorker?.(); }
        finally { release(owner); }
      }
    }
  }

  /** Prime admission before HTTP success; async errors still become SSE progress events. */
  const startBackgroundAudit = async (dbId: string, inputConfig?: Partial<AuditRunConfig>, resumeRunId?: string) => {
    const generator = runAudit(dbId, inputConfig, resumeRunId);
    const first = await generator.next();
    if (first.value) eventBus.emit('progress', first.value);
    void (async () => {
      for await (const update of generator) eventBus.emit('progress', update);
    })().catch(error => logger.error('auditor', `Background audit failed: ${error.message}`));
  };

  return {
    runAudit, startBackgroundAudit, auditPath, ...mutations,
    pauseAudit: persistence.pauseAudit, cancelAudit: persistence.cancelAudit,
    getRun: persistence.getRun, getRunsByDb: persistence.getRunsByDb, getRunSummary: persistence.getRunSummary,
    getIssues: persistence.getIssues, getIssue: persistence.getIssue, getIssueOverlay: persistence.getIssueOverlay,
    isRunning: () => activeOwner !== null, getActiveRunId: () => activeRunId, DEFAULT_CONFIG, eventBus,
  };
}

export const auditorService = createAuditorService();
