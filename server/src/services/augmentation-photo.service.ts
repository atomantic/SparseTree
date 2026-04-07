import fs from 'fs';
import path from 'path';
import type { PersonAugmentation, PlatformType } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { scrapeWikipedia, scrapeAncestryPhoto, scrapeLinkedIn, scrapeWikiTree } from './platform-linking.service.js';
import { logger } from '../lib/logger.js';
import { sanitizePersonId } from '../utils/validation.js';
import { PHOTOS_DIR, findPhoto } from '../utils/paths.js';
import { getCachedProviderData } from '../utils/providerCache.js';
import { downloadImage } from '../utils/downloadImage.js';
import { normalizePhotoUrl } from '../utils/normalizePhotoUrl.js';

/** Map platform name to the photo filename suffix */
function photoSuffixFor(platform: string): string {
  return platform === 'wikipedia' ? 'wiki' : platform;
}

export function getPhotoPath(personId: string, platform: string): string | null {
  return findPhoto(sanitizePersonId(personId), platform);
}

export function hasPhoto(personId: string, platform: string): boolean {
  return getPhotoPath(personId, platform) !== null;
}

// Platform-specific aliases (used by routes and other services)
export function getWikiPhotoPath(personId: string): string | null { return getPhotoPath(personId, 'wiki'); }
export function hasWikiPhoto(personId: string): boolean { return hasPhoto(personId, 'wiki'); }
export function getAncestryPhotoPath(personId: string): string | null { return getPhotoPath(personId, 'ancestry'); }
export function hasAncestryPhoto(personId: string): boolean { return hasPhoto(personId, 'ancestry'); }
export function getWikiTreePhotoPath(personId: string): string | null { return getPhotoPath(personId, 'wikitree'); }
export function hasWikiTreePhoto(personId: string): boolean { return hasPhoto(personId, 'wikitree'); }
export function getLinkedInPhotoPath(personId: string): string | null { return getPhotoPath(personId, 'linkedin'); }
export function hasLinkedInPhoto(personId: string): boolean { return hasPhoto(personId, 'linkedin'); }
export function getFamilySearchPhotoPath(personId: string): string | null { return getPhotoPath(personId, 'familysearch'); }
export function hasFamilySearchPhoto(personId: string): boolean { return hasPhoto(personId, 'familysearch'); }

/**
 * Mark an existing or new photo entry as primary for the given platform, then save.
 */
function markPhotoPrimary(
  existing: PersonAugmentation,
  platform: PlatformType,
  localPath: string,
  fallbackUrl: string,
): void {
  existing.photos.forEach(p => p.isPrimary = false);
  const existingPhoto = existing.photos.find(p => p.source === platform);
  if (existingPhoto) {
    existingPhoto.localPath = localPath;
    existingPhoto.isPrimary = true;
  } else {
    existing.photos.push({
      url: fallbackUrl,
      source: platform,
      localPath,
      isPrimary: true,
    });
  }
  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
}

/**
 * Fetch and download photo from a linked platform, making it the primary photo
 */
export async function fetchPhotoFromPlatform(personId: string, platform: PlatformType): Promise<PersonAugmentation> {
  const safeId = sanitizePersonId(personId);
  const existing = augmentationService.getAugmentation(safeId);
  if (!existing) {
    throw new Error('No augmentation data found for this person');
  }

  const platformRef = existing.platforms.find(p => p.platform === platform);
  if (!platformRef) {
    throw new Error(`Platform ${platform} is not linked to this person`);
  }

  const suffix = photoSuffixFor(platform);

  // Check if we already have a photo from this platform locally - skip if we do
  const existingLocalPath = findPhoto(safeId, suffix);
  if (existingLocalPath) {
    markPhotoPrimary(existing, platform, existingLocalPath, platformRef.photoUrl || `/api/browser/photos/${personId}`);
    return existing;
  }

  // FamilySearch photos must be pre-downloaded via the FamilySearch scraper
  if (platform === 'familysearch') {
    throw new Error('No FamilySearch photo available for this person. Download from FamilySearch first.');
  }

  let photoUrl = platformRef.photoUrl;

  // If no stored photoUrl, try to re-scrape it
  if (!photoUrl) {
    if (platform === 'wikipedia') {
      const wikiData = await scrapeWikipedia(platformRef.url);
      photoUrl = wikiData.photoUrl;
    } else if (platform === 'wikitree') {
      const wikiTreeData = await scrapeWikiTree(platformRef.url);
      photoUrl = wikiTreeData.photoUrl;
    } else if (platform === 'ancestry') {
      // Check provider cache first to avoid re-scraping
      if (platformRef.externalId) {
        const cache = getCachedProviderData('ancestry', platformRef.externalId);
        if (cache?.scrapedData?.photoUrl) {
          photoUrl = cache.scrapedData.photoUrl;
        }
      }
      if (!photoUrl) {
        logger.browser('augment', `Re-scraping Ancestry photo for ${personId}`);
        photoUrl = await scrapeAncestryPhoto(platformRef.url);
      }
    } else if (platform === 'linkedin') {
      const linkedInData = await scrapeLinkedIn(platformRef.url);
      photoUrl = linkedInData.photoUrl;
    }

    if (photoUrl) {
      platformRef.photoUrl = photoUrl;
    }
  }

  if (!photoUrl) {
    logger.data('augment', `No photo available from ${platform} for ${personId}`);
    existing.updatedAt = new Date().toISOString();
    augmentationService.saveAugmentation(existing);
    return existing;
  }

  const normalizedPhotoUrl = normalizePhotoUrl(photoUrl, platform);

  const ext = normalizedPhotoUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
  const photoPath = path.join(PHOTOS_DIR, `${safeId}-${suffix}.${ext}`);
  if (!path.resolve(photoPath).startsWith(PHOTOS_DIR)) {
    throw new Error('Invalid person ID');
  }

  await downloadImage(normalizedPhotoUrl, photoPath);

  if (!fs.existsSync(photoPath)) {
    throw new Error(`Failed to download photo from ${platform}`);
  }

  existing.photos.forEach(p => p.isPrimary = false);
  const existingPhoto = existing.photos.find(p => p.source === platform);
  if (existingPhoto) {
    existingPhoto.url = photoUrl;
    existingPhoto.localPath = photoPath;
    existingPhoto.downloadedAt = new Date().toISOString();
    existingPhoto.isPrimary = true;
  } else {
    existing.photos.push({
      url: photoUrl,
      source: platform,
      localPath: photoPath,
      downloadedAt: new Date().toISOString(),
      isPrimary: true,
    });
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}
