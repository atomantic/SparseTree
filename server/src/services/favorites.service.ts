import fs from 'fs';
import path from 'path';
import type { FavoriteData, FavoriteWithPerson, FavoritesList, PersonAugmentation, Database } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { databaseService } from './database.service.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
const FAVORITES_DIR = path.join(DATA_DIR, 'favorites');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// Ensure favorites directory exists
if (!fs.existsSync(FAVORITES_DIR)) fs.mkdirSync(FAVORITES_DIR, { recursive: true });

/**
 * Get the best available photo URL for a person
 */
function getPhotoUrl(personId: string, augmentation?: PersonAugmentation): string | undefined {
  // Priority 1: Wikipedia photo with local path
  const wikiPhoto = augmentation?.photos?.find(p => p.source === 'wikipedia');
  if (wikiPhoto?.localPath && fs.existsSync(wikiPhoto.localPath)) {
    return `/api/augment/${personId}/wiki-photo`;
  }

  // Priority 2: Scraped FamilySearch photo
  const jpgPath = path.join(PHOTOS_DIR, `${personId}.jpg`);
  const pngPath = path.join(PHOTOS_DIR, `${personId}.png`);
  if (fs.existsSync(jpgPath) || fs.existsSync(pngPath)) {
    return `/api/browser/photos/${personId}`;
  }

  return undefined;
}

