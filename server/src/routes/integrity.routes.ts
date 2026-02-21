/**
 * Data Integrity Routes
 *
 * Endpoints for database integrity checks and bulk parent ID discovery.
 */

import { Router, Request, Response } from 'express';
import type { BuiltInProvider } from '@fsf/shared';
import { integrityService } from '../services/integrity.service.js';
import { bulkDiscoveryService } from '../services/bulk-discovery.service.js';
import { logger } from '../lib/logger.js';
import { initSSE } from '../utils/sseHelpers.js';

const router = Router();

/**
 * GET /:dbId - Full integrity summary with counts
 */
router.get('/:dbId', (req: Request, res: Response) => {
  const { dbId } = req.params;

  const summary = integrityService.getIntegritySummary(dbId);
  res.json({ success: true, data: summary });
});

/**
 * GET /:dbId/coverage - Provider coverage gaps
 * Query: ?providers=familysearch,ancestry
 */
router.get('/:dbId/coverage', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const providers = req.query.providers
    ? (req.query.providers as string).split(',')
    : undefined;

  const gaps = integrityService.getProviderCoverageGaps(dbId, providers);
  res.json({ success: true, data: gaps });
});

/**
 * GET /:dbId/parents - Parent linkage gaps
 * Query: ?provider=familysearch
 */
router.get('/:dbId/parents', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const provider = req.query.provider as string | undefined;

  const gaps = integrityService.getParentLinkageGaps(dbId, provider);
  res.json({ success: true, data: gaps });
});

/**
 * GET /:dbId/orphans - Orphaned parent edges
 */
router.get('/:dbId/orphans', (req: Request, res: Response) => {
  const { dbId } = req.params;

  const orphans = integrityService.getOrphanedEdges(dbId);
  res.json({ success: true, data: orphans });
});

/**
 * GET /:dbId/stale - Stale provider cache records
 * Query: ?days=30
 */
router.get('/:dbId/stale', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const days = parseInt(req.query.days as string) || 30;

  const stale = integrityService.getStaleProviderData(dbId, days);
  res.json({ success: true, data: stale });
});

/**
 * POST /:dbId/discover-all - Start bulk parent discovery
 * Body: { provider: 'familysearch' }
 */
router.post('/:dbId/discover-all', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { provider } = req.body as { provider: BuiltInProvider };

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  const validProviders: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree'];
  if (!validProviders.includes(provider)) {
    res.status(400).json({ success: false, error: `Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}` });
    return;
  }

  if (bulkDiscoveryService.isRunning()) {
    res.status(409).json({ success: false, error: 'A bulk discovery operation is already running' });
    return;
  }

  // Start in background, return immediately
  const generator = bulkDiscoveryService.discoverAllMissingLinks(dbId, provider);

  // Consume the generator in the background so it runs
  (async () => {
    for await (const _progress of generator) {
      // Events consumed by SSE endpoint
    }
  })().catch(err => {
    logger.error('bulk-discover', `Background bulk discovery failed: ${err.message}`);
  });

  res.json({
    success: true,
    data: {
      message: 'Bulk discovery started',
      provider,
      eventsUrl: `/api/integrity/${dbId}/discover-all/events?provider=${provider}`,
    },
  });
});

/**
 * GET /:dbId/discover-all/events - SSE stream for bulk discovery progress
 * Query: ?provider=familysearch
 */
router.get('/:dbId/discover-all/events', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const provider = req.query.provider as BuiltInProvider;

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider query param is required' });
    return;
  }

  initSSE(res);

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // If no operation running, start one
  if (!bulkDiscoveryService.isRunning()) {
    for await (const progress of bulkDiscoveryService.discoverAllMissingLinks(dbId, provider)) {
      sendEvent(progress);

      if (progress.type === 'completed' || progress.type === 'error' || progress.type === 'cancelled') {
        break;
      }
    }
  } else {
    // Operation already running - send status
    sendEvent({
      type: 'error',
      operationId: bulkDiscoveryService.getActiveOperationId(),
      provider,
      current: 0,
      total: 0,
      discovered: 0,
      skipped: 0,
      errors: 0,
      message: 'A bulk discovery operation is already running. Cancel it first.',
    });
  }

  res.end();
});

/**
 * POST /:dbId/discover-all/cancel - Cancel running bulk discovery
 */
router.post('/:dbId/discover-all/cancel', (_req: Request, res: Response) => {
  const cancelled = bulkDiscoveryService.requestCancel();

  if (!cancelled) {
    res.status(404).json({ success: false, error: 'No bulk discovery operation is currently running' });
    return;
  }

  res.json({ success: true, data: { message: 'Cancellation requested' } });
});

export const integrityRouter = router;
