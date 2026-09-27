/**
 * Tree Auditor Routes
 *
 * API endpoints for the AI tree auditor agent:
 * run management, issue review, and SSE progress streaming.
 */

import { Router, Request, Response } from 'express';
import type { AuditRunConfig, AuditIssueType, AuditIssueSeverity, AuditProgress } from '@fsf/shared';
import { auditorService as defaultAuditorService, AuditStartError } from '../services/auditor-agent.service.js';
import { initSSEData } from '../utils/sseHelpers.js';

export function createAuditorRouter(auditorService = defaultAuditorService) {
  const router = Router();

  // ============================================================================
  // RUN MANAGEMENT
  // ============================================================================

  /**
   * POST /:dbId/start - Start a new audit run
   * Body: Partial<AuditRunConfig>
   */
  router.post('/:dbId/start', async (req: Request, res: Response, next) => {
    const { dbId } = req.params;
    const inputConfig = req.body as Partial<AuditRunConfig> | undefined;

    if (auditorService.isRunning()) {
      res.status(409).json({ success: false, error: 'An audit is already running' });
      return;
    }

    const started = await auditorService.startBackgroundAudit(dbId, inputConfig).then(() => true).catch(error => {
      if (error instanceof AuditStartError) res.status(error.status).json({ success: false, error: error.message });
      else next(error);
    });
    if (!started) return;

    res.json({
      success: true,
      data: {
        message: 'Audit started',
        eventsUrl: `/api/audit/${dbId}/events`,
      },
    });
  });

  /**
   * POST /:dbId/:runId/pause - Pause a running audit
   */
  router.post('/:dbId/:runId/pause', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const paused = await auditorService.pauseAudit(runId);

    if (!paused) {
      res.status(404).json({ success: false, error: 'Run not found or not running' });
      return;
    }

    res.json({ success: true, data: { message: 'Pause requested' } });
  });

  /**
   * POST /:dbId/:runId/resume - Resume a paused audit
   */
  router.post('/:dbId/:runId/resume', async (req: Request, res: Response, next) => {
    const { dbId, runId } = req.params;

    if (auditorService.isRunning()) {
      res.status(409).json({ success: false, error: 'An audit is already running' });
      return;
    }

    const started = await auditorService.startBackgroundAudit(dbId, undefined, runId).then(() => true).catch(error => {
      if (error instanceof AuditStartError) res.status(error.status).json({ success: false, error: error.message });
      else next(error);
    });
    if (!started) return;

    res.json({
      success: true,
      data: {
        message: 'Audit resumed',
        eventsUrl: `/api/audit/${dbId}/events`,
      },
    });
  });

  /**
   * POST /:dbId/:runId/cancel - Cancel a running audit
   */
  router.post('/:dbId/:runId/cancel', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const cancelled = await auditorService.cancelAudit(runId);

    if (!cancelled) {
      res.status(404).json({ success: false, error: 'Run not found or not running/paused' });
      return;
    }

    res.json({ success: true, data: { message: 'Cancellation requested' } });
  });

  /**
   * GET /:dbId/events - SSE stream for audit progress (observe-only)
   * Subscribes to events from a running audit. Does NOT start audits.
   */
  router.get('/:dbId/events', (req: Request, res: Response) => {
    const sendEvent = initSSEData(res);

    if (!auditorService.isRunning()) {
      sendEvent({
        type: 'error',
        message: 'No audit is currently running. Use POST /start to begin one.',
      });
      res.end();
      return;
    }

    const onProgress = (progress: AuditProgress) => {
      sendEvent(progress);
      if (progress.type === 'completed' || progress.type === 'error' || progress.type === 'cancelled' || progress.type === 'paused') {
        cleanup();
      }
    };

    const cleanup = () => {
      auditorService.eventBus.removeListener('progress', onProgress);
      res.end();
    };

    auditorService.eventBus.on('progress', onProgress);
    req.on('close', cleanup);
  });

  /**
   * POST /:dbId/path-audit - Audit a specific path of person IDs
   * Body: { personIds: string[] }
   */
  router.post('/:dbId/path-audit', async (req: Request, res: Response, next) => {
    const { dbId } = req.params;
    const personIds = req.body?.personIds as string[] | undefined;

    if (!Array.isArray(personIds) || !personIds.length) {
      res.status(400).json({ success: false, error: 'personIds array is required' });
      return;
    }

    if (auditorService.isRunning()) {
      res.status(409).json({ success: false, error: 'An audit is already running' });
      return;
    }

    const result = await auditorService.auditPath(dbId, personIds).catch(error => {
      if (error instanceof AuditStartError) res.status(error.status).json({ success: false, error: error.message });
      else next(error);
    });
    if (result) res.json({ success: true, data: result });
  });

  /**
   * GET /:dbId/issue-overlay - Get issue counts per person for tree overlay
   */
  router.get('/:dbId/issue-overlay', async (req: Request, res: Response) => {
    const { dbId } = req.params;
    const overlay = await auditorService.getIssueOverlay(dbId);
    res.json({ success: true, data: overlay });
  });

  /**
   * GET /:dbId/config - Get default audit config
   */
  router.get('/:dbId/config', (_req: Request, res: Response) => {
    res.json({ success: true, data: auditorService.DEFAULT_CONFIG });
  });

  /**
   * GET /:dbId/runs - List audit runs for a database
   */
  router.get('/:dbId/runs', async (req: Request, res: Response) => {
    const { dbId } = req.params;
    const runs = await auditorService.getRunsByDb(dbId);
    res.json({ success: true, data: runs });
  });

  // ============================================================================
  // ISSUE MANAGEMENT
  // ============================================================================

  /**
   * GET /:dbId/issues - List issues (filterable)
   * Query: ?type=impossible_date&severity=error&status=open&runId=xxx
   */
  router.get('/:dbId/issues', async (req: Request, res: Response) => {
    const { dbId } = req.params;
    const filters = {
      type: req.query.type as AuditIssueType | undefined,
      severity: req.query.severity as AuditIssueSeverity | undefined,
      status: req.query.status as string | undefined,
      runId: req.query.runId as string | undefined,
    };

    const issues = await auditorService.getIssues(dbId, filters);
    res.json({ success: true, data: issues });
  });

  /**
   * GET /:dbId/issues/:issueId - Get single issue detail
   */
  router.get('/:dbId/issues/:issueId', async (req: Request, res: Response) => {
    const { issueId } = req.params;
    const issue = await auditorService.getIssue(issueId);

    if (!issue) {
      res.status(404).json({ success: false, error: 'Issue not found' });
      return;
    }

    res.json({ success: true, data: issue });
  });

  // ============================================================================
  // ISSUE RESOLUTION
  // ============================================================================

  /**
   * POST /:dbId/issues/accept - Bulk accept issues
   * Body: { issueIds: string[] }
   */
  router.post('/:dbId/issues/accept', async (req: Request, res: Response) => {
    const issueIds = req.body?.issueIds as string[] | undefined;

    if (!Array.isArray(issueIds) || !issueIds.length) {
      res.status(400).json({ success: false, error: 'issueIds array is required' });
      return;
    }

    const result = await auditorService.bulkAcceptIssues(issueIds);
    res.json({ success: true, data: result });
  });

  /**
   * POST /:dbId/issues/reject - Bulk reject issues
   * Body: { issueIds: string[] }
   */
  router.post('/:dbId/issues/reject', async (req: Request, res: Response) => {
    const issueIds = req.body?.issueIds as string[] | undefined;

    if (!Array.isArray(issueIds) || !issueIds.length) {
      res.status(400).json({ success: false, error: 'issueIds array is required' });
      return;
    }

    const result = await auditorService.bulkRejectIssues(issueIds);
    res.json({ success: true, data: result });
  });

  /**
   * POST /:dbId/issues/:issueId/accept - Accept single issue
   */
  router.post('/:dbId/issues/:issueId/accept', async (req: Request, res: Response) => {
    const { issueId } = req.params;
    const result = await auditorService.acceptIssue(issueId);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: { message: 'Issue accepted' } });
  });

  /**
   * POST /:dbId/issues/:issueId/reject - Reject single issue
   */
  router.post('/:dbId/issues/:issueId/reject', async (req: Request, res: Response) => {
    const { issueId } = req.params;
    const result = await auditorService.rejectIssue(issueId);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: { message: 'Issue rejected' } });
  });

  // ============================================================================
  // CHANGE LOG
  // ============================================================================

  /**
   * GET /:dbId/changes - Get audit change log
   */
  router.get('/:dbId/changes', async (req: Request, res: Response) => {
    const { dbId } = req.params;
    const changes = await auditorService.getChanges(dbId);
    res.json({ success: true, data: changes });
  });

  /**
   * POST /:dbId/changes/:changeId/undo - Undo a specific change
   */
  router.post('/:dbId/changes/:changeId/undo', async (req: Request, res: Response) => {
    const { changeId } = req.params;
    const result = await auditorService.undoChange(changeId);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: { message: 'Change undone' } });
  });

  /**
   * GET /:dbId/:runId - Get run details with summary (catch-all, must be last)
   */
  router.get('/:dbId/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const summary = await auditorService.getRunSummary(runId);

    if (!summary) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }

    res.json({ success: true, data: summary });
  });

  return router;
}

export const auditorRouter = createAuditorRouter();
