import fs from 'fs';
import path from 'path';
import type { FavoriteData, FavoriteWithPerson, FavoritesList, PersonAugmentation } from '@fsf/shared';
import { postgresService } from '../db/postgres.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { augmentationService } from './augmentation.service.js';
import { databaseService } from './database.service.js';
import { legacySqliteDatabase } from './legacy-sqlite-database.js';
import { PRESET_TAGS } from './favorites.constants.js';
import { DATA_DIR } from '../utils/paths.js';
import { buildLifespan } from '../utils/lifespan.js';
import { parseYear } from '../utils/parseYear.js';

const FAVORITES_DIR = path.join(DATA_DIR, 'favorites');
type PhotoUrlResolver = (personId: string, augmentation?: PersonAugmentation) => string | undefined;

type PostgresFavoriteRow = {
  why_interesting: string | null;
  tags: unknown;
  added_at: Date | string | null;
};

type PostgresFavoritePersonRow = PostgresFavoriteRow & {
  person_id: string;
  display_name: string;
  birth_date: string | null;
  death_date: string | null;
  external_id: string | null;
  db_id?: string;
};

type FavoriteSeed = {
  dbId: string;
  personId: string;
  whyInteresting: string;
  tags: string[];
  addedAt: string;
};

let postgresFavoriteSeed: Promise<void> | undefined;
const POSTGRES_FAVORITES_BACKFILL = 'postgres_003_favorites_backfill';

function favoriteTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function favoriteAddedAt(value: Date | string | null): string {
  if (value instanceof Date) return value.toISOString();
  return value || new Date().toISOString();
}

function mapPostgresFavorite(row: PostgresFavoriteRow): FavoriteData {
  return {
    isFavorite: true,
    whyInteresting: row.why_interesting ?? '',
    tags: favoriteTags(row.tags),
    addedAt: favoriteAddedAt(row.added_at),
  };
}

async function ensurePostgresFavoritesSeeded(): Promise<void> {
  if (!postgresFavoriteSeed) {
    postgresFavoriteSeed = (async () => {
      const migration = await postgresService.queryOne<{ applied: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM migration WHERE name = @name) AS applied',
        { name: POSTGRES_FAVORITES_BACKFILL }
      );
      if (migration?.applied) return;

      const seeds: FavoriteSeed[] = [];

      // The SQLite table is retained during the staged cutover; transfer its
      // rows before PostgreSQL becomes the read source for favorites.
      if (legacySqliteDatabase.isEnabled()) {
        const rows = sqliteService.queryAll<{
          db_id: string;
          person_id: string;
          why_interesting: string | null;
          tags: string | null;
          added_at: string | null;
        }>('SELECT db_id, person_id, why_interesting, tags, added_at FROM favorite');
        for (const row of rows) {
          seeds.push({
            dbId: row.db_id,
            personId: row.person_id,
            whyInteresting: row.why_interesting ?? '',
            tags: favoriteTags(row.tags),
            addedAt: row.added_at ?? new Date().toISOString(),
          });
        }
      }

      // Favorites already have JSON backups. Import them too when a deployment
      // starts with PostgreSQL and no legacy SQLite database.
      if (fs.existsSync(FAVORITES_DIR)) {
        const dbDirs = fs.readdirSync(FAVORITES_DIR).filter(entry =>
          fs.statSync(path.join(FAVORITES_DIR, entry)).isDirectory()
        );
        for (const dbDir of dbDirs) {
          const dbId = await databaseService.resolveDbId(dbDir);
          if (!dbId) continue;
          const files = fs.readdirSync(path.join(FAVORITES_DIR, dbDir)).filter(file => file.endsWith('.json'));
          for (const file of files) {
            let favorite: FavoriteData;
            try {
              favorite = JSON.parse(fs.readFileSync(path.join(FAVORITES_DIR, dbDir, file), 'utf-8'));
            } catch {
              continue;
            }
            if (!favorite?.isFavorite) continue;
            const personId = await resolvePostgresPersonId(file.slice(0, -'.json'.length));
            if (!personId) continue;
            seeds.push({
              dbId,
              personId,
              whyInteresting: typeof favorite.whyInteresting === 'string' ? favorite.whyInteresting : '',
              tags: favoriteTags(favorite.tags),
              addedAt: favoriteAddedAt(favorite.addedAt),
            });
          }
        }
      }

      await postgresService.transaction(async tx => {
        for (const seed of seeds) {
          await tx.run(
            `INSERT INTO favorite (db_id, person_id, why_interesting, tags, added_at)
             SELECT @dbId, @personId, @why, @tags::jsonb, @addedAt
             WHERE EXISTS (SELECT 1 FROM person WHERE person_id = @personId)
             ON CONFLICT (db_id, person_id) DO NOTHING`,
            {
              dbId: seed.dbId,
              personId: seed.personId,
              why: seed.whyInteresting,
              tags: JSON.stringify(seed.tags),
              addedAt: seed.addedAt,
            }
          );
        }
        await tx.run(
          `INSERT INTO migration (name) VALUES (@name)
           ON CONFLICT (name) DO NOTHING`,
          { name: POSTGRES_FAVORITES_BACKFILL }
        );
      });
    })().catch(error => {
      postgresFavoriteSeed = undefined;
      throw error;
    });
  }

  await postgresFavoriteSeed;
}

