import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { createBlobService } from '../../../server/src/services/blob.service.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL blob and media storage', () => {
  const schema = `sparsetree_blobs_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let service: ReturnType<typeof createBlobService>;
  let directory: string;
  let photosDir: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2000 });
    pool.on('error', () => {});
    store = createPostgresService({ pool });
    await store.initDb();
    directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-blobs-'));
    photosDir = path.join(directory, 'photos');
    await mkdir(photosDir);
    service = createBlobService({ store, dataDir: directory, photosDir });
  });

  beforeEach(async () => {
    await store.run('DROP TRIGGER IF EXISTS reject_blob_delete ON blob');
    await store.run('TRUNCATE person, blob CASCADE');
    await store.run("INSERT INTO person (person_id, display_name) VALUES ('person-1', 'First person'), ('person-2', 'Second person')");
    await rm(service.BLOBS_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('deduplicates concurrent storage and retains original metadata with numeric sizes', async () => {
    const buffer = Buffer.from('shared image contents');
    const stored = await Promise.all(Array.from({ length: 6 }, () => service.storeBlob(buffer, {
      mimeType: 'image/jpeg', width: 120, height: 90,
    })));
    const blob = stored[0];
    expect(stored.filter(result => result.isNew)).toHaveLength(1);
    expect(new Set(stored.map(result => result.path)).size).toBe(1);
    expect(blob.path).toBe(path.join('blobs', blob.hash.slice(0, 2), `${blob.hash}.jpg`));
    expect(await service.storeBlob(buffer, { mimeType: 'image/png', width: 300 })).toEqual({
      hash: blob.hash, path: blob.path, mimeType: 'image/jpeg', sizeBytes: buffer.length, isNew: false,
    });
    expect(await service.getBlob(blob.hash)).toEqual({
      hash: blob.hash, path: blob.path, mimeType: 'image/jpeg', sizeBytes: buffer.length, width: 120, height: 90,
    });
    expect(await service.getBlobBuffer(blob.hash)).toEqual(buffer);
    const stream = await service.getBlobStream(blob.hash);
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(buffer);
    expect(await service.blobExists(blob.hash)).toBe(true);
    expect(await service.getStorageStats()).toEqual({ blobCount: 1, totalSize: buffer.length, mediaCount: 0 });
  });

  it('returns null for absent records and files without confusing metadata existence', async () => {
    expect(await service.getBlob('missing')).toBeNull();
    expect(await service.getBlobBuffer('missing')).toBeNull();
    expect(await service.getBlobStream('missing')).toBeNull();
    expect(await service.blobExists('missing')).toBe(false);
    expect(await service.getPrimaryPhoto('person-1')).toBeNull();
    expect(await service.getStorageStats()).toEqual({ blobCount: 0, totalSize: 0, mediaCount: 0 });
    const blob = await service.storeBlob(Buffer.from('document'));
    await rm(path.join(directory, blob.path));
    expect(await service.blobExists(blob.hash)).toBe(true);
    expect(await service.getBlobBuffer(blob.hash)).toBeNull();
    expect(await service.getBlobStream(blob.hash)).toBeNull();
  });

  it('serializes concurrent primary selection and preserves booleans and optional fields', async () => {
    const buffer = Buffer.from('portrait');
    const blob = await service.storeBlob(buffer, { mimeType: 'image/png' });
    const fallback = await service.createMedia('person-1', blob.hash, 'local');
    expect(await service.getPrimaryPhoto('person-1')).toMatchObject({ mediaId: fallback, source: 'local' });
    const primaries = await Promise.all(['familysearch', 'wikipedia', 'ancestry'].map(source =>
      service.createMedia('person-1', blob.hash, source, { isPrimary: true, caption: source, sourceUrl: `https://example.test/${source}` }),
    ));
    const otherPerson = await service.createMedia('person-2', blob.hash, 'local', { isPrimary: true });
    const media = await service.getMediaForPerson('person-1');
    expect(media.filter(item => item.isPrimary)).toHaveLength(1);
    expect(primaries).toContain(media[0].mediaId);
    expect(media[0].isPrimary).toBe(true);
    expect(media.find(item => item.mediaId === fallback)).toEqual({
      mediaId: fallback, blobHash: blob.hash, source: 'local', sourceUrl: undefined,
      isPrimary: false, caption: undefined, path: blob.path, mimeType: 'image/png',
    });
    expect(await service.getPrimaryPhoto('person-1')).toMatchObject({ mediaId: media[0].mediaId });
    expect(await service.setPrimaryMedia('person-1', fallback)).toBe(true);
    expect(await service.getPrimaryPhoto('person-1')).toMatchObject({ mediaId: fallback });
    expect(await service.getPrimaryPhoto('person-2')).toMatchObject({ mediaId: otherPerson });
    expect(await service.setPrimaryMedia('missing-person', fallback)).toBe(false);
    expect(await service.getStorageStats()).toEqual({ blobCount: 1, totalSize: buffer.length, mediaCount: 5 });
  });

  it('upserts identical concurrent media without losing omitted metadata or duplicating rows', async () => {
    const blob = await service.storeBlob(Buffer.from('same portrait'));
    const ids = await Promise.all(Array.from({ length: 6 }, () => service.createMedia('person-1', blob.hash, 'local', {
      caption: 'Original caption', sourceUrl: 'https://example.test/original',
    })));
    expect(new Set(ids).size).toBe(1);
    expect(await service.getMediaForPerson('person-1')).toHaveLength(1);
    const another = await service.createMedia('person-1', blob.hash, 'familysearch', { isPrimary: true });
    expect(await service.createMedia('person-1', blob.hash, 'local', {
      sourceUrl: 'https://example.test/updated', isPrimary: true,
    })).toBe(ids[0]);
    await service.createMedia('person-1', blob.hash, 'local');
    expect(await service.getMediaForPerson('person-1')).toEqual([
      expect.objectContaining({ mediaId: ids[0], caption: 'Original caption', sourceUrl: 'https://example.test/updated', isPrimary: true }),
      expect.objectContaining({ mediaId: another, isPrimary: false }),
    ]);
    await service.createMedia('person-1', blob.hash, 'local', { caption: 'Edited caption', isPrimary: false });
    expect(await service.getMediaForPerson('person-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaId: ids[0], caption: 'Edited caption', sourceUrl: 'https://example.test/updated', isPrimary: false }),
    ]));
  });

  it('rolls back clearing the old primary when a new primary cannot be inserted', async () => {
    const blob = await service.storeBlob(Buffer.from('portrait'));
    const original = await service.createMedia('person-1', blob.hash, 'local', { isPrimary: true });
    await expect(service.createMedia('person-1', 'missing-blob', 'local', { isPrimary: true })).rejects.toMatchObject({ code: '23503' });
    expect(await service.getMediaForPerson('person-1')).toEqual([
      expect.objectContaining({ mediaId: original, isPrimary: true }),
    ]);
  });

  it('keeps referenced blobs, then deletes unreferenced metadata and files', async () => {
    const blob = await service.storeBlob(Buffer.from('portrait'));
    const media = await service.createMedia('person-1', blob.hash, 'local');
    expect(await service.deleteBlob(blob.hash)).toBe(false);
    expect(await service.getBlobBuffer(blob.hash)).toEqual(Buffer.from('portrait'));
    expect(await service.deleteMedia(media)).toBe(true);
    expect(await service.deleteMedia(media)).toBe(false);
    expect(await service.deleteBlob(blob.hash)).toBe(true);
    expect(await service.deleteBlob(blob.hash)).toBe(false);
    expect(await service.getBlob(blob.hash)).toBeNull();
    await expect(readFile(path.join(directory, blob.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores a blob file if PostgreSQL rejects deletion at commit', async () => {
    const buffer = Buffer.from('must survive rollback');
    const blob = await service.storeBlob(buffer);
    await store.run(`
      CREATE OR REPLACE FUNCTION reject_blob_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test delete rejected'; END;
      $$;
      CREATE CONSTRAINT TRIGGER reject_blob_delete AFTER DELETE ON blob
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_blob_delete();
    `);
    await expect(service.deleteBlob(blob.hash)).rejects.toThrow('test delete rejected');
    expect(await service.getBlobBuffer(blob.hash)).toEqual(buffer);
    expect(await readdir(path.dirname(path.join(directory, blob.path)))).toEqual([path.basename(blob.path)]);
  });

  it('does not unlink a concurrent reupload after deleting the old metadata', async () => {
    const buffer = Buffer.from('concurrent reupload');
    const blob = await service.storeBlob(buffer, { mimeType: 'image/jpeg' });
    await Promise.all([service.deleteBlob(blob.hash), service.storeBlob(buffer, { mimeType: 'image/jpeg' })]);
    if (await service.blobExists(blob.hash)) {
      expect(await service.getBlobBuffer(blob.hash)).toEqual(buffer);
    } else {
      expect(await service.getBlobBuffer(blob.hash)).toBeNull();
    }
  });

  it('migrates a legacy photo with inferred MIME type while preserving its original file', async () => {
    const buffer = Buffer.from('legacy photo');
    const photoPath = path.join(photosDir, 'person-1.PNG');
    await writeFile(photoPath, buffer);
    expect(await service.migrateLegacyPhoto('person-1', 'absent.jpg', 'local')).toBeNull();
    const mediaId = await service.migrateLegacyPhoto('person-1', path.basename(photoPath), 'familysearch');
    expect(await service.getPrimaryPhoto('person-1')).toMatchObject({ mediaId, source: 'familysearch', mimeType: 'image/png' });
    expect(await service.getMediaForPerson('person-1')).toEqual([expect.objectContaining({ mediaId, isPrimary: true })]);
    expect(await readFile(photoPath)).toEqual(buffer);
  });
});
