import { Router, Request, Response } from 'express';
import { deathsService } from '../services/deaths.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const deathsRouter = Router();

// List / search deaths
deathsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const result = deathsService.listDeaths({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    unusualOnly: req.query.unusual === '1' || req.query.unusual === 'true',
    dbId: typeof req.query.dbId === 'string' ? req.query.dbId : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.json({ success: true, data: result });
}));

// Keywords (read + edit)
deathsRouter.get('/keywords', (_req: Request, res: Response) => {
  res.json({ success: true, data: deathsService.listKeywords() });
});

deathsRouter.post('/keywords', (req: Request, res: Response) => {
  const { keyword } = req.body ?? {};
  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ success: false, error: 'keyword is required' });
  }
  deathsService.addKeyword(keyword);
  res.json({ success: true, data: deathsService.listKeywords() });
});

deathsRouter.delete('/keywords/:keyword', (req: Request, res: Response) => {
  const removed = deathsService.removeKeyword(req.params.keyword);
  res.json({ success: true, data: { removed, keywords: deathsService.listKeywords() } });
});

// Per-person read / edit
deathsRouter.get('/:personId', asyncHandler(async (req: Request, res: Response) => {
  const info = deathsService.getDeathInfo(req.params.personId);
  res.json({ success: true, data: info });
}));

deathsRouter.patch('/:personId', asyncHandler(async (req: Request, res: Response) => {
  const { cause, circumstance, isUnusualManual, reason } = req.body ?? {};
  const info = deathsService.setDeathInfo(req.params.personId, {
    cause,
    circumstance,
    isUnusualManual,
    reason,
  });
  res.json({ success: true, data: info });
}));
