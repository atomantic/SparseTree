import { Router } from 'express';
import { databaseService } from '../services/database.service.js';
import { emitDatabaseEvent } from '../services/socket.service.js';

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

// POST /api/databases/:id/refresh - Start refresh (returns immediately, emits socket events)
databaseRoutes.post('/:id/refresh', async (req, res) => {
  const { id } = req.params;

  // Emit started event via socket
  emitDatabaseEvent(id, 'refresh', { status: 'started' });

  // Return immediately
  res.json({
    success: true,
    message: 'Refresh started'
  });

  // Run in background (don't await)
  databaseService.refreshRootCount(id)
    .then(result => {
      emitDatabaseEvent(id, 'refresh', { status: 'complete', personCount: result.personCount, data: result });
    })
    .catch(err => {
      console.error(`Background refresh failed for ${id}:`, err.message);
      emitDatabaseEvent(id, 'refresh', { status: 'error', message: err.message });
    });
});

// DELETE /api/databases/:id - Delete database (root)
databaseRoutes.delete('/:id', async (req, res, next) => {
  await databaseService.deleteDatabase(req.params.id).catch(next);
  res.json({ success: true });
});
