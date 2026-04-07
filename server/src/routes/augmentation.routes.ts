import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { ProviderPersonMapping, PlatformType } from '@fsf/shared';
import { augmentationService } from '../services/augmentation.service.js';
import { linkWikipedia, linkAncestry, linkWikiTree, linkLinkedIn } from '../services/platform-linking.service.js';
import {
  getWikiPhotoPath, hasWikiPhoto,
  getAncestryPhotoPath, hasAncestryPhoto,
  getWikiTreePhotoPath, hasWikiTreePhoto,
  getFamilySearchPhotoPath, hasFamilySearchPhoto,
  getLinkedInPhotoPath, hasLinkedInPhoto,
  fetchPhotoFromPlatform,
} from '../services/augmentation-photo.service.js';
import { getProviderMappings, addProviderMapping, removeProviderMapping } from '../services/provider-mapping.service.js';
import { logger } from '../lib/logger.js';
import { sanitizePersonId, isValidUrl } from '../utils/validation.js';
import { PHOTOS_DIR } from '../utils/paths.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

/**
 * Factory for photo-serve route handlers.
 * All provider photo endpoints follow the same pattern.
 */
function servePhoto(getPath: (id: string) => string | null, label: string) {
  return async (req: Request, res: Response) => {
    const personId = sanitizePersonId(req.params.personId);
    const photoPath = getPath(personId);

    if (!photoPath || !path.resolve(photoPath).startsWith(PHOTOS_DIR) || !fs.existsSync(photoPath)) {
      res.status(404).json({ success: false, error: `${label} photo not found` });
      return;
    }

    const ext = path.extname(photoPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = fs.createReadStream(photoPath);
    stream.on('error', (err) => {
      logger.error('augment', `Stream error serving ${label} photo: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Error reading photo file' });
      }
    });
    stream.pipe(res);
  };
}

/**
 * Factory for photo-exists check handlers.
 * All providers use the same pattern: sanitize ID, check existence, return JSON.
 */
function checkPhotoExists(hasPhoto: (id: string) => boolean) {
  return async (req: Request, res: Response) => {
    const personId = sanitizePersonId(req.params.personId);
    const exists = hasPhoto(personId);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, data: { exists } });
  };
}

/**
 * Factory for platform link handlers.
 * Wikipedia, Ancestry, WikiTree, LinkedIn all follow the same: validate URL → call service → return result.
 */
function linkPlatform(
  domain: string,
  label: string,
  linkFn: (personId: string, url: string) => Promise<unknown>
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const personId = sanitizePersonId(req.params.personId);
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ success: false, error: `${label} URL required` });
      return;
    }

    if (!isValidUrl(url, domain)) {
      res.status(400).json({ success: false, error: `Must be a ${label} URL` });
      return;
    }

    const data = await linkFn(personId, url).catch(err => {
      logger.error('augment', `Error linking ${label}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
      return null;
    });

    if (data) {
      res.json({ success: true, data });
    }
  });
}

// Get augmentation data for a person
router.get('/:personId', async (req: Request, res: Response) => {
  const personId = sanitizePersonId(req.params.personId);
  const data = augmentationService.getAugmentation(personId);

  if (!data) {
    res.status(404).json({ success: false, error: 'No augmentation data found' });
    return;
  }

  res.json({ success: true, data });
});

// Link a Wikipedia article to a person
router.post('/:personId/wikipedia', linkPlatform('wikipedia.org', 'Wikipedia', (id, url) => linkWikipedia(id, url)));

// Update custom augmentation data
router.put('/:personId', async (req: Request, res: Response) => {
  const personId = sanitizePersonId(req.params.personId);
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
router.get('/:personId/wiki-photo', servePhoto(id => getWikiPhotoPath(id), 'Wiki'));

// Check if wiki photo exists
router.get('/:personId/wiki-photo/exists', checkPhotoExists(id => hasWikiPhoto(id)));

// Link an Ancestry profile to a person
router.post('/:personId/ancestry', linkPlatform('ancestry.com', 'Ancestry', (id, url) => linkAncestry(id, url)));

// Serve Ancestry photo
router.get('/:personId/ancestry-photo', servePhoto(id => getAncestryPhotoPath(id), 'Ancestry'));

// Check if ancestry photo exists
router.get('/:personId/ancestry-photo/exists', checkPhotoExists(id => hasAncestryPhoto(id)));

// Link a WikiTree profile to a person
router.post('/:personId/wikitree', linkPlatform('wikitree.com', 'WikiTree', (id, url) => linkWikiTree(id, url)));

// Serve WikiTree photo
router.get('/:personId/wikitree-photo', servePhoto(id => getWikiTreePhotoPath(id), 'WikiTree'));

// Check if wikitree photo exists
router.get('/:personId/wikitree-photo/exists', checkPhotoExists(id => hasWikiTreePhoto(id)));

// Serve FamilySearch photo
router.get('/:personId/familysearch-photo', servePhoto(id => getFamilySearchPhotoPath(id), 'FamilySearch'));

// Check if FamilySearch photo exists
router.get('/:personId/familysearch-photo/exists', checkPhotoExists(id => hasFamilySearchPhoto(id)));

// Link a LinkedIn profile to a person
router.post('/:personId/linkedin', linkPlatform('linkedin.com', 'LinkedIn', (id, url) => linkLinkedIn(id, url)));

// Serve LinkedIn photo
router.get('/:personId/linkedin-photo', servePhoto(id => getLinkedInPhotoPath(id), 'LinkedIn'));

// Check if LinkedIn photo exists
router.get('/:personId/linkedin-photo/exists', checkPhotoExists(id => hasLinkedInPhoto(id)));

// Fetch and download photo from a linked platform
router.post('/:personId/fetch-photo/:platform', async (req: Request, res: Response) => {
  const personId = sanitizePersonId(req.params.personId);
  const { platform } = req.params;

  const validPlatforms = ['wikipedia', 'ancestry', 'wikitree', 'familysearch', 'findagrave', 'geni', 'linkedin'];
  if (!validPlatforms.includes(platform)) {
    res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
    return;
  }

  const data = await fetchPhotoFromPlatform(personId, platform as any).catch(err => {
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
  const personId = sanitizePersonId(req.params.personId);
  const mappings = getProviderMappings(personId);
  res.json({ success: true, data: mappings });
});

// Link a person to a provider
router.post('/:personId/provider-link', (req: Request, res: Response) => {
  const personId = sanitizePersonId(req.params.personId);
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

  const data = addProviderMapping(personId, mapping);
  res.json({ success: true, data });
});

// Unlink a person from a provider
router.delete('/:personId/provider-link/:providerId', (req: Request, res: Response) => {
  const personId = sanitizePersonId(req.params.personId);
  const { providerId } = req.params;

  const data = removeProviderMapping(personId, providerId);

  if (!data) {
    res.status(404).json({ success: false, error: 'No augmentation data found' });
    return;
  }

  res.json({ success: true, data });
});

export const augmentationRouter = router;
