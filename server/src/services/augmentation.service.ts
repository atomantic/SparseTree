import { databaseService } from './database.service.js';
import fs from 'fs';
import path from 'path';
import type { PersonAugmentation, PlatformType, PersonPhoto, PersonDescription, PlatformReference } from '@fsf/shared';
import { idMappingService } from './id-mapping.service.js';
import { sanitizePersonId } from '../utils/validation.js';
import { AUGMENT_DIR } from '../utils/paths.js';
import { postgresService, type createPostgresService } from '../db/postgres.service.js';

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
 * Register an external identity in PostgreSQL if enabled
 */
export async function registerExternalIdentityIfEnabled(
  personId: string,  // FamilySearch ID
  platform: PlatformType,
  externalId: string | undefined,
  url: string
): Promise<void> {
  if (!(await databaseService.isPostgresEnabled())) return;
  if (!externalId) return;  // No external ID to register

  // Get canonical ID for this person
  const canonicalId = await idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register the external identity
  await idMappingService.registerExternalId(canonicalId, platform, externalId, { url });
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
export function createAugmentationService(
  store: ReturnType<typeof createPostgresService> = postgresService,
  directory = AUGMENT_DIR,
  isEnabled: () => Promise<boolean> = () => databaseService.isPostgresEnabled(),
) {
  const resolveCanonical = async (personId: string): Promise<string | null> => {
    if (!await isEnabled()) return null;
    await store.initDb();
    const row = await store.queryOne<{ person_id: string }>(
      `SELECT person_id FROM person WHERE person_id = @personId
       UNION ALL SELECT person_id FROM external_identity
         WHERE source = 'familysearch' AND external_id = @personId LIMIT 1`, { personId });
    return row?.person_id ?? null;
  };
  const saveFile = (data: PersonAugmentation): void => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${sanitizePersonId(data.id)}.json`), JSON.stringify(data, null, 2));
  };
  const empty = (id: string): PersonAugmentation => ({
    id, platforms: [], photos: [], descriptions: [], updatedAt: new Date().toISOString(),
  });
  return {
    async getAugmentation(personId: string): Promise<PersonAugmentation | null> {
      const canonical = await resolveCanonical(personId);
      if (canonical) {
        const row = await store.queryOne<{ data: PersonAugmentation }>(
          'SELECT data FROM person_augmentation WHERE person_id = @canonical', { canonical });
        if (row) return row.data;
      }
      const legacy = await this.getFileAugmentation(personId);
      if (!legacy || !canonical) return legacy;
      // Seed JSON once; a concurrent edit already stored in PostgreSQL wins.
      const row = await store.queryOne<{ data: PersonAugmentation }>(
        `INSERT INTO person_augmentation (person_id, data) VALUES (@canonical, @data::jsonb)
         ON CONFLICT (person_id) DO UPDATE SET person_id = EXCLUDED.person_id RETURNING data`,
        { canonical, data: JSON.stringify(legacy) });
      return row?.data ?? legacy;
    },
    async getFileAugmentation(personId: string): Promise<PersonAugmentation | null> {
      const safeId = sanitizePersonId(personId);
      // Try direct lookup first
      let filePath = path.join(directory, `${safeId}.json`);

      if (!fs.existsSync(filePath) && await isEnabled()) {
        // If personId looks like a canonical ULID, try to find the FamilySearch ID
        if (safeId.length === 26 && /^[0-9A-Z]+$/.test(safeId)) {
          const identity = await store.queryOne<{ external_id: string }>(
            `SELECT external_id FROM external_identity WHERE person_id = @personId AND source = 'familysearch' ORDER BY id LIMIT 1`, { personId: safeId });
          const externalId = identity?.external_id;
          if (externalId) {
            const safeExtId = sanitizePersonId(externalId);
            filePath = path.join(directory, `${safeExtId}.json`);
          }
        } else {
          // Maybe it's a FamilySearch ID, try to find canonical and then back to FS ID
          // (in case augmentation was saved with canonical ID)
          const canonicalId = await resolveCanonical(safeId);
          if (canonicalId && canonicalId !== safeId) {
            const safeCanonId = sanitizePersonId(canonicalId);
            filePath = path.join(directory, `${safeCanonId}.json`);
          }
        }
      }

      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(directory + path.sep)) return null;
      if (!fs.existsSync(filePath)) return null;

      let data;
      try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }

      // Migrate legacy format if needed
      if (isLegacyFormat(data)) {
        const migrated = migrateAugmentation(data);
        return migrated;
      }

      return data as PersonAugmentation;
    },

    async getOrCreate(personId: string): Promise<PersonAugmentation> {
      return await this.getAugmentation(personId) || {
        id: personId,
        platforms: [],
        photos: [],
        descriptions: [],
        updatedAt: new Date().toISOString(),
      };
    },

    async saveAugmentation(data: PersonAugmentation): Promise<void> {
      sanitizePersonId(data.id);
      const canonical = await resolveCanonical(data.id);
      if (canonical) {
        await store.transaction(async tx => {
          await tx.run('SELECT person_id FROM person WHERE person_id = @canonical FOR NO KEY UPDATE', { canonical });
          await tx.run(
            `INSERT INTO person_augmentation (person_id, data) VALUES (@canonical, @data::jsonb)
             ON CONFLICT (person_id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP`,
            { canonical, data: JSON.stringify(data) });
        });
      }
      saveFile(data);
    },

    /** Serialize read-modify-write updates across aliases, requests and processes. */
    async updateAugmentation(personId: string, update: (data: PersonAugmentation) => void): Promise<PersonAugmentation> {
      const canonical = await resolveCanonical(personId);
      if (!canonical) {
        const data = await this.getOrCreate(personId);
        update(data);
        data.updatedAt = new Date().toISOString();
        saveFile(data);
        return data;
      }
      // Read the JSON fallback before taking a pool connection. Nested pool reads
      // inside concurrent transactions could otherwise exhaust the pool.
      const legacy = await this.getFileAugmentation(personId);
      const data = await store.transaction(async tx => {
        await tx.run('SELECT person_id FROM person WHERE person_id = @canonical FOR NO KEY UPDATE', { canonical });
        const row = await tx.queryOne<{ data: PersonAugmentation }>(
          'SELECT data FROM person_augmentation WHERE person_id = @canonical', { canonical });
        const current = row?.data ?? legacy ?? empty(personId);
        update(current);
        current.updatedAt = new Date().toISOString();
        await tx.run(
          `INSERT INTO person_augmentation (person_id, data) VALUES (@canonical, @data::jsonb)
           ON CONFLICT (person_id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP`,
          { canonical, data: JSON.stringify(current) });
        return current;
      });
      saveFile(data);
      return data;
    },

    /**
     * Add or update a platform reference
     */
    async addPlatform(personId: string, platform: PlatformType, url: string, externalId?: string, options?: { registerIdentity?: boolean }): Promise<PersonAugmentation> {
      if (options?.registerIdentity !== false) {
        await registerExternalIdentityIfEnabled(personId, platform, externalId, url);
      }
      return this.updateAugmentation(personId, existing => {
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


      });
    },

    /**
     * Add a photo from a source
     */
    async addPhoto(personId: string, url: string, source: string, isPrimary = false, localPath?: string): Promise<PersonAugmentation> {
      return this.updateAugmentation(personId, existing => {
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

      });
    },

    /**
     * Add a description from a source
     */
    async addDescription(personId: string, text: string, source: string, language = 'en'): Promise<PersonAugmentation> {
      return this.updateAugmentation(personId, existing => {
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

      });
    },

    /**
     * Get primary photo for a person
     */
    async getPrimaryPhoto(personId: string): Promise<PersonPhoto | null> {
      const augmentation = await this.getAugmentation(personId);
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
    async getPrimaryDescription(personId: string): Promise<PersonDescription | null> {
      const augmentation = await this.getAugmentation(personId);
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
    async hasPlatform(personId: string, platform: PlatformType): Promise<boolean> {
      const augmentation = await this.getAugmentation(personId);
      if (!augmentation) return false;
      return augmentation.platforms.some(p => p.platform === platform);
    },

    /**
     * Get all linked platforms for a person
     */
    async getLinkedPlatforms(personId: string): Promise<PlatformReference[]> {
      const augmentation = await this.getAugmentation(personId);
      return augmentation?.platforms || [];
    },
  };
}

export const augmentationService = createAugmentationService();
