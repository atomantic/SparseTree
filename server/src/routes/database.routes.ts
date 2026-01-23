import { Router, Response } from 'express';
import { databaseService } from '../services/database.service.js';

export const databaseRoutes = Router();

// Helper for SSE
const sendSSE = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

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

// GET /api/databases/:id/refresh/events - SSE endpoint for refresh progress
databaseRoutes.get('/:id/refresh/events', async (req, res) => {
  const { id } = req.params;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sendSSE(res, 'started', { id, message: 'Refresh started' });

  const result = await databaseService.refreshRootCount(id).catch(err => {
    sendSSE(res, 'error', { id, message: err.message });
    return null;
  });

  if (result) {
    sendSSE(res, 'complete', { id, data: result });
  }

  res.end();
});

// POST /api/databases/:id/refresh - Start refresh (returns immediately, use SSE for progress)
databaseRoutes.post('/:id/refresh', async (req, res) => {
  const { id } = req.params;

  // Return immediately, do work in background
  res.json({
    success: true,
    message: 'Refresh started',
    eventsUrl: `/api/databases/${id}/refresh/events`
  });

  // Run in background (don't await)
  databaseService.refreshRootCount(id).catch(err => {
    console.error(`Background refresh failed for ${id}:`, err.message);
  });
});

// DELETE /api/databases/:id - Delete database (root)
databaseRoutes.delete('/:id', async (req, res, next) => {
  await databaseService.deleteDatabase(req.params.id).catch(next);
  res.json({ success: true });
});
