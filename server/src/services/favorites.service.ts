import fs from 'fs';
import path from 'path';
import type { FavoriteData, FavoriteWithPerson, FavoritesList, PersonAugmentation } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { databaseService } from './database.service.js';
import { PRESET_TAGS } from './favorites.constants.js';
import {
  getAllTagsPostgres,
  getDbFavoritePostgres,
  getDbTagsPostgres,
  getFavoritesInDatabasePostgres,
  listDbFavoritesPostgres,
  listFavoritesPostgres,
  removeDbFavoritePostgres,
  setDbFavoritePostgres,
} from './favorites-postgres.service.js';
import { DATA_DIR, AUGMENT_DIR, PHOTOS_DIR, ensureDir, findLocalPhoto, localPhotoRoute } from '../utils/paths.js';

export { PRESET_TAGS };

const FAVORITES_DIR = path.join(DATA_DIR, 'favorites');
ensureDir(FAVORITES_DIR);

/**
 * Get the best available photo URL for a person
 */
export function getPhotoUrl(
  personId: string,
  augmentation?: PersonAugmentation,
  photosDir = PHOTOS_DIR,
): string | undefined {
  // Priority 1: Wikipedia photo with local path
  const wikiPhoto = augmentation?.photos?.find(p => p.source === 'wikipedia');
  if (wikiPhoto?.localPath && fs.existsSync(wikiPhoto.localPath)) {
    return localPhotoRoute(personId, 'wiki');
  }

  // Preserve the generic scraper photo as the only fallback after Wikipedia.
  const photo = findLocalPhoto(personId, ['generic'], photosDir);
  return photo ? localPhotoRoute(personId, photo.source) : undefined;
}

// Preset tags for suggestions


/**
 * Get path to db-scoped favorites directory
 */
function getDbFavoritesDir(dbId: string): string {
  return path.join(FAVORITES_DIR, dbId);
}

/**
 * Get path to db-scoped favorite file
 */
function getDbFavoritePath(dbId: string, personId: string): string {
  return path.join(getDbFavoritesDir(dbId), `${personId}.json`);
}

/**
 * Ensure db favorites directory exists
 */
function ensureDbFavoritesDir(dbId: string): void {
  ensureDir(getDbFavoritesDir(dbId));
}

