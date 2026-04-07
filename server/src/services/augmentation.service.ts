import fs from 'fs';
import path from 'path';
import type { PersonAugmentation, PlatformType, PersonPhoto, PersonDescription, PlatformReference } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { idMappingService } from './id-mapping.service.js';
import { sanitizePersonId } from '../utils/validation.js';
import { AUGMENT_DIR } from '../utils/paths.js';

// Legacy interface for migration
interface LegacyAugmentation {
  id: string;
  wikipediaUrl?: string;
  wikipediaTitle?: string;
  wikipediaDescription?: string;
  wikipediaPhotoUrl?: string;
  customPhotoUrl?: string;
  customDescription?: string;
  updatedAt: string;
}

/**
 * Migrate legacy augmentation to new format
 */
function migrateAugmentation(legacy: LegacyAugmentation): PersonAugmentation {
  const augmentation: PersonAugmentation = {
    id: legacy.id,
    platforms: [],
    photos: [],
    descriptions: [],
    updatedAt: legacy.updatedAt,
  };

  // Migrate Wikipedia data
  if (legacy.wikipediaUrl) {
    augmentation.platforms.push({
      platform: 'wikipedia',
      url: legacy.wikipediaUrl,
      linkedAt: legacy.updatedAt,
    });

    if (legacy.wikipediaPhotoUrl) {
      augmentation.photos.push({
        url: legacy.wikipediaPhotoUrl,
        source: 'wikipedia',
        isPrimary: true,
      });
    }

    if (legacy.wikipediaDescription) {
      augmentation.descriptions.push({
        text: legacy.wikipediaDescription,
        source: 'wikipedia',
        language: 'en',
      });
    }
  }

  // Migrate custom data
  if (legacy.customPhotoUrl) {
    augmentation.customPhotoUrl = legacy.customPhotoUrl;
  }
  if (legacy.customDescription) {
    augmentation.customBio = legacy.customDescription;
  }

  return augmentation;
}

/**
 * Check if augmentation is in legacy format
 */
function isLegacyFormat(data: unknown): data is LegacyAugmentation {
  // Legacy format has wikipediaUrl but not platforms array
  return typeof data === 'object' && data !== null
    && 'wikipediaUrl' in data && !('platforms' in data);
}

/**
 * Register an external identity in SQLite if enabled
 */
export function registerExternalIdentityIfEnabled(
  personId: string,  // FamilySearch ID
  platform: PlatformType,
  externalId: string | undefined,
  url: string
): void {
  if (!databaseService.isSqliteEnabled()) return;
  if (!externalId) return;  // No external ID to register

  // Get canonical ID for this person
  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register the external identity
  idMappingService.registerExternalId(canonicalId, platform, externalId, { url });
}

/**
 * Core augmentation CRUD service.
 *
 * Platform linking, photo management, and provider mappings
 * have been extracted to their own service files:
 * - platform-linking.service.ts
 * - augmentation-photo.service.ts
 * - provider-mapping.service.ts
 */
