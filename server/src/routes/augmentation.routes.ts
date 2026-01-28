import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { ProviderPersonMapping, PlatformType } from '@fsf/shared';
import { augmentationService } from '../services/augmentation.service.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Get augmentation data for a person
router.get('/:personId', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const data = augmentationService.getAugmentation(personId);

  if (!data) {
    res.status(404).json({ success: false, error: 'No augmentation data found' });
    return;
  }

  res.json({ success: true, data });
});

// Link a Wikipedia article to a person
router.post('/:personId/wikipedia', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ success: false, error: 'Wikipedia URL required' });
    return;
  }

  if (!url.includes('wikipedia.org')) {
    res.status(400).json({ success: false, error: 'Must be a Wikipedia URL' });
    return;
  }

  const data = await augmentationService.linkWikipedia(personId, url).catch(err => {
    logger.error('augment', `Error linking Wikipedia: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (data) {
    res.json({ success: true, data });
  }
});

// Update custom augmentation data
router.put('/:personId', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const { customBio, customPhotoUrl, notes } = req.body;

  const existing = augmentationService.getAugmentation(personId) || {
    id: personId,
    platforms: [],
    photos: [],
    descriptions: [],
    updatedAt: ''
  };

  const updated = {
    ...existing,
    customBio: customBio ?? existing.customBio,
    customPhotoUrl: customPhotoUrl ?? existing.customPhotoUrl,
    notes: notes ?? existing.notes,
    updatedAt: new Date().toISOString()
  };

  augmentationService.saveAugmentation(updated);
  res.json({ success: true, data: updated });
});

// Serve Wikipedia photo
router.get('/:personId/wiki-photo', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const photoPath = augmentationService.getWikiPhotoPath(personId);

  if (!photoPath || !fs.existsSync(photoPath)) {
    res.status(404).json({ success: false, error: 'Wiki photo not found' });
    return;
  }

  const ext = path.extname(photoPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(photoPath).pipe(res);
});

// Check if wiki photo exists
router.get('/:personId/wiki-photo/exists', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const exists = augmentationService.hasWikiPhoto(personId);
  res.json({ success: true, data: { exists } });
});

// Link an Ancestry profile to a person
router.post('/:personId/ancestry', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ success: false, error: 'Ancestry URL required' });
    return;
  }

  if (!url.includes('ancestry.com')) {
    res.status(400).json({ success: false, error: 'Must be an Ancestry.com URL' });
    return;
  }

  const data = await augmentationService.linkAncestry(personId, url).catch(err => {
    logger.error('augment', `Error linking Ancestry: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (data) {
    res.json({ success: true, data });
  }
});

// Serve Ancestry photo
router.get('/:personId/ancestry-photo', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const photoPath = augmentationService.getAncestryPhotoPath(personId);

  if (!photoPath || !fs.existsSync(photoPath)) {
    res.status(404).json({ success: false, error: 'Ancestry photo not found' });
    return;
  }

  const ext = path.extname(photoPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(photoPath).pipe(res);
});

// Check if ancestry photo exists
router.get('/:personId/ancestry-photo/exists', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const exists = augmentationService.hasAncestryPhoto(personId);
  res.json({ success: true, data: { exists } });
});

// Link a WikiTree profile to a person
router.post('/:personId/wikitree', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ success: false, error: 'WikiTree URL required' });
    return;
  }

  if (!url.includes('wikitree.com')) {
    res.status(400).json({ success: false, error: 'Must be a WikiTree URL' });
    return;
  }

  const data = await augmentationService.linkWikiTree(personId, url).catch(err => {
    logger.error('augment', `Error linking WikiTree: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (data) {
    res.json({ success: true, data });
  }
});

// Serve WikiTree photo
router.get('/:personId/wikitree-photo', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const photoPath = augmentationService.getWikiTreePhotoPath(personId);

  if (!photoPath || !fs.existsSync(photoPath)) {
    res.status(404).json({ success: false, error: 'WikiTree photo not found' });
    return;
  }

  const ext = path.extname(photoPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(photoPath).pipe(res);
});

// Check if wikitree photo exists
router.get('/:personId/wikitree-photo/exists', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const exists = augmentationService.hasWikiTreePhoto(personId);
  res.json({ success: true, data: { exists } });
});

// Link a LinkedIn profile to a person
router.post('/:personId/linkedin', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ success: false, error: 'LinkedIn URL required' });
    return;
  }

  if (!url.includes('linkedin.com/in/')) {
    res.status(400).json({ success: false, error: 'Must be a LinkedIn profile URL (linkedin.com/in/...)' });
    return;
  }

  const data = await augmentationService.linkLinkedIn(personId, url).catch(err => {
    logger.error('augment', `Error linking LinkedIn: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (data) {
    res.json({ success: true, data });
  }
});

// Serve LinkedIn photo
router.get('/:personId/linkedin-photo', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const photoPath = augmentationService.getLinkedInPhotoPath(personId);

  if (!photoPath || !fs.existsSync(photoPath)) {
    res.status(404).json({ success: false, error: 'LinkedIn photo not found' });
    return;
  }

  const ext = path.extname(photoPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(photoPath).pipe(res);
});

// Check if LinkedIn photo exists
router.get('/:personId/linkedin-photo/exists', async (req: Request, res: Response) => {
  const { personId } = req.params;
  const exists = augmentationService.hasLinkedInPhoto(personId);
  res.json({ success: true, data: { exists } });
});

// Fetch and download photo from a linked platform
router.post('/:personId/fetch-photo/:platform', async (req: Request, res: Response) => {
  const { personId, platform } = req.params;

  const validPlatforms = ['wikipedia', 'ancestry', 'wikitree', 'familysearch', 'findagrave', 'geni', 'linkedin'];
  if (!validPlatforms.includes(platform)) {
    res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
    return;
  }

  const data = await augmentationService.fetchPhotoFromPlatform(personId, platform as any).catch(err => {
    logger.error('augment', `Error fetching photo from ${platform}: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
    return null;
  });

  if (data) {
    res.json({ success: true, data });
  }
});

// Get all provider mappings for a person
router.get('/:personId/provider-links', (req: Request, res: Response) => {
  const { personId } = req.params;
  const mappings = augmentationService.getProviderMappings(personId);
  res.json({ success: true, data: mappings });
});

// Link a person to a provider
router.post('/:personId/provider-link', (req: Request, res: Response) => {
  const { personId } = req.params;
  const { providerId, platform, url, externalId, confidence, matchedBy } = req.body;

  if (!providerId) {
    res.status(400).json({ success: false, error: 'Provider ID is required' });
    return;
  }

  if (!platform) {
    res.status(400).json({ success: false, error: 'Platform is required' });
    return;
  }

  if (!url) {
    res.status(400).json({ success: false, error: 'URL is required' });
    return;
  }

  const mapping: Omit<ProviderPersonMapping, 'linkedAt'> = {
    providerId,
    platform: platform as PlatformType,
    url,
    externalId,
    confidence: confidence || 'medium',
    matchedBy: matchedBy || 'manual',
  };

  const data = augmentationService.addProviderMapping(personId, mapping);
  res.json({ success: true, data });
});

// Unlink a person from a provider
router.delete('/:personId/provider-link/:providerId', (req: Request, res: Response) => {
  const { personId, providerId } = req.params;

  const data = augmentationService.removeProviderMapping(personId, providerId);

  if (!data) {
    res.status(404).json({ success: false, error: 'No augmentation data found' });
    return;
  }

  res.json({ success: true, data });
});

export const augmentationRouter = router;
