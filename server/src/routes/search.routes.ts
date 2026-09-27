import { Router } from 'express';
import { searchService as defaultSearchService } from '../services/search.service.js';
import type { SearchParams } from '@fsf/shared';

export const createSearchRoutes = (searchService = defaultSearchService) => {
  const searchRoutes = Router();

  const parsePositiveQueryInteger = (value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
  };

  const parseNonNegativeQueryInteger = (value: unknown): number | undefined => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  };

  // GET /api/search/:dbId - Search within database
  searchRoutes.get('/:dbId', async (req, res, next) => {
    const generationMin = parseNonNegativeQueryInteger(req.query.generationMin);
    const generationMax = parseNonNegativeQueryInteger(req.query.generationMax);
    const params: SearchParams = {
      q: req.query.q as string,
      location: req.query.location as string,
      occupation: req.query.occupation as string,
      birthAfter: req.query.birthAfter as string,
      birthBefore: req.query.birthBefore as string,
      generationMin,
      generationMax,
      hasPhoto: req.query.hasPhoto === 'true',
      hasBio: req.query.hasBio === 'true',
      page: parsePositiveQueryInteger(req.query.page, 1),
      limit: parsePositiveQueryInteger(req.query.limit, 50, 100)
    };
    const result = await searchService.search(req.params.dbId, params).catch(next);
    if (result) res.json({ success: true, data: result });
  });

  return searchRoutes;
};

export const searchRoutes = createSearchRoutes();
