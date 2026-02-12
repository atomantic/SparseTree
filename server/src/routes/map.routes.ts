/**
 * Map routes - Migration map visualization endpoints
 *
 * Provides map data (person coordinates) and batch geocoding via SSE.
 *
 * IMPORTANT: Static routes (geocode/*) must come before parameterized routes (/:dbId/*)
 * to prevent Express from matching "geocode" as a :dbId parameter.
 */

import { Router, Request, Response } from 'express';
import { mapService } from '../services/map.service.js';
import { geocodeService } from '../services/geocode.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { logger } from '../lib/logger.js';

export const mapRouter = Router();

/**
 * GET /api/map/geocode/stats
 * Get geocode cache statistics
 */
mapRouter.get('/geocode/stats', (_req: Request, res: Response) => {
  const stats = geocodeService.getGeocodeStats();
  res.json({ success: true, data: stats });
});

/**
 * POST /api/map/geocode/reset-not-found
 * Reset all not_found entries to pending so they get retried with broadening
 */
mapRouter.post('/geocode/reset-not-found', (_req: Request, res: Response) => {
  const count = geocodeService.resetNotFound();
  logger.api('map', `🔄 Reset ${count} not_found geocode entries to pending`);
  res.json({ success: true, data: { reset: count } });
});

/**
 * GET /api/map/geocode/stream
 * SSE stream for batch geocoding places in a database.
 * Uses EventSource-compatible GET endpoint (POST SSE is unreliable with fetch).
 * Use POST /geocode/reset-not-found first to retry previously failed places.
 */
mapRouter.get('/geocode/stream', async (req: Request, res: Response) => {
  const dbId = typeof req.query.dbId === 'string' ? req.query.dbId : '';

  if (!dbId) {
    res.status(400).json({ success: false, error: 'dbId query param required' });
    return;
  }

  // Validate dbId exists to prevent abuse
  const dbExists = sqliteService.queryOne<{ db_id: string }>(
    'SELECT db_id FROM database_info WHERE db_id = @dbId',
    { dbId }
  );
  if (!dbExists) {
    res.status(404).json({ success: false, error: 'Database not found' });
    return;
  }

  const placesToGeocode = mapService.getUngeocodedPlaces(dbId);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setTimeout(0); // No timeout for SSE
  res.flushHeaders();

  if (placesToGeocode.length === 0) {
    res.write(`data: ${JSON.stringify({ type: 'complete', current: 0, total: 0 })}\n\n`);
    res.end();
    return;
  }

  logger.api('map', `🗺️ Starting batch geocode of ${placesToGeocode.length} places`);

  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  const streamResult = await (async () => {
    for await (const progress of geocodeService.batchGeocode(placesToGeocode)) {
      if (cancelled) return 'cancelled';
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    }
    return 'ok';
  })().catch((err: Error) => {
    logger.api('map', `❌ Batch geocode stream error: ${err.message}`);
    if (!cancelled) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
    return 'error';
  });

  if (streamResult === 'ok') {
    res.write(`data: ${JSON.stringify({ type: 'complete', current: placesToGeocode.length, total: placesToGeocode.length })}\n\n`);
  }

  res.end();
});

/**
 * GET /api/map/:dbId/sparse
 * Get sparse tree map data (favorites only)
 */
mapRouter.get('/:dbId/sparse', async (req: Request, res: Response) => {
  const { dbId } = req.params;

  logger.api('map', `Sparse tree map data for ${dbId}`);

  const data = await mapService.getSparseTreeMapData(dbId);
  res.json({ success: true, data });
});

/**
 * GET /api/map/:dbId/:personId
 * Get ancestry tree map data for a person
 */
mapRouter.get('/:dbId/:personId', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const MAX_DEPTH = 15;
  const parsedDepth = parseInt(req.query.depth as string);
  const depth = (!Number.isFinite(parsedDepth) || parsedDepth < 1) ? 8 : Math.min(parsedDepth, MAX_DEPTH);

  logger.api('map', `Ancestry map data for ${personId} in ${dbId}, depth=${depth}`);

  const data = await mapService.getAncestryMapData(dbId, personId, depth);
  res.json({ success: true, data });
});
