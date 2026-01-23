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

// POST /api/databases/:id/refresh - Refresh root counts
databaseRoutes.post('/:id/refresh', async (req, res, next) => {
  const result = await databaseService.refreshRootCount(req.params.id).catch(next);
  if (result) res.json({ success: true, data: result });
});

// DELETE /api/databases/:id - Delete database (root)
databaseRoutes.delete('/:id', async (req, res, next) => {
  await databaseService.deleteDatabase(req.params.id).catch(next);
  res.json({ success: true });
});
