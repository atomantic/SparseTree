import fs from 'fs';
import path from 'path';
import type { FavoriteData, FavoriteWithPerson, FavoritesList, PersonAugmentation } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { databaseService, resolveDbId, getCanonicalDbId } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

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

// ============ SQLite-backed favorites ============

/**
 * Get favorite from SQLite
 */
function getDbFavoriteSqlite(dbId: string, personId: string): FavoriteData | null {
  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) return null;

  // Resolve to canonical person ID
  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return null;

  const row = sqliteService.queryOne<{
    why_interesting: string | null;
    tags: string | null;
    added_at: string | null;
  }>(
    `SELECT why_interesting, tags, added_at FROM favorite
     WHERE db_id = @dbId AND person_id = @personId`,
    { dbId: internalDbId, personId: canonicalId }
  );

  if (!row) return null;

  return {
    isFavorite: true,
    whyInteresting: row.why_interesting ?? '',
    tags: row.tags ? JSON.parse(row.tags) : [],
    addedAt: row.added_at ?? new Date().toISOString(),
  };
}

/**
 * Set favorite in SQLite
 */
function setDbFavoriteSqlite(
  dbId: string,
  personId: string,
  whyInteresting: string,
  tags: string[] = []
): FavoriteData {
  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) {
    throw new Error(`Database ${dbId} not found`);
  }

  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) {
    throw new Error(`Person ${personId} not found`);
  }

  const addedAt = new Date().toISOString();

  sqliteService.run(
    `INSERT OR REPLACE INTO favorite (db_id, person_id, why_interesting, tags, added_at)
     VALUES (@dbId, @personId, @why, @tags, @addedAt)`,
    {
      dbId: internalDbId,
      personId: canonicalId,
      why: whyInteresting,
      tags: JSON.stringify(tags),
      addedAt,
    }
  );

  return {
    isFavorite: true,
    whyInteresting,
    tags,
    addedAt,
  };
}

/**
 * Remove favorite from SQLite
 */
function removeDbFavoriteSqlite(dbId: string, personId: string): boolean {
  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) return false;

  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return false;

  const result = sqliteService.run(
    'DELETE FROM favorite WHERE db_id = @dbId AND person_id = @personId',
    { dbId: internalDbId, personId: canonicalId }
  );

  return result.changes > 0;
}

/**
 * List favorites from SQLite
 */
async function listDbFavoritesSqlite(
  dbId: string,
  page = 1,
  limit = 50
): Promise<FavoritesList> {
  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) {
    return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: PRESET_TAGS };
  }

  // Get canonical database ID for response
  const canonicalDbId = getCanonicalDbId(internalDbId);

  const offset = (page - 1) * limit;

  // Get total count
  const countResult = sqliteService.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM favorite WHERE db_id = @dbId',
    { dbId: internalDbId }
  );
  const total = countResult?.count ?? 0;

  if (total === 0) {
    return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [] };
  }

  // Get paginated favorites
  const rows = sqliteService.queryAll<{
    person_id: string;
    why_interesting: string | null;
    tags: string | null;
    added_at: string | null;
  }>(
    `SELECT person_id, why_interesting, tags, added_at
     FROM favorite
     WHERE db_id = @dbId
     ORDER BY added_at DESC
     LIMIT @limit OFFSET @offset`,
    { dbId: internalDbId, limit, offset }
  );

  // Get all tags for this database
  const tagRows = sqliteService.queryAll<{ tags: string }>(
    'SELECT DISTINCT tags FROM favorite WHERE db_id = @dbId AND tags IS NOT NULL',
    { dbId: internalDbId }
  );
  const allTagsSet = new Set<string>(PRESET_TAGS);
  for (const { tags } of tagRows) {
    const parsed = JSON.parse(tags) as string[];
    parsed.forEach(t => allTagsSet.add(t));
  }

  // Build response
  const favorites: FavoriteWithPerson[] = [];
  for (const row of rows) {
    // Get external ID for backwards compatibility
    const extId = idMappingService.getExternalId(row.person_id, 'familysearch');
    const personId = extId ?? row.person_id;

    const person = await databaseService.getPerson(dbId, row.person_id);
    const augmentation = augmentationService.getAugmentation(personId);

    favorites.push({
      personId,
      name: person?.name ?? personId,
      lifespan: person?.lifespan ?? '',
      photoUrl: getPhotoUrl(personId, augmentation ?? undefined),
      favorite: {
        isFavorite: true,
        whyInteresting: row.why_interesting ?? '',
        tags: row.tags ? JSON.parse(row.tags) : [],
        addedAt: row.added_at ?? new Date().toISOString(),
      },
      databases: [canonicalDbId],
    });
  }

  const totalPages = Math.ceil(total / limit);

  return {
    favorites,
    total,
    page,
    limit,
    totalPages,
    allTags: Array.from(allTagsSet).sort(),
  };
}

