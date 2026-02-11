import { Router, Request, Response } from 'express';
import { aiDiscoveryService } from '../services/ai-discovery.service.js';
import { favoritesService } from '../services/favorites.service.js';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * Start a quick AI discovery to find interesting ancestors
 * POST /api/ai-discovery/:dbId/quick
 */
router.post('/:dbId/quick', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { sampleSize, excludeBiblical, minBirthYear, maxGenerations, customPrompt } = req.body;

  logger.start('ai-discovery', `Quick discovery request dbId=${dbId} sample=${sampleSize || 100} excludeBiblical=${excludeBiblical || false} maxGenerations=${maxGenerations || 'all'} prompt=${customPrompt ? `"${customPrompt.slice(0, 50)}..."` : 'none'}`);

  const result = await aiDiscoveryService.quickDiscovery(dbId, {
    sampleSize: sampleSize || 100,
    excludeBiblical: excludeBiblical || false,
    minBirthYear,
    maxGenerations,
    customPrompt,
  }).catch(err => {
    logger.error('ai-discovery', `Quick discovery failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (result !== null) {
    logger.done('ai-discovery', `Quick discovery complete: analyzed=${result.totalAnalyzed} candidates=${result.candidates.length}`);
    res.json({ success: true, data: result });
  }
});

/**
 * Start a full AI discovery run (async)
 * POST /api/ai-discovery/:dbId/start
 */
router.post('/:dbId/start', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { batchSize, maxPersons } = req.body;

  const result = await aiDiscoveryService.startDiscovery(dbId, {
    batchSize,
    maxPersons,
  }).catch(err => {
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (result !== null) {
    res.json({ success: true, data: result });
  }
});

/**
 * Get progress of a discovery run
 * GET /api/ai-discovery/progress/:runId
 */
router.get('/progress/:runId', (req: Request, res: Response) => {
  const { runId } = req.params;
  const progress = aiDiscoveryService.getProgress(runId);

  if (!progress) {
    res.status(404).json({ success: false, error: 'Run not found' });
    return;
  }

  res.json({ success: true, data: progress });
});

/**
 * Apply a candidate as a favorite
 * POST /api/ai-discovery/:dbId/apply
 */
router.post('/:dbId/apply', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId, whyInteresting, tags } = req.body;

  if (!personId || !whyInteresting) {
    res.status(400).json({ success: false, error: 'personId and whyInteresting are required' });
    return;
  }

  favoritesService.setDbFavorite(
    dbId,
    personId,
    whyInteresting,
    Array.isArray(tags) ? tags : []
  );

  res.json({ success: true, data: { applied: true } });
});

/**
 * Apply multiple candidates as favorites
 * POST /api/ai-discovery/:dbId/apply-batch
 */
router.post('/:dbId/apply-batch', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { candidates } = req.body;

  if (!Array.isArray(candidates)) {
    res.status(400).json({ success: false, error: 'candidates array is required' });
    return;
  }
  if (candidates.length > 1000) {
    res.status(400).json({ success: false, error: 'Maximum 1000 candidates per batch' });
    return;
  }

  let applied = 0;
  for (const candidate of candidates) {
    if (candidate.personId && candidate.whyInteresting) {
      favoritesService.setDbFavorite(
        dbId,
        candidate.personId,
        candidate.whyInteresting,
        Array.isArray(candidate.suggestedTags) ? candidate.suggestedTags : []
      );
      applied++;
    }
  }

  res.json({ success: true, data: { applied } });
});

/**
 * Dismiss a candidate (mark as not interesting)
 * POST /api/ai-discovery/:dbId/dismiss
 */
router.post('/:dbId/dismiss', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId, whyInteresting, suggestedTags } = req.body;

  if (!personId) {
    res.status(400).json({ success: false, error: 'personId is required' });
    return;
  }

  const result = aiDiscoveryService.dismissCandidate(
    dbId,
    personId,
    whyInteresting,
    Array.isArray(suggestedTags) ? suggestedTags : []
  );

  res.json({ success: true, data: result });
});

/**
 * Dismiss multiple candidates at once
 * POST /api/ai-discovery/:dbId/dismiss-batch
 */
router.post('/:dbId/dismiss-batch', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { candidates } = req.body;

  if (!Array.isArray(candidates)) {
    res.status(400).json({ success: false, error: 'candidates array is required' });
    return;
  }
  if (candidates.length > 1000) {
    res.status(400).json({ success: false, error: 'Maximum 1000 candidates per batch' });
    return;
  }

  const result = aiDiscoveryService.dismissCandidatesBatch(dbId, candidates);
  res.json({ success: true, data: result });
});

/**
 * Get dismissed candidates for a database
 * GET /api/ai-discovery/:dbId/dismissed
 */
router.get('/:dbId/dismissed', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const dismissed = aiDiscoveryService.getDismissedCandidates(dbId);
  const count = aiDiscoveryService.getDismissedCount(dbId);
  res.json({ success: true, data: { dismissed, count } });
});

/**
 * Undo dismiss (restore a candidate)
 * DELETE /api/ai-discovery/:dbId/dismissed/:personId
 */
router.delete('/:dbId/dismissed/:personId', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const result = aiDiscoveryService.undoDismiss(dbId, personId);
  res.json({ success: true, data: result });
});

/**
 * Clear all dismissed candidates for a database
 * DELETE /api/ai-discovery/:dbId/dismissed
 */
router.delete('/:dbId/dismissed', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const result = aiDiscoveryService.clearDismissed(dbId);
  res.json({ success: true, data: result });
});

/**
 * Debug endpoints - gated behind ENABLE_AI_DEBUG=1 env var.
 * These expose AI run metadata, prompts, and outputs.
 */
const debugEnabled = process.env.ENABLE_AI_DEBUG === '1';

/**
 * Get recent AI run logs for debugging
 * GET /api/ai-discovery/debug/runs
 */
router.get('/debug/runs', async (_req: Request, res: Response) => {
  if (!debugEnabled) {
    res.status(403).json({ success: false, error: 'Debug endpoints disabled. Set ENABLE_AI_DEBUG=1 to enable.' });
    return;
  }
  const toolkit = await import('../services/ai-toolkit.service.js').then(m => m.getAIToolkit());
  const { runner } = toolkit.services;

  const runs = await runner.listRuns(10, 0, 'ai-discovery');
  res.json({ success: true, data: runs });
});

/**
 * Get specific run output for debugging
 * GET /api/ai-discovery/debug/runs/:runId
 */
router.get('/debug/runs/:runId', async (req: Request, res: Response) => {
  if (!debugEnabled) {
    res.status(403).json({ success: false, error: 'Debug endpoints disabled. Set ENABLE_AI_DEBUG=1 to enable.' });
    return;
  }
  const { runId } = req.params;
  const toolkit = await import('../services/ai-toolkit.service.js').then(m => m.getAIToolkit());
  const { runner } = toolkit.services;

  const [metadata, output, prompt] = await Promise.all([
    runner.getRun(runId),
    runner.getRunOutput(runId),
    runner.getRunPrompt(runId),
  ]);

  if (!metadata) {
    res.status(404).json({ success: false, error: 'Run not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      metadata,
      output: output?.substring(0, 50000), // Limit output size
      promptLength: prompt?.length,
      promptPreview: prompt?.substring(0, 1000),
    }
  });
});

export const aiDiscoveryRouter = router;