export const favoritesService = {
  // ============ DB-SCOPED FAVORITES ============

  /**
   * Get favorite status for a person in a specific database
   */
  async getDbFavorite(dbId: string, personId: string): Promise<FavoriteData | null> {
    if (await databaseService.isPostgresEnabled()) {
      return getDbFavoritePostgres(dbId, personId);
    }

    // Fall back to JSON
    const favPath = getDbFavoritePath(dbId, personId);
    if (!fs.existsSync(favPath)) return null;
    let data: FavoriteData;
    try { data = JSON.parse(fs.readFileSync(favPath, 'utf-8')); } catch { return null; }
    return data.isFavorite ? data : null;
  },

  /**
   * Set a person as favorite in a specific database
   */
  async setDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): Promise<FavoriteData> {
    if (await databaseService.isPostgresEnabled()) {
      const result = await setDbFavoritePostgres(dbId, personId, whyInteresting, tags);
      ensureDbFavoritesDir(dbId);
      fs.writeFileSync(getDbFavoritePath(dbId, personId), JSON.stringify(result, null, 2));
      return result;
    }

    // JSON only
    ensureDbFavoritesDir(dbId);

    const favorite: FavoriteData = {
      isFavorite: true,
      whyInteresting,
      tags,
      addedAt: new Date().toISOString(),
    };

    fs.writeFileSync(getDbFavoritePath(dbId, personId), JSON.stringify(favorite, null, 2));
    return favorite;
  },

  /**
   * Update favorite details in a specific database
   */
  async updateDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): Promise<FavoriteData | null> {
    const existing = await this.getDbFavorite(dbId, personId);
    if (!existing) return null;

    // Keep the PostgreSQL favorite and JSON backup in sync
    return this.setDbFavorite(dbId, personId, whyInteresting, tags);
  },

  /**
   * Remove a person from favorites in a specific database
   */
  async removeDbFavorite(dbId: string, personId: string): Promise<boolean> {
    let removed = false;

    if (await databaseService.isPostgresEnabled()) {
      removed = await removeDbFavoritePostgres(dbId, personId);
    }

    // Also remove JSON file
    const favPath = getDbFavoritePath(dbId, personId);
    if (fs.existsSync(favPath)) {
      fs.unlinkSync(favPath);
      removed = true;
    }

    return removed;
  },

  /**
   * List all favorites in a specific database
   */
  async listDbFavorites(dbId: string, page = 1, limit = 50): Promise<FavoritesList> {
    if (await databaseService.isPostgresEnabled()) {
      return listDbFavoritesPostgres(dbId, page, limit, getPhotoUrl);
    }

    // Fall back to JSON
    const dbFavDir = getDbFavoritesDir(dbId);
    if (!fs.existsSync(dbFavDir)) {
      return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [] };
    }

    const db = await databaseService.getDatabase(dbId).catch(() => null);
    if (!db) {
      return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [] };
    }

    const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));
    const allFavorites: FavoriteWithPerson[] = [];
    const allTags = new Set<string>();

    for (const file of files) {
      const personId = file.replace('.json', '');
      const filePath = path.join(dbFavDir, file);
      let favorite: FavoriteData;
      try { favorite = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }

      if (!favorite.isFavorite) continue;

      // Collect all tags
      favorite.tags.forEach(tag => allTags.add(tag));

      // Get person info from database
      const person = db[personId];
      const augmentation = await augmentationService.getAugmentation(personId);
      const photoUrl = getPhotoUrl(personId, augmentation || undefined);

      allFavorites.push({
        personId,
        name: person?.name || personId,
        lifespan: person?.lifespan || '',
        photoUrl,
        favorite,
        databases: [dbId],
      });
    }

    // Sort by addedAt descending (newest first)
    allFavorites.sort((a, b) =>
      new Date(b.favorite.addedAt).getTime() - new Date(a.favorite.addedAt).getTime()
    );

    // Paginate
    const total = allFavorites.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const favorites = allFavorites.slice(start, start + limit);

    return {
      favorites,
      total,
      page,
      limit,
      totalPages,
      allTags: Array.from(allTags).sort(),
    };
  },

  /**
   * Get all tags used in a specific database's favorites
   */
  async getDbTags(dbId: string): Promise<string[]> {
    if (await databaseService.isPostgresEnabled()) {
      return getDbTagsPostgres(dbId);
    }

    // Fall back to JSON
    const dbFavDir = getDbFavoritesDir(dbId);
    if (!fs.existsSync(dbFavDir)) {
      return PRESET_TAGS;
    }

    const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));
    const allTags = new Set<string>(PRESET_TAGS);

    for (const file of files) {
      const filePath = path.join(dbFavDir, file);
      let favorite: FavoriteData;
      try { favorite = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }
      if (favorite.tags) {
        favorite.tags.forEach(tag => allTags.add(tag));
      }
    }

    return Array.from(allTags).sort();
  },

  // ============ GLOBAL/LEGACY FAVORITES (keeping for backwards compatibility and global view) ============

  /**
   * Get favorite status for a person (legacy - checks global augmentation)
   */
  async getFavorite(personId: string): Promise<FavoriteData | null> {
    const augmentation = await augmentationService.getAugmentation(personId);
    if (!augmentation?.favorite?.isFavorite) return null;
    return augmentation.favorite;
  },

  /**
   * Set a person as favorite (legacy - stores in global augmentation)
   */
  async setFavorite(personId: string, whyInteresting: string, tags: string[] = []): Promise<PersonAugmentation> {
    return augmentationService.updateAugmentation(personId, existing => {
      existing.favorite = {
        isFavorite: true,
        whyInteresting,
        tags,
        addedAt: new Date().toISOString(),
      };
    });
  },

  /**
   * Update favorite details (legacy)
   */
  async updateFavorite(personId: string, whyInteresting: string, tags: string[] = []): Promise<PersonAugmentation | null> {
    const existing = await augmentationService.getAugmentation(personId);
    if (!existing?.favorite) return null;

    let updated = false;
    const result = await augmentationService.updateAugmentation(personId, current => {
      if (!current.favorite) return;
      current.favorite.whyInteresting = whyInteresting;
      current.favorite.tags = tags;
      updated = true;
    });
    return updated ? result : null;
  },

  /**
   * Remove a person from favorites (legacy)
   */
  async removeFavorite(personId: string): Promise<PersonAugmentation | null> {
    const existing = await augmentationService.getAugmentation(personId);
    if (!existing) return null;

    return augmentationService.updateAugmentation(personId, current => {
      delete current.favorite;
    });
  },

  /**
   * List all favorites across all databases (aggregated view)
   * Uses PostgreSQL joins when the query store is available
   */
  async listFavorites(page = 1, limit = 50): Promise<FavoritesList> {
    if (await databaseService.isPostgresEnabled()) {
      return listFavoritesPostgres(page, limit, getPhotoUrl);
    }

    // Fall back to the JSON backups when the query store is unavailable
    const allFavorites: FavoriteWithPerson[] = [];
    const allTags = new Set<string>();

    // Scan db-scoped favorites from JSON
    if (fs.existsSync(FAVORITES_DIR)) {
      const dbDirs = fs.readdirSync(FAVORITES_DIR).filter(f =>
        fs.statSync(path.join(FAVORITES_DIR, f)).isDirectory()
      );

      for (const dbId of dbDirs) {
        const dbFavDir = path.join(FAVORITES_DIR, dbId);
        const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));

        for (const file of files) {
          const personId = file.replace('.json', '');
          const filePath = path.join(dbFavDir, file);
          let favorite: FavoriteData;
          try { favorite = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }

          if (!favorite.isFavorite) continue;

          favorite.tags.forEach(tag => allTags.add(tag));

          const existingEntry = allFavorites.find(f => f.personId === personId);
          if (existingEntry) {
            if (!existingEntry.databases.includes(dbId)) {
              existingEntry.databases.push(dbId);
            }
            continue;
          }

          allFavorites.push({
            personId,
            name: personId, // Name lookup would require loading DB - skip for speed
            lifespan: '',
            photoUrl: undefined,
            favorite,
            databases: [dbId],
          });
        }
      }
    }

    // Sort by addedAt descending
    allFavorites.sort((a, b) =>
      new Date(b.favorite.addedAt).getTime() - new Date(a.favorite.addedAt).getTime()
    );

    // Paginate
    const total = allFavorites.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const favorites = allFavorites.slice(start, start + limit);

    return {
      favorites,
      total,
      page,
      limit,
      totalPages,
      allTags: Array.from(allTags).sort(),
    };
  },

  /**
   * Get favorites that exist in a specific database (used by sparse tree)
   * Uses PostgreSQL joins when the query store is available
   */
  async getFavoritesInDatabase(dbId: string): Promise<FavoriteWithPerson[]> {
    const favorites: FavoriteWithPerson[] = [];

    if (await databaseService.isPostgresEnabled()) {
      return getFavoritesInDatabasePostgres(dbId);
    }

    // Fall back to JSON - simplified, no N+1 queries
    const dbFavDir = getDbFavoritesDir(dbId);
    if (fs.existsSync(dbFavDir)) {
      const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const personId = file.replace('.json', '');
        const filePath = path.join(dbFavDir, file);
        let favorite: FavoriteData;
        try { favorite = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }

        if (!favorite.isFavorite) continue;

        favorites.push({
          personId,
          name: personId, // Name would require DB lookup - skip for JSON mode
          lifespan: '',
          photoUrl: undefined,
          favorite,
          databases: [dbId],
        });
      }
    }

    return favorites;
  },

  /**
   * Get all unique tags across all favorites
   */
  async getAllTags(): Promise<string[]> {
    const allTags = new Set<string>(PRESET_TAGS);

    if (await databaseService.isPostgresEnabled()) {
      return getAllTagsPostgres();
    }

    // Scan db-scoped favorites
    if (fs.existsSync(FAVORITES_DIR)) {
      const dbDirs = fs.readdirSync(FAVORITES_DIR).filter(f =>
        fs.statSync(path.join(FAVORITES_DIR, f)).isDirectory()
      );

      for (const dbId of dbDirs) {
        const dbFavDir = path.join(FAVORITES_DIR, dbId);
        const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));

        for (const file of files) {
          const filePath = path.join(dbFavDir, file);
          let favorite: FavoriteData;
          try { favorite = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }
          if (favorite.tags) {
            favorite.tags.forEach(tag => allTags.add(tag));
          }
        }
      }
    }

    // Also scan legacy augmentation files
    if (fs.existsSync(AUGMENT_DIR)) {
      const files = fs.readdirSync(AUGMENT_DIR).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const filePath = path.join(AUGMENT_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const augmentation: PersonAugmentation = JSON.parse(content);

        if (augmentation.favorite?.tags) {
          augmentation.favorite.tags.forEach(tag => allTags.add(tag));
        }
      }
    }

    return Array.from(allTags).sort();
  },
};