/**
 * Get all tags from SQLite
 */
function getDbTagsSqlite(dbId: string): string[] {
  // Resolve database ID to internal db_id
  const internalDbId = resolveDbId(dbId);
  if (!internalDbId) return [...PRESET_TAGS];

  const rows = sqliteService.queryAll<{ tags: string }>(
    'SELECT DISTINCT tags FROM favorite WHERE db_id = @dbId AND tags IS NOT NULL',
    { dbId: internalDbId }
  );

  const allTags = new Set<string>(PRESET_TAGS);
  for (const { tags } of rows) {
    const parsed = JSON.parse(tags) as string[];
    parsed.forEach(t => allTags.add(t));
  }

  return Array.from(allTags).sort();
}

export const favoritesService = {
  // ============ DB-SCOPED FAVORITES ============

  /**
   * Get favorite status for a person in a specific database
   */
  getDbFavorite(dbId: string, personId: string): FavoriteData | null {
    // Try SQLite first
    if (databaseService.isSqliteEnabled()) {
      return getDbFavoriteSqlite(dbId, personId);
    }

    // Fall back to JSON
    const favPath = getDbFavoritePath(dbId, personId);
    if (!fs.existsSync(favPath)) return null;
    const data = JSON.parse(fs.readFileSync(favPath, 'utf-8')) as FavoriteData;
    return data.isFavorite ? data : null;
  },

  /**
   * Set a person as favorite in a specific database
   */
  setDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): FavoriteData {
    // Try SQLite first
    if (databaseService.isSqliteEnabled()) {
      const result = setDbFavoriteSqlite(dbId, personId, whyInteresting, tags);
      // Also write to JSON for backup
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
  updateDbFavorite(dbId: string, personId: string, whyInteresting: string, tags: string[] = []): FavoriteData | null {
    const existing = this.getDbFavorite(dbId, personId);
    if (!existing) return null;

    // Use setDbFavorite which handles both SQLite and JSON
    return this.setDbFavorite(dbId, personId, whyInteresting, tags);
  },

  /**
   * Remove a person from favorites in a specific database
   */
  removeDbFavorite(dbId: string, personId: string): boolean {
    let removed = false;

    // Try SQLite
    if (databaseService.isSqliteEnabled()) {
      removed = removeDbFavoriteSqlite(dbId, personId);
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
    // Try SQLite first
    if (databaseService.isSqliteEnabled()) {
      return listDbFavoritesSqlite(dbId, page, limit);
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
    // Try SQLite first
    if (databaseService.isSqliteEnabled()) {
      return getDbTagsSqlite(dbId);
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
   * Optimized: Uses JOIN query when SQLite is enabled to avoid N+1 queries
   */
  async listFavorites(page = 1, limit = 50): Promise<FavoritesList> {
    // If SQLite is enabled, use an optimized single query
    if (databaseService.isSqliteEnabled()) {
      const offset = (page - 1) * limit;

      // Get total count first
      const countResult = sqliteService.queryOne<{ count: number }>(
        'SELECT COUNT(DISTINCT person_id) as count FROM favorite'
      );
      const total = countResult?.count ?? 0;

      if (total === 0) {
        return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [...PRESET_TAGS] };
      }

      // Get all tags in one query
      const tagRows = sqliteService.queryAll<{ tags: string }>(
        'SELECT DISTINCT tags FROM favorite WHERE tags IS NOT NULL'
      );
      const allTags = new Set<string>(PRESET_TAGS);
      for (const { tags } of tagRows) {
        JSON.parse(tags).forEach((t: string) => allTags.add(t));
      }

      // Use a single optimized JOIN query for favorites + person data
      const rows = sqliteService.queryAll<{
        person_id: string;
        db_id: string;
        why_interesting: string | null;
        tags: string | null;
        added_at: string | null;
        display_name: string;
        birth_date: string | null;
        death_date: string | null;
        external_id: string | null;
      }>(
        `SELECT
          f.person_id,
          f.db_id,
          f.why_interesting,
          f.tags,
          f.added_at,
          p.display_name,
          birth.date_original as birth_date,
          death.date_original as death_date,
          ei.external_id
        FROM favorite f
        JOIN person p ON f.person_id = p.person_id
        LEFT JOIN vital_event birth ON f.person_id = birth.person_id AND birth.event_type = 'birth'
        LEFT JOIN vital_event death ON f.person_id = death.person_id AND death.event_type = 'death'
        LEFT JOIN external_identity ei ON f.person_id = ei.person_id AND ei.source = 'familysearch'
        ORDER BY f.added_at DESC
        LIMIT @limit OFFSET @offset`,
        { limit, offset }
      );

      // Group by person (a person can be in multiple databases)
      const personMap = new Map<string, FavoriteWithPerson>();

      for (const row of rows) {
        const personId = row.external_id ?? row.person_id;
        const canonicalDbId = getCanonicalDbId(row.db_id);

        const existing = personMap.get(personId);
        if (existing) {
          if (!existing.databases.includes(canonicalDbId)) {
            existing.databases.push(canonicalDbId);
          }
          continue;
        }

        // Build lifespan from birth/death dates
        const birthYear = row.birth_date?.match(/\d{4}/)?.at(0) ?? '';
        const deathYear = row.death_date?.match(/\d{4}/)?.at(0) ?? '';
        const lifespan = birthYear || deathYear ? `${birthYear}-${deathYear}` : '';

        personMap.set(personId, {
          personId,
          name: row.display_name,
          lifespan,
          photoUrl: undefined, // Skip photo lookup for speed - can be lazy loaded
          favorite: {
            isFavorite: true,
            whyInteresting: row.why_interesting ?? '',
            tags: row.tags ? JSON.parse(row.tags) : [],
            addedAt: row.added_at ?? new Date().toISOString(),
          },
          databases: [canonicalDbId],
        });
      }

      const favorites = Array.from(personMap.values());
      const totalPages = Math.ceil(total / limit);

      return {
        favorites,
        total,
        page,
        limit,
        totalPages,
        allTags: Array.from(allTags).sort(),
      };
    }

    // Fall back to file-based scanning for non-SQLite mode
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
          const favorite: FavoriteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

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
   * Checks both db-scoped favorites AND legacy global favorites
   */
  async getFavoritesInDatabase(dbId: string): Promise<FavoriteWithPerson[]> {
    const favorites: FavoriteWithPerson[] = [];

    // Resolve database ID to internal db_id
    const internalDbId = resolveDbId(dbId);

    // If SQLite is enabled, query from there
    if (databaseService.isSqliteEnabled() && internalDbId) {
      // Get canonical database ID for response
      const canonicalDbId = getCanonicalDbId(internalDbId);

      const rows = sqliteService.queryAll<{
        person_id: string;
        why_interesting: string | null;
        tags: string | null;
        added_at: string | null;
      }>(
        `SELECT person_id, why_interesting, tags, added_at
         FROM favorite
         WHERE db_id = @dbId`,
        { dbId: internalDbId }
      );

      for (const row of rows) {
        const extId = idMappingService.getExternalId(row.person_id, 'familysearch');
        const personId = extId ?? row.person_id;

        const person = await databaseService.getPerson(dbId, row.person_id);
        if (!person) continue;

        const augmentation = augmentationService.getAugmentation(personId);

        favorites.push({
          personId,
          name: person.name,
          lifespan: person.lifespan,
          photoUrl: getPhotoUrl(personId, augmentation ?? undefined),
          favorite: {
            isFavorite: true,
            whyInteresting: row.why_interesting ?? '',
            tags: row.tags ? JSON.parse(row.tags) : [],
            addedAt: row.added_at ?? new Date().toISOString(),
          },
          databases: [canonicalDbId],
        });
      }

      return favorites;
    }

    // Fall back to JSON
    const db = await databaseService.getDatabase(dbId);
    const dbPersonIds = new Set(Object.keys(db));

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

    // If SQLite is enabled, query from there
    if (databaseService.isSqliteEnabled()) {
      const rows = sqliteService.queryAll<{ tags: string }>(
        'SELECT DISTINCT tags FROM favorite WHERE tags IS NOT NULL'
      );
      for (const { tags } of rows) {
        JSON.parse(tags).forEach((t: string) => allTags.add(t));
      }
      return Array.from(allTags).sort();
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
