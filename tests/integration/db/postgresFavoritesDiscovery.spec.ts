import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresService, postgresService } from '../../../server/src/db/postgres.service.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';
import { databaseService } from '../../../server/src/services/database.service.js';
import { augmentationService, createAugmentationService } from '../../../server/src/services/augmentation.service.js';
import { favoritesService } from '../../../server/src/services/favorites.service.js';
import { aiDiscoveryService } from '../../../server/src/services/ai-discovery.service.js';

const fixture = vi.hoisted(() => ({ directory: '', active: false }));

vi.mock('../../../server/src/utils/paths.js', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  fixture.directory = path.join(os.tmpdir(), `sparsetree-favorites-discovery-${randomUUID()}`);
  return {
    DATA_DIR: fixture.directory,
    AUGMENT_DIR: path.join(fixture.directory, 'augment'),
    PHOTOS_DIR: path.join(fixture.directory, 'photos'),
    ensureDir: (directory: string) => { if (fixture.active) fs.mkdirSync(directory, { recursive: true }); },
    findLocalPhoto: () => null,
    localPhotoRoute: () => undefined,
  };
});
vi.mock('../../../server/src/services/scraper.service.js', () => ({ scraperService: { hasPhoto: () => false } }));
vi.mock('../../../server/src/services/ai-toolkit.service.js', () => ({ getAIToolkit: () => {
  throw new Error('Persistence tests must not invoke an AI provider');
} }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: {
  start: vi.fn(), done: vi.fn(), error: vi.fn(), warn: vi.fn(), data: vi.fn(),
  skip: vi.fn(), api: vi.fn(), ok: vi.fn(),
} }));

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const PERSON_A = '00000000000000000000000001';
const PERSON_B = '00000000000000000000000002';
const PERSON_C = '00000000000000000000000003';
const DB_A = 'family-one';
const DB_B = 'family-two';

