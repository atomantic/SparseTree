import { Router, Request, Response } from 'express';
import { aiDiscoveryService } from '../services/ai-discovery.service.js';
import { favoritesService } from '../services/favorites.service.js';

const router = Router();

/**
 * Start a quick AI discovery to find interesting ancestors
 * POST /api/ai-discovery/:dbId/quick
 */
router.post('/:dbId/quick', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { sampleSize, model, excludeBiblical, minBirthYear, customPrompt } = req.body;

  console.log(`[ai-discovery] Quick discovery request: dbId=${dbId}, sampleSize=${sampleSize || 100}, model=${model || 'default'}, excludeBiblical=${excludeBiblical || false}, customPrompt=${customPrompt ? `"${customPrompt.slice(0, 50)}..."` : 'none'}`);

  const result = await aiDiscoveryService.quickDiscovery(dbId, {
    sampleSize: sampleSize || 100,
    model,
    excludeBiblical: excludeBiblical || false,
    minBirthYear,
    customPrompt,
  }).catch(err => {
    console.error(`[ai-discovery] Quick discovery failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (result !== null) {
    console.log(`[ai-discovery] Quick discovery complete: analyzed=${result.totalAnalyzed}, candidates=${result.candidates.length}`);
    res.json({ success: true, data: result });
  }
});

/**
 * Start a full AI discovery run (async)
 * POST /api/ai-discovery/:dbId/start
 */
router.post('/:dbId/start', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { batchSize, maxPersons, model } = req.body;

  const result = await aiDiscoveryService.startDiscovery(dbId, {
    batchSize,
    maxPersons,
    model,
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

export const aiDiscoveryRouter = router;
