import { Router } from 'express';
import { searchService } from '../services/search.service.js';
import type { SearchParams } from '@fsf/shared';

export const searchRoutes = Router();

// GET /api/search/:dbId - Search within database
searchRoutes.get('/:dbId', async (req, res, next) => {
  const generationMin = req.query.generationMin ? parseInt(req.query.generationMin as string) : undefined;
  const generationMax = req.query.generationMax ? parseInt(req.query.generationMax as string) : undefined;
  const params: SearchParams = {
    q: req.query.q as string,
    location: req.query.location as string,
    occupation: req.query.occupation as string,
    birthAfter: req.query.birthAfter as string,
    birthBefore: req.query.birthBefore as string,
    generationMin: !isNaN(generationMin as number) ? generationMin : undefined,
    generationMax: !isNaN(generationMax as number) ? generationMax : undefined,
    hasPhoto: req.query.hasPhoto === 'true',
    hasBio: req.query.hasBio === 'true',
    page: parseInt(req.query.page as string) || 1,
    limit: parseInt(req.query.limit as string) || 50
  };
  const result = await searchService.search(req.params.dbId, params).catch(next);
  if (result) res.json({ success: true, data: result });
});