async function resolvePostgresPersonId(personId: string): Promise<string | null> {
  const row = await postgresService.queryOne<{ person_id: string }>(
    `SELECT person_id FROM person WHERE person_id = @personId
     UNION ALL
     SELECT person_id FROM external_identity WHERE source = 'familysearch' AND external_id = @personId
     LIMIT 1`,
    { personId }
  );
  return row?.person_id ?? null;
}

export async function getDbFavoritePostgres(dbId: string, personId: string): Promise<FavoriteData | null> {
  await ensurePostgresFavoritesSeeded();
  const [internalDbId, canonicalPersonId] = await Promise.all([
    databaseService.resolveDbId(dbId),
    resolvePostgresPersonId(personId),
  ]);
  if (!internalDbId || !canonicalPersonId) return null;

  const row = await postgresService.queryOne<PostgresFavoriteRow>(
    `SELECT why_interesting, tags, added_at FROM favorite
     WHERE db_id = @dbId AND person_id = @personId`,
    { dbId: internalDbId, personId: canonicalPersonId }
  );
  return row ? mapPostgresFavorite(row) : null;
}

export async function setDbFavoritePostgres(
  dbId: string,
  personId: string,
  whyInteresting: string,
  tags: string[]
): Promise<FavoriteData> {
  await ensurePostgresFavoritesSeeded();
  const internalDbId = await databaseService.resolveDbId(dbId);
  if (!internalDbId) throw new Error(`Database ${dbId} not found`);

  const canonicalPersonId = await resolvePostgresPersonId(personId);
  if (!canonicalPersonId) throw new Error(`Person ${personId} not found`);

  const row = await postgresService.queryOne<PostgresFavoriteRow>(
    `INSERT INTO favorite (db_id, person_id, why_interesting, tags, added_at)
     VALUES (@dbId, @personId, @why, @tags::jsonb, @addedAt)
     ON CONFLICT (db_id, person_id) DO UPDATE SET
       why_interesting = EXCLUDED.why_interesting,
       tags = EXCLUDED.tags,
       added_at = EXCLUDED.added_at
     RETURNING why_interesting, tags, added_at`,
    {
      dbId: internalDbId,
      personId: canonicalPersonId,
      why: whyInteresting,
      tags: JSON.stringify(tags),
      addedAt: new Date().toISOString(),
    }
  );
  if (!row) throw new Error('Failed to set favorite');
  return mapPostgresFavorite(row);
}

