import { Router, Request, Response } from 'express';
import { favoritesService, PRESET_TAGS } from '../services/favorites.service.js';
import { sparseTreeService } from '../services/sparse-tree.service.js';

const router = Router();

// ============ GLOBAL ENDPOINTS ============

// List all favorites across all databases (paginated)
router.get('/', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;

  const result = await favoritesService.listFavorites(page, limit);
  res.json({ success: true, data: result });
});

// Get preset tags and all used tags (global)
router.get('/tags', (_req: Request, res: Response) => {
  const allTags = favoritesService.getAllTags();
  res.json({ success: true, data: { presetTags: PRESET_TAGS, allTags } });
});

// Get favorites in a specific database (legacy endpoint, kept for backwards compatibility)
router.get('/in-database/:dbId', async (req: Request, res: Response) => {
  const { dbId } = req.params;

  const favorites = await favoritesService.getFavoritesInDatabase(dbId).catch(err => {
    res.status(404).json({ success: false, error: err.message });
    return null;
  });

  if (favorites !== null) {
    res.json({ success: true, data: favorites });
  }
});

// Get sparse tree for a database (legacy location)
router.get('/sparse-tree/:dbId', async (req: Request, res: Response) => {
  const { dbId } = req.params;

  const result = await sparseTreeService.getSparseTree(dbId).catch(err => {
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (result !== null) {
    res.json({ success: true, data: result });
  }
});

// ============ DB-SCOPED ENDPOINTS ============

// List favorites in a specific database
router.get('/db/:dbId', async (req: Request, res: Response) => {
  const { dbId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;

  const result = await favoritesService.listDbFavorites(dbId, page, limit);
  res.json({ success: true, data: result });
});

// Get tags for a specific database
router.get('/db/:dbId/tags', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const allTags = favoritesService.getDbTags(dbId);
  res.json({ success: true, data: { presetTags: PRESET_TAGS, allTags } });
});

// Get sparse tree for a database (new location under db-scoped)
router.get('/db/:dbId/sparse-tree', async (req: Request, res: Response) => {
  const { dbId } = req.params;

  const result = await sparseTreeService.getSparseTree(dbId).catch(err => {
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (result !== null) {
    res.json({ success: true, data: result });
  }
});

// Get favorite status for a person in a specific database
// Accepts both ULID and FamilySearch ID
router.get('/db/:dbId/:personId', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId } = req.params;
  const favorite = favoritesService.getDbFavorite(dbId, personId);
  res.json({ success: true, data: favorite });
});

// Mark a person as favorite in a specific database
// Accepts both ULID and FamilySearch ID
router.post('/db/:dbId/:personId', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId } = req.params;
  const { whyInteresting, tags } = req.body;

  if (!whyInteresting || typeof whyInteresting !== 'string') {
    res.status(400).json({ success: false, error: 'whyInteresting is required' });
    return;
  }

  const data = favoritesService.setDbFavorite(
    dbId,
    personId,
    whyInteresting,
    Array.isArray(tags) ? tags : []
  );

  res.json({ success: true, data: { favorite: data } });
});

// Update favorite details in a specific database
// Accepts both ULID and FamilySearch ID
router.put('/db/:dbId/:personId', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId } = req.params;
  const { whyInteresting, tags } = req.body;

  if (!whyInteresting || typeof whyInteresting !== 'string') {
    res.status(400).json({ success: false, error: 'whyInteresting is required' });
    return;
  }

  const data = favoritesService.updateDbFavorite(
    dbId,
    personId,
    whyInteresting,
    Array.isArray(tags) ? tags : []
  );

  if (!data) {
    res.status(404).json({ success: false, error: 'Person is not a favorite in this database' });
    return;
  }

  res.json({ success: true, data: { favorite: data } });
});

// Remove from favorites in a specific database
// Accepts both ULID and FamilySearch ID
router.delete('/db/:dbId/:personId', (req: Request, res: Response) => {
  const { dbId } = req.params;
  const { personId } = req.params;
  const removed = favoritesService.removeDbFavorite(dbId, personId);

  if (!removed) {
    res.status(404).json({ success: false, error: 'Person is not a favorite in this database' });
    return;
  }

  res.json({ success: true, data: { removed: true } });
});

// ============ LEGACY PERSON-LEVEL ENDPOINTS (without db context) ============

// Get favorite status for a person (legacy - global)
// Accepts both ULID and FamilySearch ID
router.get('/:personId', (req: Request, res: Response) => {
  const { personId } = req.params;
  const favorite = favoritesService.getFavorite(personId);

  res.json({ success: true, data: favorite });
});

// Mark a person as favorite (legacy - global)
// Accepts both ULID and FamilySearch ID
router.post('/:personId', (req: Request, res: Response) => {
  const { personId } = req.params;
  const { whyInteresting, tags } = req.body;

  if (!whyInteresting || typeof whyInteresting !== 'string') {
    res.status(400).json({ success: false, error: 'whyInteresting is required' });
    return;
  }

  const data = favoritesService.setFavorite(
    personId,
    whyInteresting,
    Array.isArray(tags) ? tags : []
  );

  res.json({ success: true, data });
});

// Update favorite details (legacy - global)
// Accepts both ULID and FamilySearch ID
router.put('/:personId', (req: Request, res: Response) => {
  const { personId } = req.params;
  const { whyInteresting, tags } = req.body;

  if (!whyInteresting || typeof whyInteresting !== 'string') {
    res.status(400).json({ success: false, error: 'whyInteresting is required' });
    return;
  }

  const data = favoritesService.updateFavorite(
    personId,
    whyInteresting,
    Array.isArray(tags) ? tags : []
  );

  if (!data) {
    res.status(404).json({ success: false, error: 'Person is not a favorite' });
    return;
  }

  res.json({ success: true, data });
});

// Remove from favorites (legacy - global)
// Accepts both ULID and FamilySearch ID
router.delete('/:personId', (req: Request, res: Response) => {
  const { personId } = req.params;
  const data = favoritesService.removeFavorite(personId);

  if (!data) {
    res.status(404).json({ success: false, error: 'No augmentation data found' });
    return;
  }

  res.json({ success: true, data });
});

export const favoritesRouter = router;
