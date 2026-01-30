/**
 * Ancestry Update Routes
 *
 * API endpoints for the Ancestry Update automation feature.
 * Provides SSE streaming for real-time progress updates.
 */

import { Router, Request, Response } from 'express';
import { ancestryUpdateService } from '../services/ancestry-update.service.js';
import { idMappingService } from '../services/id-mapping.service.js';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * GET /status - Check if an update operation is running
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = ancestryUpdateService.getStatus();
  res.json({
    success: true,
    data: status,
  });
});

/**
 * GET /:dbId/events - SSE stream for update progress
 * Query params:
 *   - rootPersonId: Required. The canonical ID or FamilySearch ID of the root person
 *   - maxGenerations: Optional. 1, 2, 3, 4, or 'full'. Default: 4
 *   - testMode: Optional. If 'true', runs in dry-run mode
 */
router.get('/:dbId/events', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { rootPersonId, maxGenerations, testMode } = req.query;

  if (!rootPersonId || typeof rootPersonId !== 'string') {
    res.status(400).json({ success: false, error: 'rootPersonId is required' });
    return;
  }

  // Resolve person ID to canonical
  const canonicalPersonId = idMappingService.resolveId(rootPersonId, 'familysearch') || rootPersonId;

  // Parse maxGenerations
  let generations: number | 'full' = 4;
  if (maxGenerations === 'full') {
    generations = 'full';
  } else if (maxGenerations && typeof maxGenerations === 'string') {
    const parsed = parseInt(maxGenerations, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
      generations = parsed;
    }
  }

  const isTestMode = testMode === 'true';

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // If already running, send error
  if (ancestryUpdateService.isRunning()) {
    sendEvent({
      type: 'error',
      operationId: ancestryUpdateService.getActiveOperationId(),
      dbId,
      queueSize: 0,
      processedCount: 0,
      currentGeneration: 0,
      maxGenerations: generations,
      stats: { recordsLinked: 0, hintsProcessed: 0, dataDownloaded: 0, parentsQueued: 0, skipped: 0, errors: 1 },
      message: 'An Ancestry update operation is already running. Cancel it first.',
    });
    res.end();
    return;
  }

  logger.start('ancestry-update', `Starting SSE stream for dbId=${dbId}, root=${canonicalPersonId}, depth=${generations}`);

  for await (const progress of ancestryUpdateService.runAncestryUpdate(
    dbId,
    canonicalPersonId,
    generations,
    isTestMode
  )) {
    sendEvent(progress);

    if (progress.type === 'completed' || progress.type === 'error' || progress.type === 'cancelled') {
      break;
    }
  }

  res.end();
});

/**
 * POST /:dbId/cancel - Cancel the running update operation
 */
router.post('/:dbId/cancel', (_req: Request, res: Response) => {
  const cancelled = ancestryUpdateService.requestCancel();

  if (!cancelled) {
    res.status(404).json({ success: false, error: 'No Ancestry update operation is currently running' });
    return;
  }

  res.json({ success: true, data: { message: 'Cancellation requested' } });
});

/**
 * GET /:dbId/validate/:personId - Validate that a person can be used as root
 */
router.get('/:dbId/validate/:personId', (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  // Resolve to canonical ID
  const canonicalPersonId = idMappingService.resolveId(personId, 'familysearch') || personId;

  const result = ancestryUpdateService.validateRoot(dbId, canonicalPersonId);

  if (!result.valid) {
    res.status(404).json({ success: false, error: result.error });
    return;
  }

  res.json({
    success: true,
    data: {
      valid: result.valid,
      hasAncestryLink: result.hasAncestryLink,
      personName: result.personName,
    },
  });
});

export const ancestryUpdateRouter = router;