// Preset tags for suggestions
export const PRESET_TAGS = [
  'royalty',
  'immigrant',
  'revolutionary',
  'founder',
  'notable',
  'military',
  'religious',
  'scientist',
  'artist',
  'politician',
  'explorer',
  'criminal'
];

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
  const dir = getDbFavoritesDir(dbId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const favoritesService = {
  // ============ DB-SCOPED FAVORITES (NEW) ============

  /**
   * Get favorite status for a person in a specific database
   */
  getDbFavorite(dbId: string, personId: string): FavoriteData | null {
    const favPath = getDbFavoritePath(dbId, personId);
    if (!fs.existsSync(favPath)) return null;
    const data = JSON.parse(fs.readFileSync(favPath, 'utf-8')) as FavoriteData;
    return data.isFavorite ? data : null;
  },

  /**
   * Set a person as favorite in a specific database
   */
  setDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): FavoriteData {
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
  updateDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): FavoriteData | null {
    const existing = this.getDbFavorite(dbId, personId);
    if (!existing) return null;

    existing.whyInteresting = whyInteresting;
    existing.tags = tags;

    fs.writeFileSync(getDbFavoritePath(dbId, personId), JSON.stringify(existing, null, 2));
    return existing;
  },

  /**
   * Remove a person from favorites in a specific database
   */
  removeDbFavorite(dbId: string, personId: string): boolean {
    const favPath = getDbFavoritePath(dbId, personId);
    if (!fs.existsSync(favPath)) return false;
    fs.unlinkSync(favPath);
    return true;
  },

  /**
   * List all favorites in a specific database
   */
  async listDbFavorites(dbId: string, page = 1, limit = 50): Promise<FavoritesList> {
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
      const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (!favorite.isFavorite) continue;

      // Collect all tags
      favorite.tags.forEach(tag => allTags.add(tag));

      // Get person info from database
      const person = db[personId];
      const augmentation = augmentationService.getAugmentation(personId);
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
  getDbTags(dbId: string): string[] {
    const dbFavDir = getDbFavoritesDir(dbId);
    if (!fs.existsSync(dbFavDir)) {
      return PRESET_TAGS;
    }

    const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));
    const allTags = new Set<string>(PRESET_TAGS);

    for (const file of files) {
      const filePath = path.join(dbFavDir, file);
      const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
  getFavorite(personId: string): FavoriteData | null {
    const augmentation = augmentationService.getAugmentation(personId);
    if (!augmentation?.favorite?.isFavorite) return null;
    return augmentation.favorite;
  },

  /**
   * Set a person as favorite (legacy - stores in global augmentation)
   */
  setFavorite(personId: string, whyInteresting: string, tags: string[] = []): PersonAugmentation {
    const existing = augmentationService.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    existing.favorite = {
      isFavorite: true,
      whyInteresting,
      tags,
      addedAt: new Date().toISOString(),
    };

    existing.updatedAt = new Date().toISOString();
    augmentationService.saveAugmentation(existing);
    return existing;
  },

  /**
   * Update favorite details (legacy)
   */
  updateFavorite(personId: string, whyInteresting: string, tags: string[] = []): PersonAugmentation | null {
    const existing = augmentationService.getAugmentation(personId);
    if (!existing?.favorite) return null;

    existing.favorite.whyInteresting = whyInteresting;
    existing.favorite.tags = tags;
    existing.updatedAt = new Date().toISOString();

    augmentationService.saveAugmentation(existing);
    return existing;
  },

  /**
   * Remove a person from favorites (legacy)
   */
  removeFavorite(personId: string): PersonAugmentation | null {
    const existing = augmentationService.getAugmentation(personId);
    if (!existing) return null;

    delete existing.favorite;
    existing.updatedAt = new Date().toISOString();

    augmentationService.saveAugmentation(existing);
    return existing;
  },

  /**
   * List all favorites across all databases (aggregated view)
   * This scans both legacy global augmentation files AND db-scoped favorites
   */
  async listFavorites(page = 1, limit = 50): Promise<FavoritesList> {
    const allFavorites: FavoriteWithPerson[] = [];
    const allTags = new Set<string>();

    // Load all databases once for lookup
    const databases = await databaseService.listDatabases();
    const dbContents: Record<string, Database> = {};
    for (const db of databases) {
      dbContents[db.id] = await databaseService.getDatabase(db.id);
    }

    // First, scan db-scoped favorites
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
          const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          if (!favorite.isFavorite) continue;

          // Collect all tags
          favorite.tags.forEach(tag => allTags.add(tag));

          // Check if we already have this person (from another db)
          const existingEntry = allFavorites.find(f => f.personId === personId);
          if (existingEntry) {
            if (!existingEntry.databases.includes(dbId)) {
              existingEntry.databases.push(dbId);
            }
            continue;
          }

          // Get person info
          const db = dbContents[dbId];
          const person = db?.[personId];
          const augmentation = augmentationService.getAugmentation(personId);
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
      }
    }

    // Also scan legacy global augmentation files for any favorites not yet migrated
    if (fs.existsSync(AUGMENT_DIR)) {
      const files = fs.readdirSync(AUGMENT_DIR).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const filePath = path.join(AUGMENT_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const augmentation: PersonAugmentation = JSON.parse(content);

        if (!augmentation.favorite?.isFavorite) continue;

        // Skip if we already have this person from db-scoped favorites
        if (allFavorites.some(f => f.personId === augmentation.id)) continue;

        // Collect all tags
        augmentation.favorite.tags.forEach(tag => allTags.add(tag));

        // Find which databases contain this person
        const personDbs: string[] = [];
        let personName = augmentation.id;
        let personLifespan = '';

        for (const [dbId, dbContent] of Object.entries(dbContents)) {
          const person = dbContent[augmentation.id];
          if (person) {
            personDbs.push(dbId);
            if (!personName || personName === augmentation.id) {
              personName = person.name;
              personLifespan = person.lifespan;
            }
          }
        }

        const photoUrl = getPhotoUrl(augmentation.id, augmentation);

        allFavorites.push({
          personId: augmentation.id,
          name: personName,
          lifespan: personLifespan,
          photoUrl,
          favorite: augmentation.favorite,
          databases: personDbs,
        });
      }
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
   * Get favorites that exist in a specific database (used by sparse tree)
   * Checks both db-scoped favorites AND legacy global favorites
   */
  async getFavoritesInDatabase(dbId: string): Promise<FavoriteWithPerson[]> {
    const db = await databaseService.getDatabase(dbId);
    const dbPersonIds = new Set(Object.keys(db));
    const favorites: FavoriteWithPerson[] = [];

    // First, check db-scoped favorites
    const dbFavDir = getDbFavoritesDir(dbId);
    if (fs.existsSync(dbFavDir)) {
      const files = fs.readdirSync(dbFavDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const personId = file.replace('.json', '');
        if (!dbPersonIds.has(personId)) continue;

        const filePath = path.join(dbFavDir, file);
        const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (!favorite.isFavorite) continue;

        const person = db[personId];
        const augmentation = augmentationService.getAugmentation(personId);

        favorites.push({
          personId,
          name: person.name,
          lifespan: person.lifespan,
          photoUrl: getPhotoUrl(personId, augmentation || undefined),
          favorite,
          databases: [dbId],
        });
      }
    }

    // Also check legacy global augmentation files
    if (fs.existsSync(AUGMENT_DIR)) {
      const files = fs.readdirSync(AUGMENT_DIR).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const personId = file.replace('.json', '');
        if (!dbPersonIds.has(personId)) continue;
        // Skip if already added from db-scoped
        if (favorites.some(f => f.personId === personId)) continue;

        const filePath = path.join(AUGMENT_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const augmentation: PersonAugmentation = JSON.parse(content);

        if (!augmentation.favorite?.isFavorite) continue;

        const person = db[personId];

        favorites.push({
          personId,
          name: person.name,
          lifespan: person.lifespan,
          photoUrl: getPhotoUrl(personId, augmentation),
          favorite: augmentation.favorite,
          databases: [dbId],
        });
      }
    }

    return favorites;
  },

  /**
   * Get all unique tags across all favorites
   */
  getAllTags(): string[] {
    const allTags = new Set<string>(PRESET_TAGS);

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
          const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
