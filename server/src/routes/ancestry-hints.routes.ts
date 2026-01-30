/**
 * Ancestry Hints Routes
 *
 * API endpoints for processing free hints on Ancestry.com
 */

import { Router, Request, Response } from 'express';
import { ancestryHintsService } from '../services/ancestry-hints.service.js';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * POST /:dbId/:personId - Process free hints for a single person
 * Returns the result with counts of hints processed
 */
router.post('/:dbId/:personId', async (req: Request, res: Response) => {
  const { personId } = req.params;

  logger.start('ancestry-hints', `Processing hints for person ${personId}`);

  const result = await ancestryHintsService.processPersonHints(personId).catch(err => {
    logger.error('ancestry-hints', `Failed to process hints: ${err.message}`);
    return {
      personId,
      treeId: '',
      hintsFound: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: [err.message],
    };
  });

  if (result.errors.length > 0 && result.hintsProcessed === 0) {
    res.status(400).json({ success: false, error: result.errors[0], data: result });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * GET /:dbId/:personId/events - SSE stream for hints processing progress
 * Streams real-time progress events during hint processing
 */
router.get('/:dbId/:personId/events', async (req: Request, res: Response) => {
  const { personId } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // If already running, send error
  if (ancestryHintsService.isRunning()) {
    sendEvent({
      type: 'error',
      operationId: ancestryHintsService.getActiveOperationId(),
      personId,
      treeId: '',
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: 'A hints processing operation is already running. Cancel it first.',
    });
    res.end();
    return;
  }

  logger.start('ancestry-hints', `Starting SSE hints stream for person ${personId}`);

  for await (const progress of ancestryHintsService.processPersonHintsWithProgress(personId)) {
    sendEvent(progress);

    if (progress.type === 'completed' || progress.type === 'error' || progress.type === 'cancelled') {
      break;
    }
  }

  res.end();
});

/**
 * POST /:dbId/cancel - Cancel the running hints operation
 */
router.post('/:dbId/cancel', (_req: Request, res: Response) => {
  const cancelled = ancestryHintsService.requestCancel();

  if (!cancelled) {
    res.status(404).json({ success: false, error: 'No hints operation is currently running' });
    return;
  }

  res.json({ success: true, data: { message: 'Cancellation requested' } });
});

/**
 * GET /status - Check if a hints operation is running
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      running: ancestryHintsService.isRunning(),
      operationId: ancestryHintsService.getActiveOperationId(),
    },
  });
});

export const ancestryHintsRouter = router;
