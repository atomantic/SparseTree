import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
  transactionRun: vi.fn(),
  sqliteQueryAll: vi.fn(),
  sqliteEnabled: vi.fn(),
  isPostgresEnabled: vi.fn(),
  resolveDbId: vi.fn(),
  getAugmentation: vi.fn(),
}));

vi.mock('../../../server/src/db/postgres.service.js', () => ({
  postgresService: {
    queryOne: mocks.queryOne,
    queryAll: mocks.queryAll,
    run: mocks.run,
    transaction: mocks.transaction,
  },
}));
vi.mock('../../../server/src/services/database.service.js', () => ({
  databaseService: {
    isPostgresEnabled: mocks.isPostgresEnabled,
    resolveDbId: mocks.resolveDbId,
  },
}));
vi.mock('../../../server/src/services/legacy-sqlite-database.js', () => ({
  legacySqliteDatabase: { isEnabled: mocks.sqliteEnabled, resolveDbId: vi.fn() },
}));
vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: { queryAll: mocks.sqliteQueryAll },
}));
vi.mock('../../../server/src/services/legacy-id-mapping.service.js', () => ({
  legacyIdMappingService: { resolveId: vi.fn() },
}));
vi.mock('../../../server/src/services/augmentation.service.js', () => ({
  augmentationService: { getAugmentation: mocks.getAugmentation, saveAugmentation: vi.fn() },
}));
vi.mock('../../../server/src/utils/paths.js', () => ({
  DATA_DIR: '/tmp/sparsetree-favorites-spec',
  AUGMENT_DIR: '/tmp/sparsetree-favorites-spec/augment',
  PHOTOS_DIR: '/tmp/sparsetree-favorites-spec/photos',
  ensureDir: vi.fn(),
  findLocalPhoto: vi.fn(() => undefined),
  localPhotoRoute: vi.fn(() => undefined),
}));

import { favoritesService } from '../../../server/src/services/favorites.service.js';

describe('PostgreSQL-backed database favorites', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isPostgresEnabled.mockResolvedValue(true);
    mocks.resolveDbId.mockResolvedValue('db-canonical');
    mocks.getAugmentation.mockResolvedValue(null);
    mocks.sqliteEnabled.mockReturnValue(false);
    mocks.sqliteQueryAll.mockReturnValue([]);
    mocks.transaction.mockImplementation(async (work: (tx: { run: typeof mocks.transactionRun }) => Promise<void>) =>
      work({ run: mocks.transactionRun })
    );
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT person_id FROM person')) return { person_id: 'person-canonical' };
      if (sql.includes('INSERT INTO favorite')) {
        return {
          why_interesting: 'Interesting person',
          tags: ['artist'],
          added_at: new Date('2026-09-27T08:00:00.000Z'),
        };
      }
      if (sql.includes('SELECT why_interesting, tags, added_at FROM favorite')) {
        return {
          why_interesting: 'Interesting person',
          tags: ['artist'],
          added_at: new Date('2026-09-27T08:00:00.000Z'),
        };
      }
      if (sql.includes('COUNT')) return { count: 1 };
      return undefined;
    });
    mocks.queryAll.mockResolvedValue([]);
    mocks.run.mockResolvedValue({ rowCount: 1 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('imports existing SQLite favorites idempotently before serving PostgreSQL reads', async () => {
    mocks.sqliteEnabled.mockReturnValue(true);
    mocks.sqliteQueryAll.mockReturnValue([{
      db_id: 'db-canonical',
      person_id: 'person-canonical',
      why_interesting: 'Legacy favorite',
      tags: '["ancestor"]',
      added_at: '2026-09-26T08:00:00.000Z',
    }]);

    await favoritesService.getDbFavorite('db-alias', 'FS-PERSON');

    expect(mocks.sqliteQueryAll).toHaveBeenCalledWith(
      'SELECT db_id, person_id, why_interesting, tags, added_at FROM favorite',
    );
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (db_id, person_id) DO NOTHING'),
      expect.objectContaining({
        dbId: 'db-canonical',
        personId: 'person-canonical',
        tags: '["ancestor"]',
        addedAt: '2026-09-26T08:00:00.000Z',
      }),
    );
    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO migration'),
      { name: 'postgres_003_favorites_backfill' },
    );
  });

  it('resolves database and FamilySearch identifiers when reading a favorite', async () => {
    const result = await favoritesService.getDbFavorite('db-alias', 'FS-PERSON');

    expect(result).toEqual({
      isFavorite: true,
      whyInteresting: 'Interesting person',
      tags: ['artist'],
      addedAt: '2026-09-27T08:00:00.000Z',
    });
    expect(mocks.resolveDbId).toHaveBeenCalledWith('db-alias');
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM external_identity'), { personId: 'FS-PERSON' });
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM favorite'), {
      dbId: 'db-canonical',
      personId: 'person-canonical',
    });
  });

  it('upserts JSONB tags and keeps the JSON backup on successful writes', async () => {
    const writeBackup = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    const result = await favoritesService.setDbFavorite('db-alias', 'FS-PERSON', 'Interesting person', ['artist']);

    expect(result.tags).toEqual(['artist']);
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (db_id, person_id) DO UPDATE'),
      expect.objectContaining({
        dbId: 'db-canonical',
        personId: 'person-canonical',
        tags: '["artist"]',
      }),
    );
    expect(writeBackup).toHaveBeenCalledOnce();
  });

  it('lists persisted favorites with tags and person fields from PostgreSQL', async () => {
    mocks.queryAll.mockImplementation(async (sql: string) => {
      if (sql.includes('jsonb_array_elements_text')) return [{ tag: 'artist' }, { tag: 'writer' }];
      if (sql.includes('FROM favorite f')) {
        return [{
          person_id: 'person-canonical',
          db_id: 'db-canonical',
          why_interesting: 'Interesting person',
          tags: ['artist'],
          added_at: new Date('2026-09-27T08:00:00.000Z'),
          display_name: 'Ada Example',
          birth_date: '1815',
          death_date: '1852',
          external_id: 'FS-PERSON',
        }];
      }
      return [];
    });

    const result = await favoritesService.listDbFavorites('db-alias', 1, 20);

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      allTags: expect.arrayContaining(['artist', 'writer']),
      favorites: [{
        personId: 'person-canonical',
        externalId: 'FS-PERSON',
        name: 'Ada Example',
        favorite: { tags: ['artist'], whyInteresting: 'Interesting person' },
        databases: ['db-canonical'],
      }],
    });
  });

  it('deletes a favorite using PostgreSQL row counts', async () => {
    await expect(favoritesService.removeDbFavorite('db-alias', 'FS-PERSON')).resolves.toBe(true);
    expect(mocks.run).toHaveBeenCalledWith(
      'DELETE FROM favorite WHERE db_id = @dbId AND person_id = @personId',
      { dbId: 'db-canonical', personId: 'person-canonical' },
    );
  });
});
