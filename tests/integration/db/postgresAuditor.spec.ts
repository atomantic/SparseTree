import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditProgress } from '@fsf/shared';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { createAuditorService } from '../../../server/src/services/auditor-agent.service.js';
import { createAuditorRouter } from '../../../server/src/routes/auditor.routes.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL auditor persistence and lifecycle', () => {
  const schemaName = `sparsetree_auditor_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let auditor: ReturnType<typeof createAuditorService>;
  const generators: AsyncGenerator<AuditProgress>[] = [];
  const walk = (...args: Parameters<typeof auditor.runAudit>) => {
    const generator = auditor.runAudit(...args);
    generators.push(generator);
    return generator;
  };
  const drain = async (generator: AsyncGenerator<AuditProgress>) => {
    const events: AuditProgress[] = [];
    for await (const event of generator) events.push(event);
    return events;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    store = createPostgresService({ pool: new Pool({ connectionString, options: `-c search_path=${schemaName}` }) });
    await store.initDb();
  });
  beforeEach(async () => {
    auditor = createAuditorService(store);
    await store.run('TRUNCATE audit_run, person, database_info CASCADE');
    await store.run(`
      INSERT INTO person (person_id, display_name) VALUES
        ('root', 'Root'), ('father', 'Father'), ('mother', 'Mother'), ('grandfather', 'Grandfather');
      INSERT INTO external_identity (person_id, source, external_id) VALUES
        ('root', 'familysearch', 'AUDIT-TEST-ROOT'), ('root', 'ancestry', 'AUDIT-TEST-ANCESTRY'),
        ('father', 'familysearch', 'AUDIT-TEST-FATHER'), ('mother', 'familysearch', 'AUDIT-TEST-MOTHER'),
        ('grandfather', 'familysearch', 'AUDIT-TEST-GRANDFATHER');
      INSERT INTO database_info (db_id, root_id) VALUES ('db', 'root');
      INSERT INTO database_membership (db_id, person_id) SELECT 'db', person_id FROM person;
      INSERT INTO parent_edge (child_id, parent_id, parent_role) VALUES
        ('root', 'father', 'father'), ('root', 'mother', 'mother'), ('father', 'grandfather', 'father');
      INSERT INTO vital_event (person_id, event_type, date_year, source) VALUES
        ('root', 'birth', 1900, 'familysearch'), ('root', 'death', 1800, 'familysearch');
    `);
  });
  afterEach(async () => {
    for (const generator of generators.splice(0)) await generator.return(undefined);
  });
  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  it('persists path issues, JSON config, timestamps and numeric summary/overlay counts', async () => {
    const result = await auditor.auditPath('AUDIT-TEST-ROOT', ['root', 'father']);
    const run = await auditor.getRun(result.runId);
    expect(run).toMatchObject({ status: 'completed', dbId: 'db', personsChecked: 2, issuesFound: 2 });
    expect(run?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(run?.config.checksEnabled).toContain('impossible_date');
    const issues = await auditor.getIssues('root');
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: 'error', issueType: 'impossible_date', personName: 'Root' });
    expect(await auditor.getRunSummary(result.runId)).toMatchObject({
      issuesByType: { impossible_date: 1, missing_gender: 1 }, issuesBySeverity: { error: 1, info: 1 }, issuesByStatus: { open: 2 },
    });
    expect(await auditor.getIssueOverlay('root')).toEqual({
      issues: {
        root: { count: 1, maxSeverity: 'error', types: ['impossible_date'] },
        father: { count: 1, maxSeverity: 'info', types: ['missing_gender'] },
      }, auditedPersonIds: ['root', 'father'],
    });
  });

  it('resumes after restart with both the next-generation frontier and ancestry reachability', async () => {
    const generator = walk('db', { batchSize: 1, checksEnabled: ['missing_gender', 'unlinked_provider'] });
    const started = (await generator.next()).value!;
    await generator.next(); // Root checkpoint includes both parents in the next generation.
    expect(await auditor.pauseAudit(started.runId)).toBe(true);
    const other = createAuditorService(store);
    await expect(other.runAudit('db', undefined, started.runId).next()).rejects.toThrow('already running');
    const paused = await drain(generator);
    expect(paused.at(-1)?.type).toBe('paused');
    const persisted = await auditor.getRun(started.runId);
    expect(persisted?.cursor).toMatchObject({ pendingPersonIds: [], nextGenerationPersonIds: ['father', 'mother'] });

    // A fresh service has no in-memory tracker or frontier from the old process.
    auditor = createAuditorService(store);
    const resumed = walk('db', undefined, started.runId);
    await resumed.next();
    await resumed.next(); // Father checked, mother pending, grandfather queued.
    expect(await auditor.pauseAudit(started.runId)).toBe(true);
    await drain(resumed);
    expect((await auditor.getRun(started.runId))?.cursor).toMatchObject({
      pendingPersonIds: ['mother'], nextGenerationPersonIds: ['grandfather'], checkedPersonIds: ['root', 'father'],
    });
    auditor = createAuditorService(store);
    expect((await drain(walk('db', undefined, started.runId))).at(-1)).toMatchObject({ type: 'completed', personsChecked: 4 });
    const issues = await auditor.getIssues('db');
    expect(issues.filter(i => i.personId === 'father' && i.suggestedSource === 'ancestry')).toHaveLength(1);
    expect(issues.filter(i => i.personId === 'grandfather' && i.suggestedSource === 'ancestry')).toHaveLength(0);
    expect((await auditor.getIssueOverlay('db')).auditedPersonIds).toEqual(['root', 'father', 'mother', 'grandfather']);
  });

  it('allows exactly one concurrent start and resume across independent services', async () => {
    const first = walk('db');
    const secondService = createAuditorService(store);
    const second = secondService.runAudit('db');
    generators.push(second);
    const starts = await Promise.allSettled([first.next(), second.next()]);
    expect(starts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(starts.filter(r => r.status === 'rejected')).toHaveLength(1);
    const started = starts.find(r => r.status === 'fulfilled')!;
    if (started.status !== 'fulfilled') throw new Error('Missing successful start');
    const runId = started.value.value!.runId;
    await first.return(undefined);
    await second.return(undefined);
    expect((await auditor.getRun(runId))?.status).toBe('paused');

    const resumed = [createAuditorService(store), createAuditorService(store)].map(s => s.runAudit('db', undefined, runId));
    generators.push(...resumed);
    const results = await Promise.allSettled(resumed.map(g => g.next()));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });

  it('cancellation wins a competing pause and cannot be overwritten by completion', async () => {
    const generator = walk('db', { batchSize: 1 });
    const { runId } = (await generator.next()).value!;
    await Promise.all([auditor.pauseAudit(runId), auditor.cancelAudit(runId)]);
    expect((await drain(generator)).at(-1)?.type).toBe('cancelled');
    expect(await store.queryOne('SELECT status, owner_token, control_request FROM audit_run WHERE run_id = @runId', { runId }))
      .toEqual({ status: 'cancelled', owner_token: null, control_request: null });
    expect(auditor.isRunning()).toBe(false);
    await expect(walk('db', undefined, runId).next()).rejects.toThrow('not paused');

    const lastPerson = walk('db', { batchSize: 1, depthLimit: 0 });
    const id = (await lastPerson.next()).value!.runId;
    await lastPerson.next();
    await auditor.cancelAudit(id);
    expect((await drain(lastPerson)).at(-1)?.type).toBe('cancelled');
  });

  it('cancels a persisted paused run and rejects a resume for another database', async () => {
    const generator = walk('db');
    const { runId } = (await generator.next()).value!;
    await generator.return(undefined);
    await expect(walk('another-db', undefined, runId).next()).rejects.toThrow('not paused');
    expect(await auditor.cancelAudit(runId)).toBe(true);
    expect((await auditor.getRun(runId))?.status).toBe('cancelled');
    expect(await auditor.pauseAudit(runId)).toBe(false);
  });

  it('recovers an interrupted process only after PostgreSQL releases its worker lease', async () => {
    const generator = walk('db', { batchSize: 1 });
    const { runId } = (await generator.next()).value!;
    await generator.next();
    await generator.return(undefined);
    // Simulate a crash: checkpoint durable, ownership row left behind, session gone.
    await store.run("UPDATE audit_run SET status = 'running', owner_token = 'dead-process' WHERE run_id = @runId", { runId });
    auditor = createAuditorService(store);
    const events = await drain(walk('db', undefined, runId));
    expect(events[0]).toMatchObject({ type: 'started', personsChecked: 1 });
    expect(events.at(-1)).toMatchObject({ type: 'completed', personsChecked: 4 });
    expect(await store.queryOne('SELECT owner_token FROM audit_run WHERE run_id = @runId', { runId })).toEqual({ owner_token: null });
  });

  it('serializes accept/reject, preserves live fix counters, and undoes one applied change', async () => {
    const generator = walk('db', { batchSize: 1 });
    const { runId } = (await generator.next()).value!;
    while (!(await auditor.getIssues('db', { type: 'missing_gender' })).length) await generator.next();
    const issue = (await auditor.getIssues('db', { type: 'missing_gender' }))[0];
    const results = await Promise.all([auditor.acceptIssue(issue.issueId), auditor.acceptIssue(issue.issueId)]);
    expect(results.filter(r => r.success)).toHaveLength(1);
    expect((await auditor.rejectIssue(issue.issueId)).success).toBe(false);
    expect((await drain(generator)).at(-1)?.fixesApplied).toBe(1);
    const changes = await auditor.getChanges('db');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: null, newValue: 'male' });
    expect(changes[0].appliedAt).toMatch(/^\d{4}-/);
    const undo = await Promise.all([auditor.undoChange(changes[0].changeId), auditor.undoChange(changes[0].changeId)]);
    expect(undo.filter(r => r.success)).toHaveLength(1);
    expect((await auditor.getRun(runId))?.fixesApplied).toBe(0);
    expect((await auditor.getIssue(issue.issueId))?.status).toBe('open');
    expect(await store.queryOne('SELECT gender FROM person WHERE person_id = @id', { id: issue.personId })).toEqual({ gender: null });
  });

  it('keeps bulk successes/error counts and rejects stale or unsupported undo targets', async () => {
    await auditor.auditPath('db', ['father', 'mother']);
    const issues = await auditor.getIssues('db');
    const accepted = await auditor.bulkAcceptIssues([...issues.map(i => i.issueId), 'missing']);
    expect(accepted.accepted).toBe(2);
    expect(accepted.errors).toEqual(['missing: Issue not found']);
    const changes = await auditor.getChanges('db');
    await store.run("UPDATE person SET gender = 'unknown' WHERE person_id = @id", { id: changes[0].personId });
    expect(await auditor.undoChange(changes[0].changeId)).toMatchObject({ success: false, error: 'Person value has changed since this fix' });
    await store.run("UPDATE audit_change SET field = 'unauthorized' WHERE change_id = @id", { id: changes[0].changeId });
    expect(await auditor.undoChange(changes[0].changeId)).toMatchObject({ success: false, error: 'Unsupported undo target: person.unauthorized' });
    await auditor.undoChange(changes[1].changeId);
    expect(await auditor.bulkRejectIssues(issues.map(i => i.issueId))).toMatchObject({ rejected: 1 });
  });

  it('rolls back a failed bulk mutation including earlier persons, issues, changes and counters', async () => {
    const { runId } = await auditor.auditPath('db', ['father', 'mother']);
    const issues = await auditor.getIssues('db');
    await store.run(`CREATE FUNCTION fail_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.person_id = 'mother' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_audit_change BEFORE INSERT ON audit_change FOR EACH ROW EXECUTE FUNCTION fail_audit_change()`);
    try {
      await expect(auditor.bulkAcceptIssues(issues.map(i => i.issueId))).rejects.toThrow('test rollback');
      expect((await auditor.getRun(runId))?.fixesApplied).toBe(0);
      expect((await auditor.getIssues('db')).every(i => i.status === 'open')).toBe(true);
      expect(await auditor.getChanges('db')).toEqual([]);
      expect(await store.queryAll("SELECT gender FROM person WHERE person_id IN ('father', 'mother')")).toEqual([{ gender: null }, { gender: null }]);
    } finally {
      await store.run('DROP TRIGGER fail_audit_change ON audit_change; DROP FUNCTION fail_audit_change()');
    }
  });

  it('rolls back a failed checkpoint and releases both persisted and local ownership', async () => {
    await store.run(`CREATE FUNCTION fail_audit_issue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'checkpoint rollback'; END $$;
      CREATE TRIGGER fail_audit_issue BEFORE INSERT ON audit_issue FOR EACH ROW EXECUTE FUNCTION fail_audit_issue()`);
    try {
      const events = await drain(walk('db'));
      expect(events.at(-1)).toMatchObject({ type: 'error', message: 'checkpoint rollback' });
      expect(await auditor.getRun(events[0].runId)).toMatchObject({
        status: 'error', personsChecked: 0, issuesFound: 0, cursor: { pendingPersonIds: ['root'], checkedPersonIds: [] },
      });
      expect(await auditor.getIssues('db')).toEqual([]);
      expect(auditor.isRunning()).toBe(false);
    } finally {
      await store.run('DROP TRIGGER fail_audit_issue ON audit_issue; DROP FUNCTION fail_audit_issue()');
    }
  });

  it('serves resolved REST payloads and streams lifecycle events through the production router', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/audit', createAuditorRouter(auditor));
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ success: false, error: error.message });
    });
    const path = await request(app).post('/api/audit/db/path-audit').send({ personIds: ['root', 'father'] });
    expect(path.status).toBe(200);
    expect(path.body.data.issues).toHaveLength(2);
    const runs = await request(app).get('/api/audit/db/runs');
    expect(runs.body.data[0]).toMatchObject({ runId: path.body.data.runId, status: 'completed' });
    const issues = await request(app).get('/api/audit/db/issues?type=missing_gender');
    expect(issues.body.data).toHaveLength(1);
    expect((await request(app).post(`/api/audit/db/issues/${issues.body.data[0].issueId}/accept`)).body.success).toBe(true);
    const changes = await request(app).get('/api/audit/db/changes');
    expect(changes.body.data).toHaveLength(1);

    const generator = walk('db');
    const { runId } = (await generator.next()).value!;
    expect((await request(app).post('/api/audit/db/start').send({})).status).toBe(409);
    const stream = request(app).get('/api/audit/db/events');
    const streamResult = stream.then(response => response);
    // Wait for the production route to attach its listener before publishing.
    while (auditor.eventBus.listenerCount('progress') === 0) await new Promise(resolve => setTimeout(resolve, 5));
    expect((await request(app).post(`/api/audit/db/${runId}/pause`)).status).toBe(200);
    for (const event of await drain(generator)) auditor.eventBus.emit('progress', event);
    const response = await streamResult;
    expect(response.text).toContain('"type":"paused"');
    expect(auditor.eventBus.listenerCount('progress')).toBe(0);
  });
});