export async function removeDbFavoritePostgres(dbId: string, personId: string): Promise<boolean> {
  await ensurePostgresFavoritesSeeded();
  const [internalDbId, canonicalPersonId] = await Promise.all([
    databaseService.resolveDbId(dbId),
    resolvePostgresPersonId(personId),
  ]);
  if (!internalDbId || !canonicalPersonId) return false;

  const result = await postgresService.run(
    'DELETE FROM favorite WHERE db_id = @dbId AND person_id = @personId',
    { dbId: internalDbId, personId: canonicalPersonId }
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listDbFavoritesPostgres(dbId: string, page: number, limit: number, photoResolver: PhotoUrlResolver): Promise<FavoritesList> {
  await ensurePostgresFavoritesSeeded();
  const internalDbId = await databaseService.resolveDbId(dbId);
  if (!internalDbId) {
    return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [...PRESET_TAGS] };
  }

  const count = await postgresService.queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM favorite WHERE db_id = @dbId',
    { dbId: internalDbId }
  );
  const total = Number(count?.count ?? 0);
  if (total === 0) return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [] };

  const tagRows = await postgresService.queryAll<{ tag: string }>(
    `SELECT DISTINCT tags.tag FROM favorite f
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tags(tag)
     WHERE f.db_id = @dbId`,
    { dbId: internalDbId }
  );
  const allTags = new Set<string>(PRESET_TAGS);
  tagRows.forEach(({ tag }) => allTags.add(tag));

  const rows = await postgresService.queryAll<PostgresFavoritePersonRow>(
    `SELECT f.person_id, f.why_interesting, f.tags, f.added_at, p.display_name,
            birth.date_original AS birth_date, death.date_original AS death_date,
            ei.external_id
     FROM favorite f
     JOIN person p ON f.person_id = p.person_id
     LEFT JOIN vital_event birth ON f.person_id = birth.person_id AND birth.event_type = 'birth'
     LEFT JOIN vital_event death ON f.person_id = death.person_id AND death.event_type = 'death'
     LEFT JOIN external_identity ei ON f.person_id = ei.person_id AND ei.source = 'familysearch'
     WHERE f.db_id = @dbId
     ORDER BY f.added_at DESC
     LIMIT @limit OFFSET @offset`,
    { dbId: internalDbId, limit, offset: (page - 1) * limit }
  );

  const favorites: FavoriteWithPerson[] = [];
  for (const row of rows) {
    const augmentation = await augmentationService.getAugmentation(row.person_id);
    favorites.push({
      personId: row.person_id,
      externalId: row.external_id ?? undefined,
      name: row.display_name,
      lifespan: buildLifespan(parseYear(row.birth_date), parseYear(row.death_date)),
      photoUrl: photoResolver(row.person_id, augmentation || undefined),
      favorite: mapPostgresFavorite(row),
      databases: [internalDbId],
    });
  }

  return { favorites, total, page, limit, totalPages: Math.ceil(total / limit), allTags: [...allTags].sort() };
}

export async function getDbTagsPostgres(dbId: string): Promise<string[]> {
  await ensurePostgresFavoritesSeeded();
  const internalDbId = await databaseService.resolveDbId(dbId);
  if (!internalDbId) return [...PRESET_TAGS];

  const rows = await postgresService.queryAll<{ tag: string }>(
    `SELECT DISTINCT tags.tag FROM favorite f
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tags(tag)
     WHERE f.db_id = @dbId`,
    { dbId: internalDbId }
  );
  return [...new Set([...PRESET_TAGS, ...rows.map(({ tag }) => tag)])].sort();
}