export const augmentationService = {
  getAugmentation(personId: string): PersonAugmentation | null {
    const safeId = sanitizePersonId(personId);
    // Try direct lookup first
    let filePath = path.join(AUGMENT_DIR, `${safeId}.json`);

    if (!fs.existsSync(filePath)) {
      // If personId looks like a canonical ULID, try to find the FamilySearch ID
      if (safeId.length === 26 && /^[0-9A-Z]+$/.test(safeId)) {
        const externalId = idMappingService.getExternalId(safeId, 'familysearch');
        if (externalId) {
          const safeExtId = sanitizePersonId(externalId);
          filePath = path.join(AUGMENT_DIR, `${safeExtId}.json`);
        }
      } else {
        // Maybe it's a FamilySearch ID, try to find canonical and then back to FS ID
        // (in case augmentation was saved with canonical ID)
        const canonicalId = idMappingService.resolveId(safeId, 'familysearch');
        if (canonicalId && canonicalId !== safeId) {
          const safeCanonId = sanitizePersonId(canonicalId);
          filePath = path.join(AUGMENT_DIR, `${safeCanonId}.json`);
        }
      }
    }

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(AUGMENT_DIR)) return null;
    if (!fs.existsSync(filePath)) return null;

    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }

    // Migrate legacy format if needed
    if (isLegacyFormat(data)) {
      const migrated = migrateAugmentation(data);
      // Save migrated version
      this.saveAugmentation(migrated);
      return migrated;
    }

    return data as PersonAugmentation;
  },

  getOrCreate(personId: string): PersonAugmentation {
    return this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };
  },

  saveAugmentation(data: PersonAugmentation): void {
    const safeId = sanitizePersonId(data.id);
    const filePath = path.join(AUGMENT_DIR, `${safeId}.json`);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(AUGMENT_DIR)) return;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  },

  /**
   * Add or update a platform reference
   */
  addPlatform(personId: string, platform: PlatformType, url: string, externalId?: string): PersonAugmentation {
    const existing = this.getOrCreate(personId);

    // Check if platform already linked
    const existingPlatform = existing.platforms.find(p => p.platform === platform);
    if (existingPlatform) {
      existingPlatform.url = url;
      if (externalId) existingPlatform.externalId = externalId;
      existingPlatform.linkedAt = new Date().toISOString();
    } else {
      existing.platforms.push({
        platform,
        url,
        externalId,
        linkedAt: new Date().toISOString(),
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);

    // Also register in SQLite external_identity
    registerExternalIdentityIfEnabled(personId, platform, externalId, url);

    return existing;
  },

  /**
   * Add a photo from a source
   */
  addPhoto(personId: string, url: string, source: string, isPrimary = false, localPath?: string): PersonAugmentation {
    const existing = this.getOrCreate(personId);

    // If setting as primary, unset other primary photos
    if (isPrimary) {
      existing.photos.forEach(p => p.isPrimary = false);
    }

    // Check if photo from this source already exists
    const existingPhoto = existing.photos.find(p => p.source === source);
    if (existingPhoto) {
      existingPhoto.url = url;
      existingPhoto.isPrimary = isPrimary;
      if (localPath) existingPhoto.localPath = localPath;
    } else {
      existing.photos.push({
        url,
        source,
        isPrimary,
        localPath,
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Add a description from a source
   */
  addDescription(personId: string, text: string, source: string, language = 'en'): PersonAugmentation {
    const existing = this.getOrCreate(personId);

    // Check if description from this source already exists
    const existingDesc = existing.descriptions.find(d => d.source === source);
    if (existingDesc) {
      existingDesc.text = text;
      existingDesc.language = language;
    } else {
      existing.descriptions.push({
        text,
        source,
        language,
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Get primary photo for a person
   */
  getPrimaryPhoto(personId: string): PersonPhoto | null {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return null;

    // First try to find explicitly marked primary photo
    const primary = augmentation.photos.find(p => p.isPrimary);
    if (primary) return primary;

    // Fall back to first photo
    return augmentation.photos[0] || null;
  },

  /**
   * Get primary description for a person
   */
  getPrimaryDescription(personId: string): PersonDescription | null {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return null;

    // Prefer custom bio
    if (augmentation.customBio) {
      return { text: augmentation.customBio, source: 'custom' };
    }

    // Return first description
    return augmentation.descriptions[0] || null;
  },

  /**
   * Check if a platform is linked for a person
   */
  hasPlatform(personId: string, platform: PlatformType): boolean {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return false;
    return augmentation.platforms.some(p => p.platform === platform);
  },

  /**
   * Get all linked platforms for a person
   */
  getLinkedPlatforms(personId: string): PlatformReference[] {
    const augmentation = this.getAugmentation(personId);
    return augmentation?.platforms || [];
  },
};
