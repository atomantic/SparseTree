import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import type { BuiltInProvider } from '@fsf/shared';
import { syncService } from '../services/sync.service';
import { familySearchUploadService } from '../services/familysearch-upload.service';
import { ancestryUploadService } from '../services/ancestry-upload.service';
import { familySearchRefreshService } from '../services/familysearch-refresh.service';
import { multiPlatformComparisonService } from '../services/multi-platform-comparison.service';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * Compare a person across all enabled providers (legacy endpoint)
 */
router.get('/:dbId/:personId/compare', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  const comparison = await syncService.compareAcrossProviders(dbId, personId)
    .catch(err => ({ error: err.message }));

  if ('error' in comparison) {
    res.status(500).json({ success: false, error: comparison.error });
    return;
  }

  res.json({ success: true, data: comparison });
});

/**
 * Get full multi-platform comparison for a person
 *
 * Returns a detailed comparison of person data across all linked providers,
 * showing which fields match, differ, or are missing.
 */
router.get('/:dbId/:personId/multi-platform-compare', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  const comparison = await multiPlatformComparisonService.compareAcrossPlatforms(dbId, personId)
    .catch(err => ({ error: err.message }));

  if ('error' in comparison) {
    res.status(500).json({ success: false, error: comparison.error });
    return;
  }

  res.json({ success: true, data: comparison });
});

/**
 * Refresh person data from a specific provider
 *
 * Scrapes fresh data from the specified provider and updates the cache.
 */
router.post('/:dbId/:personId/refresh-provider/:provider', async (req: Request, res: Response) => {
  const { dbId, personId, provider } = req.params;

  // Validate provider
  const validProviders: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree', '23andme'];
  if (!validProviders.includes(provider as BuiltInProvider)) {
    res.status(400).json({ success: false, error: `Invalid provider: ${provider}` });
    return;
  }

  const result = await multiPlatformComparisonService.refreshFromProvider(
    dbId,
    personId,
    provider as BuiltInProvider
  ).catch(err => ({ error: err.message }));

  if (!result || 'error' in result) {
    res.status(500).json({ success: false, error: result && 'error' in result ? result.error : 'No data returned from provider' });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Compare local data with FamilySearch for upload
 */
router.get('/:dbId/:personId/compare-for-upload', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  const comparison = await familySearchUploadService.compareForUpload(dbId, personId)
    .catch(err => ({ error: err.message }));

  if ('error' in comparison) {
    res.status(500).json({ success: false, error: comparison.error });
    return;
  }

  res.json({ success: true, data: comparison });
});

/**
 * Refresh person data from FamilySearch API
 *
 * Uses the browser session to extract auth token and fetch fresh data
 * from the FamilySearch API. Updates local JSON cache and SQLite database.
 */
router.post('/:dbId/:personId/refresh-from-familysearch', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  const result = await familySearchRefreshService.refreshPerson(dbId, personId)
    .catch(err => ({
      success: false,
      error: err.message,
    }));

  if (!result.success) {
    res.status(500).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Upload selected fields to FamilySearch
 */
router.post('/:dbId/:personId/upload-to-familysearch', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const { fields } = req.body as { fields: string[] };

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ success: false, error: 'No fields selected for upload' });
    return;
  }

  const result = await familySearchUploadService.uploadToFamilySearch(dbId, personId, fields)
    .catch(err => ({
      success: false,
      uploaded: [],
      errors: [{ field: '*', error: err.message }]
    }));

  res.json({ success: true, data: result });
});

/**
 * Compare local photo with Ancestry for upload
 */
router.get('/:dbId/:personId/compare-for-ancestry-upload', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;

  const comparison = await ancestryUploadService.compareForUpload(dbId, personId)
    .catch(err => ({ error: err.message }));

  if ('error' in comparison) {
    res.status(500).json({ success: false, error: comparison.error });
    return;
  }

  res.json({ success: true, data: comparison });
});

/**
 * Upload photo to Ancestry
 */
router.post('/:dbId/:personId/upload-to-ancestry', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const { fields } = req.body as { fields: string[] };

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ success: false, error: 'No fields selected for upload' });
    return;
  }

  const result = await ancestryUploadService.uploadToAncestry(dbId, personId, fields)
    .catch(err => ({
      success: false,
      uploaded: [],
      errors: [{ field: '*', error: err.message }]
    }));

  res.json({ success: true, data: result });
});

/**
 * Import a person from a provider
 */
router.post('/:dbId/:personId/import', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const { provider, externalId } = req.body as { provider: BuiltInProvider; externalId?: string };

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  // Use personId as externalId if not specified
  const targetId = externalId || personId;

  const person = await syncService.importPerson(provider, targetId, dbId)
    .catch(err => ({ error: err.message }));

  if ('error' in person) {
    res.status(500).json({ success: false, error: person.error });
    return;
  }

  res.json({ success: true, data: person });
});

/**
 * Open edit page on provider (push update)
 */
router.post('/:dbId/:personId/push', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const { provider } = req.body as { provider: BuiltInProvider };

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  const result = await syncService.pushUpdate(dbId, personId, provider)
    .catch(err => ({ error: err.message }));

  if ('error' in result) {
    res.status(500).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Find matching person on another provider
 */
router.post('/:dbId/:personId/find-match', async (req: Request, res: Response) => {
  const { dbId, personId } = req.params;
  const { provider } = req.body as { provider: BuiltInProvider };

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  // Load local person to search for
  const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
  const dbPath = path.join(DATA_DIR, `db-${dbId}.json`);

  if (!fs.existsSync(dbPath)) {
    res.status(404).json({ success: false, error: `Database ${dbId} not found` });
    return;
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const person = db[personId];

  if (!person) {
    res.status(404).json({ success: false, error: `Person ${personId} not found` });
    return;
  }

  const match = await syncService.findMatch(person, provider)
    .catch(() => null);

  res.json({
    success: true,
    data: match
  });
});

/**
 * SSE endpoint for batch database sync
 */
router.get('/database/:dbId/events', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const provider = req.query.provider as BuiltInProvider;
  const direction = (req.query.direction as 'import' | 'export' | 'both') || 'import';

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider query param is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  for await (const progress of syncService.syncDatabase(dbId, provider, direction)) {
    sendEvent(progress);

    if (progress.phase === 'complete' || progress.phase === 'error') {
      break;
    }
  }

  res.end();
});

/**
 * Start batch database sync (non-SSE, returns immediately)
 */
router.post('/database/:dbId', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { provider, direction } = req.body as {
    provider: BuiltInProvider;
    direction?: 'import' | 'export' | 'both';
  };

  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  // Run sync in background and return immediately
  // (in a real implementation, this would use a job queue)
  const syncPromise = (async () => {
    const results = [];
    for await (const progress of syncService.syncDatabase(dbId, provider, direction || 'import')) {
      results.push(progress);
    }
    return results[results.length - 1]; // Return final progress
  })();

  // Don't wait for completion
  syncPromise.catch(err => {
    logger.error('sync', `Sync error for ${dbId}: ${err.message}`);
  });

  res.json({
    success: true,
    data: {
      message: 'Sync started',
      dbId,
      provider,
      direction: direction || 'import',
      // Use SSE endpoint for progress
      progressUrl: `/api/sync/database/${dbId}/events?provider=${provider}&direction=${direction || 'import'}`
    }
  });
});

export const syncRouter = router;
