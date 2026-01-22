import { Router } from 'express';
import { pathService } from '../services/path.service.js';
import { toExternalId } from '../middleware/id-resolver.js';

export const pathRoutes = Router();

// POST /api/path/:dbId - Find path between two persons
// Accepts both ULID and FamilySearch IDs for source and target
pathRoutes.post('/:dbId', async (req, res, next) => {
  const { source, target, method = 'shortest' } = req.body;

  if (!source || !target) {
    return res.status(400).json({
      success: false,
      error: 'source and target are required'
    });
  }

  // Resolve IDs to external form for JSON db lookup
  const sourceExternal = toExternalId(source);
  const targetExternal = toExternalId(target);

  const result = await pathService.findPath(
    req.params.dbId,
    sourceExternal,
    targetExternal,
    method as 'shortest' | 'longest' | 'random'
  ).catch(next);

  if (result) res.json({ success: true, data: result });
});
