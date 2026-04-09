import { Router } from 'express';
import { databaseService } from '../services/database.service.js';

export const databaseRoutes = Router();

// GET /api/databases - List all databases (roots)
databaseRoutes.get('/', async (_req, res, next) => {
  const result = await databaseService.listDatabases().catch(next);
  if (result) res.json({ success: true, data: result });
});

// POST /api/databases - Create a new root from a person
databaseRoutes.post('/', async (req, res, next) => {
  const { personId, maxGenerations } = req.body;

  if (!personId) {
    return res.status(400).json({
      success: false,
      error: 'personId is required'
    });
  }

  const result = await databaseService.createRoot(personId, { maxGenerations }).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/databases/:id - Get database info
databaseRoutes.get('/:id', async (req, res, next) => {
  const result = await databaseService.getDatabaseInfo(req.params.id).catch(next);
  if (result) res.json({ success: true, data: result });
});

// PUT /api/databases/:id - Update root (refresh counts, update max generations)
databaseRoutes.put('/:id', async (req, res, next) => {
  const { maxGenerations } = req.body;

  const result = await databaseService.updateRoot(req.params.id, { maxGenerations }).catch(next);
  if (result) res.json({ success: true, data: result });
});

// POST /api/databases/:id/refresh - Refresh ancestor count
databaseRoutes.post('/:id/refresh', async (req, res, next) => {
  const result = await databaseService.refreshRootCount(req.params.id).catch(next);
  if (result) res.json({ success: true, data: result });
});

// POST /api/databases/:id/calculate-generations - Calculate max generations
databaseRoutes.post('/:id/calculate-generations', async (req, res, next) => {
  const result = await databaseService.calculateMaxGenerations(req.params.id).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/databases/:id/stats - Tree statistics (completeness, coverage, distributions)
databaseRoutes.get('/:id/stats', async (req, res, next) => {
  const result = await databaseService.getTreeStats(req.params.id).catch(next);
  if (result) res.json({ success: true, data: result });
});

// DELETE /api/databases/:id - Delete database (root)
databaseRoutes.delete('/:id', async (req, res, next) => {
  const ok = await databaseService.deleteDatabase(req.params.id).then(() => true).catch(next);
  if (ok) res.json({ success: true });
});