export async function listFavoritesPostgres(page: number, limit: number, photoResolver: PhotoUrlResolver): Promise<FavoritesList> {
  await ensurePostgresFavoritesSeeded();
  const count = await postgresService.queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT person_id)::int AS count FROM favorite'
  );
  const total = Number(count?.count ?? 0);
  if (total === 0) {
    return { favorites: [], total: 0, page, limit, totalPages: 0, allTags: [...PRESET_TAGS] };
  }

  const tagRows = await postgresService.queryAll<{ tag: string }>(
    `SELECT DISTINCT tags.tag FROM favorite f
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tags(tag)`
  );
  const allTags = new Set<string>(PRESET_TAGS);
  tagRows.forEach(({ tag }) => allTags.add(tag));

  const rows = await postgresService.queryAll<PostgresFavoritePersonRow>(
    `SELECT f.person_id, f.db_id, f.why_interesting, f.tags, f.added_at, p.display_name,
            birth.date_original AS birth_date, death.date_original AS death_date,
            ei.external_id
     FROM favorite f
     JOIN person p ON f.person_id = p.person_id
     LEFT JOIN vital_event birth ON f.person_id = birth.person_id AND birth.event_type = 'birth'
     LEFT JOIN vital_event death ON f.person_id = death.person_id AND death.event_type = 'death'
     LEFT JOIN external_identity ei ON f.person_id = ei.person_id AND ei.source = 'familysearch'
     ORDER BY f.added_at DESC
     LIMIT @limit OFFSET @offset`,
    { limit, offset: (page - 1) * limit }
  );

  const personMap = new Map<string, FavoriteWithPerson>();
  for (const row of rows) {
    const existing = personMap.get(row.person_id);
    if (existing) {
      if (row.db_id && !existing.databases.includes(row.db_id)) existing.databases.push(row.db_id);
      continue;
    }

    const augmentation = await augmentationService.getAugmentation(row.person_id);
    personMap.set(row.person_id, {
      personId: row.person_id,
      externalId: row.external_id ?? undefined,
      name: row.display_name,
      lifespan: buildLifespan(parseYear(row.birth_date), parseYear(row.death_date)),
      photoUrl: photoResolver(row.person_id, augmentation || undefined),
      favorite: mapPostgresFavorite(row),
      databases: row.db_id ? [row.db_id] : [],
    });
  }

  return {
    favorites: [...personMap.values()], total, page, limit,
    totalPages: Math.ceil(total / limit), allTags: [...allTags].sort(),
  };
}

export async function getFavoritesInDatabasePostgres(dbId: string): Promise<FavoriteWithPerson[]> {
  await ensurePostgresFavoritesSeeded();
  const internalDbId = await databaseService.resolveDbId(dbId);
  if (!internalDbId) return [];

  const rows = await postgresService.queryAll<PostgresFavoritePersonRow>(
    `SELECT f.person_id, f.why_interesting, f.tags, f.added_at, p.display_name,
            birth.date_original AS birth_date, death.date_original AS death_date,
            ei.external_id
     FROM favorite f
     JOIN person p ON f.person_id = p.person_id
     LEFT JOIN vital_event birth ON f.person_id = birth.person_id AND birth.event_type = 'birth'
     LEFT JOIN vital_event death ON f.person_id = death.person_id AND death.event_type = 'death'
     LEFT JOIN external_identity ei ON f.person_id = ei.person_id AND ei.source = 'familysearch'
     WHERE f.db_id = @dbId`,
    { dbId: internalDbId }
  );

  return rows.map(row => ({
    personId: row.person_id,
    externalId: row.external_id ?? undefined,
    name: row.display_name,
    lifespan: buildLifespan(parseYear(row.birth_date), parseYear(row.death_date)),
    photoUrl: undefined,
    favorite: mapPostgresFavorite(row),
    databases: [internalDbId],
  }));
}

export async function getAllTagsPostgres(): Promise<string[]> {
  await ensurePostgresFavoritesSeeded();
  const rows = await postgresService.queryAll<{ tag: string }>(
    `SELECT DISTINCT tags.tag FROM favorite f
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tags(tag)`
  );
  return [...new Set([...PRESET_TAGS, ...rows.map(({ tag }) => tag)])].sort();
}