describePostgres('PostgreSQL favorites and discovery parity', () => {
  const schema = `sparsetree_favorites_discovery_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let augment: ReturnType<typeof createAugmentationService>;

  beforeAll(async () => {
    admin = new Pool({ connectionString, connectionTimeoutMillis: 2000 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 2, connectionTimeoutMillis: 2000 });
    pool.on('error', () => {});
    store = createPostgresService({ pool });
    await store.initDb();
    await store.run('INSERT INTO migration (name) VALUES (@name) ON CONFLICT (name) DO NOTHING', {
      name: 'postgres_003_favorites_backfill',
    });
    fixture.active = true;
  });

  beforeEach(async () => {
    await store.run('TRUNCATE person, database_info CASCADE');
    await rm(fixture.directory, { recursive: true, force: true });
    await mkdir(fixture.directory, { recursive: true });
    for (const [id, externalId, name] of [
      [PERSON_A, 'FS-A', 'Ada Example'], [PERSON_B, 'FS-B', 'Bea Example'], [PERSON_C, 'FS-C', 'Cy Example'],
    ]) {
      await store.run('INSERT INTO person (person_id, display_name, living) VALUES (@id, @name, @living)', { id, name, living: id === PERSON_A });
      await store.run("INSERT INTO external_identity (person_id, source, external_id) VALUES (@id, 'familysearch', @externalId)", { id, externalId });
    }
    for (const [dbId, root] of [[DB_A, PERSON_A], [DB_B, PERSON_B]]) {
      await store.run('INSERT INTO database_info (db_id, root_id, person_count) VALUES (@dbId, @root, 3)', { dbId, root });
      for (const id of [PERSON_A, PERSON_B, PERSON_C]) {
        await store.run('INSERT INTO database_membership (db_id, person_id, is_root) VALUES (@dbId, @id, @isRoot)', {
          dbId, id, isRoot: id === root,
        });
      }
    }
    for (const key of ['queryAll', 'queryOne', 'run', 'transaction', 'isConfigured'] as const) {
      vi.spyOn(postgresService, key).mockImplementation(store[key] as never);
    }
    const reads = createPostgresDatabase(store);
    for (const key of ['resolveDbId', 'getDatabase', 'getPerson'] as const) {
      vi.spyOn(databaseService, key).mockImplementation(reads[key] as never);
    }
    vi.spyOn(databaseService, 'isPostgresEnabled').mockResolvedValue(true);
    augment = createAugmentationService(store, path.join(fixture.directory, 'augment'), async () => true);
    for (const key of ['getAugmentation', 'saveAugmentation', 'updateAugmentation'] as const) {
      vi.spyOn(augmentationService, key).mockImplementation(augment[key].bind(augment) as never);
    }
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    fixture.active = false;
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('upserts concurrent scoped favorites across aliases with native JSONB and empty/null parity', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => favoritesService.setDbFavorite(
      index % 2 ? DB_A : 'FS-A', index % 2 ? PERSON_C : 'FS-C', `Reason ${index}`, [`tag-${index}`],
    )));
    expect(results).toHaveLength(6);
    expect(results.every(result => result.isFavorite === true && typeof result.addedAt === 'string')).toBe(true);
    const persisted = await store.queryAll<{ why_interesting: string; tags: string[]; added_at: Date }>('SELECT why_interesting, tags, added_at FROM favorite');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].tags).toEqual([`tag-${persisted[0].why_interesting.split(' ')[1]}`]);
    expect(persisted[0].added_at).toBeInstanceOf(Date);

    expect(await favoritesService.setDbFavorite(DB_A, PERSON_C, '', [])).toMatchObject({ isFavorite: true, whyInteresting: '', tags: [] });
    expect(await store.queryOne('SELECT why_interesting, tags FROM favorite')).toEqual({ why_interesting: '', tags: [] });
    await store.run('UPDATE favorite SET why_interesting = NULL, tags = NULL');
    expect(await favoritesService.getDbFavorite('FS-A', 'FS-C')).toMatchObject({ isFavorite: true, whyInteresting: '', tags: [] });
    expect(await favoritesService.getDbFavorite(DB_B, PERSON_C)).toBeNull();
    expect(await favoritesService.updateDbFavorite(DB_B, PERSON_C, 'Missing')).toBeNull();
  });

  it('upserts one global favorite per canonical person and preserves concurrent enrichment', async () => {
    await Promise.all(Array.from({ length: 4 }, (_, index) => favoritesService.setFavorite(
      index % 2 ? PERSON_C : 'FS-C', `Global ${index}`, [`global-${index}`],
    )));
    expect(await store.queryOne('SELECT COUNT(*)::int AS count FROM person_augmentation')).toEqual({ count: 1 });
    expect(await favoritesService.getFavorite(PERSON_C)).toMatchObject({ isFavorite: true, tags: expect.any(Array) });

    await Promise.all([
      favoritesService.setFavorite(PERSON_C, '', []),
      augment.addPlatform(PERSON_C, 'wikipedia', 'https://example.test/person', undefined, { registerIdentity: false }),
    ]);
    const combined = await augment.getAugmentation(PERSON_C);
    expect(combined).toMatchObject({ favorite: { isFavorite: true, whyInteresting: '', tags: [] },
      platforms: [{ platform: 'wikipedia', url: 'https://example.test/person' }],
    });

    await Promise.all([
      favoritesService.updateFavorite('FS-C', 'Updated', []),
      augment.addDescription(PERSON_C, '', 'local', 'en'),
    ]);
    expect(await augment.getAugmentation(PERSON_C)).toMatchObject({
      favorite: { whyInteresting: 'Updated', tags: [] }, descriptions: [{ text: '', source: 'local' }],
    });
    await Promise.all([
      favoritesService.removeFavorite(PERSON_C),
      augment.addPhoto('FS-C', 'https://example.test/photo', 'local', false),
    ]);
    expect(await favoritesService.getFavorite('FS-C')).toBeNull();
    expect(await augment.getAugmentation(PERSON_C)).toMatchObject({
      platforms: [{ platform: 'wikipedia' }], descriptions: [{ text: '' }], photos: [{ isPrimary: false }],
    });
    expect(await favoritesService.updateFavorite(PERSON_C, 'Missing')).toBeNull();
    expect(await favoritesService.removeFavorite('missing')).toBeNull();
  });

  it('paginates distinct people while including every database and one provider display row', async () => {
    for (const [dbId, personId, explanation] of [
      [DB_A, PERSON_A, 'Older Ada'], [DB_B, PERSON_A, 'Latest Ada'],
      [DB_A, PERSON_B, 'Bea'], [DB_A, PERSON_C, 'Cy'],
    ]) await favoritesService.setDbFavorite(dbId, personId, explanation, [explanation]);
    await store.run(`UPDATE favorite SET added_at = CASE
      WHEN db_id = @dbB THEN '2026-09-27T04:00:00Z'::timestamptz
      WHEN person_id = @personB THEN '2026-09-27T03:00:00Z'::timestamptz
      WHEN person_id = @personC THEN '2026-09-27T02:00:00Z'::timestamptz
      ELSE '2026-09-27T01:00:00Z'::timestamptz END`, { dbB: DB_B, personB: PERSON_B, personC: PERSON_C });
    await store.run(`INSERT INTO vital_event (person_id, event_type, source, date_original, confidence) VALUES
      (@personA, 'birth', 'familysearch', '1815', 1), (@personA, 'birth', 'other', '1814', 0.5),
      (@personA, 'death', 'familysearch', '1852', 1), (@personA, 'death', 'other', '1851', 0.5)`, { personA: PERSON_A });
    await store.run("INSERT INTO external_identity (person_id, source, external_id, confidence) VALUES (@personA, 'familysearch', 'FS-A-ALT', 0.5)", { personA: PERSON_A });

    const first = await favoritesService.listFavorites(1, 2);
    const second = await favoritesService.listFavorites(2, 2);
    expect(first).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
    expect(first.favorites.map(favorite => favorite.personId)).toEqual([PERSON_A, PERSON_B]);
    expect(first.favorites[0]).toMatchObject({ externalId: 'FS-A', lifespan: '1815-1852',
      favorite: { whyInteresting: 'Latest Ada', addedAt: '2026-09-27T04:00:00.000Z' }, databases: [DB_B, DB_A],
    });
    expect(first.allTags).toEqual(expect.arrayContaining(['Older Ada', 'Latest Ada', 'Bea', 'Cy']));
    expect(second.favorites.map(favorite => favorite.personId)).toEqual([PERSON_C]);
    const scoped = await favoritesService.listDbFavorites('FS-A', 2, 2);
    expect(scoped).toMatchObject({ total: 3, totalPages: 2, favorites: [{ personId: PERSON_A }] });
    expect(await favoritesService.getFavoritesInDatabase(DB_A)).toHaveLength(3);
    expect(await favoritesService.getDbTags(DB_B)).toContain('Latest Ada');
  });

  it('upserts concurrent dismissals and preserves null, empty, count and timestamp shapes', async () => {
    expect(await Promise.all(Array.from({ length: 6 }, (_, index) => aiDiscoveryService.dismissCandidate(
      index % 2 ? DB_A : 'FS-A', index % 2 ? PERSON_C : 'FS-C', `Reason ${index}`, [`tag-${index}`],
    )))).toEqual(Array.from({ length: 6 }, () => ({ success: true })));
    expect(await aiDiscoveryService.getDismissedCount(DB_A)).toBe(1);
    const [dismissed] = await aiDiscoveryService.getDismissedCandidates('FS-A');
    expect(dismissed.personId).toBe(PERSON_C);
    expect(dismissed.aiTags).toEqual([`tag-${dismissed.aiReason?.split(' ')[1]}`]);
    expect(dismissed.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    await aiDiscoveryService.dismissCandidate(DB_A, PERSON_C, '', []);
    expect(await store.queryOne('SELECT ai_reason, ai_tags FROM discovery_dismissed')).toEqual({ ai_reason: null, ai_tags: [] });
    await aiDiscoveryService.dismissCandidate(DB_A, PERSON_C);
    expect(await store.queryOne('SELECT ai_reason, ai_tags FROM discovery_dismissed')).toEqual({ ai_reason: null, ai_tags: null });
    await store.run("UPDATE discovery_dismissed SET ai_reason = ''");
    expect(await aiDiscoveryService.getDismissedCandidates(DB_A)).toEqual([
      expect.objectContaining({ aiReason: '', aiTags: [] }),
    ]);
  });

  it('runs concurrent batches on their own connections and rolls back every write in a failed batch', async () => {
    const candidates = [{ personId: PERSON_A, whyInteresting: 'Original', suggestedTags: ['keep'] }, { personId: PERSON_B }];
    expect(await Promise.all([
      aiDiscoveryService.dismissCandidatesBatch(DB_A, candidates),
      aiDiscoveryService.dismissCandidatesBatch('FS-A', candidates),
    ])).toEqual([{ dismissed: 2 }, { dismissed: 2 }]);
    expect(await aiDiscoveryService.getDismissedCount(DB_A)).toBe(2);

    await expect(aiDiscoveryService.dismissCandidatesBatch(DB_A, [
      { personId: PERSON_A, whyInteresting: 'Must roll back', suggestedTags: [] },
      { personId: PERSON_C, whyInteresting: 'Must disappear' },
      { personId: 'missing' },
    ])).rejects.toThrow('Person missing not found');
    expect(await aiDiscoveryService.getDismissedCount(DB_A)).toBe(2);
    expect(await store.queryOne('SELECT ai_reason, ai_tags FROM discovery_dismissed WHERE person_id = @id', { id: PERSON_A }))
      .toEqual({ ai_reason: 'Original', ai_tags: ['keep'] });
    expect(await store.queryOne('SELECT person_id FROM discovery_dismissed WHERE person_id = @id', { id: PERSON_C })).toBeUndefined();
  });

  it('reports committed deletion counts, keeps undo idempotent and cascades person deletion', async () => {
    await favoritesService.setDbFavorite(DB_A, PERSON_C, 'Remove me');
    expect(await favoritesService.removeDbFavorite(DB_A, PERSON_C)).toBe(true);
    expect(await favoritesService.removeDbFavorite(DB_A, PERSON_C)).toBe(false);
    await aiDiscoveryService.dismissCandidatesBatch(DB_A, [{ personId: PERSON_A }, { personId: PERSON_C }]);
    expect(await aiDiscoveryService.undoDismiss('FS-A', 'FS-C')).toEqual({ success: true });
    expect(await aiDiscoveryService.undoDismiss('FS-A', 'FS-C')).toEqual({ success: true });
    expect(await aiDiscoveryService.clearDismissed(DB_A)).toEqual({ cleared: 1 });
    expect(await aiDiscoveryService.clearDismissed(DB_A)).toEqual({ cleared: 0 });

    await favoritesService.setDbFavorite(DB_A, PERSON_C, 'First family');
    await favoritesService.setDbFavorite(DB_B, PERSON_C, 'Second family');
    await favoritesService.setFavorite(PERSON_C, 'Global');
    await aiDiscoveryService.dismissCandidate(DB_A, PERSON_C);
    expect((await store.run('DELETE FROM person WHERE person_id = @id', { id: PERSON_C })).rowCount).toBe(1);
    for (const table of ['favorite', 'discovery_dismissed', 'person_augmentation']) {
      expect(await store.queryOne(`SELECT COUNT(*)::int AS count FROM ${table} WHERE person_id = @id`, { id: PERSON_C })).toEqual({ count: 0 });
    }
    expect(await favoritesService.listFavorites()).toMatchObject({ total: 0, favorites: [] });
    expect(await aiDiscoveryService.getDismissedCount(DB_A)).toBe(0);
  });
});
