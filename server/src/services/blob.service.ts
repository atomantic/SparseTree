/** Content-addressed storage for media files, with PostgreSQL metadata. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { postgresService } from '../db/postgres.service.js';
import { DATA_DIR, PHOTOS_DIR, ensureDir } from '../utils/paths.js';

type Store = typeof postgresService;
type Transaction = Parameters<Parameters<Store['transaction']>[0]>[0];
interface BlobOptions { mimeType?: string; width?: number; height?: number }
interface StoredBlob { hash: string; path: string; mimeType: string; sizeBytes: number; isNew: boolean }
interface BlobInfo { hash: string; path: string; mimeType: string; sizeBytes: number; width?: number; height?: number }
interface BlobRow {
  blob_hash: string; path: string; mime_type: string; size_bytes: number | string;
  width: number | null; height: number | null;
}

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};
const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf',
};

function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function createBlobService(options: { store?: Store; dataDir?: string; photosDir?: string } = {}) {
  const store = options.store ?? postgresService;
  const dataDir = options.dataDir ?? DATA_DIR;
  const photosDir = options.photosDir ?? PHOTOS_DIR;
  const blobsDir = path.join(dataDir, 'blobs');

  // Include absent blobs in the lock so concurrent stores/deletes cannot race
  // filesystem operations for the same content hash.
  const lockBlob = (tx: Transaction, hash: string) => tx.run(
    'SELECT pg_advisory_xact_lock(hashtextextended(@key, 0))', { key: `blob:${hash}` },
  );

  const storeBlob = async (buffer: Buffer, blobOptions?: BlobOptions): Promise<StoredBlob> => {
    const hash = computeHash(buffer);
    return store.transaction(async tx => {
      await lockBlob(tx, hash);
      const existing = await tx.queryOne<BlobRow>('SELECT * FROM blob WHERE blob_hash = @hash', { hash });
      if (existing) {
        return { hash, path: existing.path, mimeType: existing.mime_type, sizeBytes: buffer.length, isNew: false };
      }

      const mimeType = blobOptions?.mimeType ?? 'application/octet-stream';
      const ext = EXT_FROM_MIME[mimeType] ?? '.bin';
      const blobPath = path.join(blobsDir, hash.substring(0, 2), `${hash}${ext}`);
      const relativePath = path.relative(dataDir, blobPath);
      const inserted = await tx.run(
        `INSERT INTO blob (blob_hash, path, mime_type, size_bytes, width, height)
         VALUES (@hash, @path, @mimeType, @sizeBytes, @width, @height)
         ON CONFLICT (blob_hash) DO NOTHING`,
        { hash, path: relativePath, mimeType, sizeBytes: buffer.length,
          width: blobOptions?.width ?? null, height: blobOptions?.height ?? null },
      );
      // Preserve the original metadata if another importer inserted the hash.
      if (!inserted.rowCount) {
        const duplicate = await tx.queryOne<BlobRow>('SELECT * FROM blob WHERE blob_hash = @hash', { hash });
        if (!duplicate) throw new Error('Blob disappeared during storage');
        return { hash, path: duplicate.path, mimeType: duplicate.mime_type, sizeBytes: buffer.length, isNew: false };
      }
      ensureDir(path.dirname(blobPath));
      fs.writeFileSync(blobPath, buffer);
      return { hash, path: relativePath, mimeType, sizeBytes: buffer.length, isNew: true };
    });
  };

  const storeBlobFromFile = async (filePath: string, blobOptions?: BlobOptions): Promise<StoredBlob> => {
    const mimeType = blobOptions?.mimeType ?? MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return storeBlob(fs.readFileSync(filePath), { ...blobOptions, mimeType });
  };

  const getBlob = async (hash: string): Promise<BlobInfo | null> => {
    const blob = await store.queryOne<BlobRow>('SELECT * FROM blob WHERE blob_hash = @hash', { hash });
    if (!blob) return null;
    return { hash: blob.blob_hash, path: blob.path, mimeType: blob.mime_type,
      sizeBytes: Number(blob.size_bytes), width: blob.width ?? undefined, height: blob.height ?? undefined };
  };

  const getBlobBuffer = async (hash: string): Promise<Buffer | null> => {
    const blob = await getBlob(hash);
    if (!blob) return null;
    const fullPath = path.join(dataDir, blob.path);
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null;
  };

  const getBlobStream = async (hash: string): Promise<fs.ReadStream | null> => {
    const blob = await getBlob(hash);
    if (!blob) return null;
    const fullPath = path.join(dataDir, blob.path);
    return fs.existsSync(fullPath) ? fs.createReadStream(fullPath) : null;
  };

  const blobExists = async (hash: string): Promise<boolean> => Boolean(await store.queryOne(
    'SELECT blob_hash FROM blob WHERE blob_hash = @hash', { hash },
  ));

  const deleteBlob = async (hash: string): Promise<boolean> => {
    let movedFile: { original: string; pending: string } | undefined;
    const deleted = await store.transaction(async tx => {
      await lockBlob(tx, hash);
      // A row lock also excludes foreign-key inserts from other importers while
      // the reference check and removal are in progress.
      const blob = await tx.queryOne<BlobRow>('SELECT * FROM blob WHERE blob_hash = @hash FOR UPDATE', { hash });
      if (!blob) return false;
      const refs = await tx.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM media WHERE blob_hash = @hash', { hash });
      if (Number(refs?.count ?? 0) > 0) return false;
      const fullPath = path.join(dataDir, blob.path);
      if (fs.existsSync(fullPath)) {
        const pending = `${fullPath}.delete-${crypto.randomUUID()}`;
        fs.renameSync(fullPath, pending);
        movedFile = { original: fullPath, pending };
      }
      await tx.run('DELETE FROM blob WHERE blob_hash = @hash', { hash });
      return true;
    }).catch(error => {
      // A failed transaction must not leave a committed blob without its file.
      if (movedFile) fs.renameSync(movedFile.pending, movedFile.original);
      throw error;
    });
    // The unique pending path cannot delete a new upload after the lock releases.
    if (movedFile) fs.unlinkSync(movedFile.pending);
    return deleted;
  };

  const createMedia = async (
    personId: string, blobHash: string, source: string,
    mediaOptions?: { sourceUrl?: string; isPrimary?: boolean; caption?: string },
  ): Promise<string> => store.transaction(async tx => {
    // Serialize the absent-row case without blocking foreign-key key-share locks.
    await tx.queryOne('SELECT person_id FROM person WHERE person_id = @personId FOR NO KEY UPDATE', { personId });
    const existing = await tx.queryOne<{ media_id: string }>(
      `SELECT media_id FROM media WHERE person_id = @personId AND blob_hash = @blobHash AND source = @source
       ORDER BY created_at, media_id LIMIT 1`, { personId, blobHash, source },
    );
    const mediaId = existing?.media_id ?? ulid();
    if (mediaOptions?.isPrimary) {
      await tx.run('UPDATE media SET is_primary = FALSE WHERE person_id = @personId AND media_id != @mediaId', { personId, mediaId });
    }
    const params = { mediaId, personId, blobHash, source, sourceUrl: mediaOptions?.sourceUrl ?? null,
      isPrimary: mediaOptions?.isPrimary ?? false, caption: mediaOptions?.caption ?? null };
    if (existing) {
      await tx.run(
        `UPDATE media SET source_url = CASE WHEN @updateUrl THEN @sourceUrl ELSE source_url END,
          caption = CASE WHEN @updateCaption THEN @caption ELSE caption END,
          is_primary = CASE WHEN @updatePrimary THEN @isPrimary ELSE is_primary END
         WHERE media_id = @mediaId`,
        { ...params, updateUrl: mediaOptions?.sourceUrl !== undefined,
          updateCaption: mediaOptions?.caption !== undefined, updatePrimary: mediaOptions?.isPrimary !== undefined },
      );
    } else {
      await tx.run(
        `INSERT INTO media (media_id, person_id, blob_hash, source, source_url, is_primary, caption)
         VALUES (@mediaId, @personId, @blobHash, @source, @sourceUrl, @isPrimary, @caption)`, params,
      );
    }
    return mediaId;
  });

  const getMediaForPerson = async (personId: string): Promise<Array<{
    mediaId: string; blobHash: string; source: string; sourceUrl?: string;
    isPrimary: boolean; caption?: string; path: string; mimeType: string;
  }>> => {
    const rows = await store.queryAll<{
      media_id: string; blob_hash: string; source: string; source_url: string | null;
      is_primary: boolean; caption: string | null; path: string; mime_type: string;
    }>(
      `SELECT m.*, b.path, b.mime_type FROM media m JOIN blob b ON m.blob_hash = b.blob_hash
       WHERE m.person_id = @personId ORDER BY m.is_primary DESC, m.created_at, m.media_id`, { personId },
    );
    return rows.map(row => ({ mediaId: row.media_id, blobHash: row.blob_hash, source: row.source,
      sourceUrl: row.source_url ?? undefined, isPrimary: row.is_primary, caption: row.caption ?? undefined,
      path: row.path, mimeType: row.mime_type }));
  };

  const getPrimaryPhoto = async (personId: string): Promise<{
    mediaId: string; blobHash: string; path: string; mimeType: string; source: string;
  } | null> => {
    const result = await store.queryOne<{
      media_id: string; blob_hash: string; path: string; mime_type: string; source: string;
    }>(
      `SELECT m.media_id, m.blob_hash, b.path, b.mime_type, m.source
       FROM media m JOIN blob b ON m.blob_hash = b.blob_hash
       WHERE m.person_id = @personId ORDER BY m.is_primary DESC, m.created_at, m.media_id LIMIT 1`, { personId },
    );
    return result ? { mediaId: result.media_id, blobHash: result.blob_hash,
      path: result.path, mimeType: result.mime_type, source: result.source } : null;
  };

  const setPrimaryMedia = async (personId: string, mediaId: string): Promise<boolean> => store.transaction(async tx => {
    await tx.queryOne('SELECT person_id FROM person WHERE person_id = @personId FOR NO KEY UPDATE', { personId });
    const result = await tx.run(
      'UPDATE media SET is_primary = (media_id = @mediaId) WHERE person_id = @personId', { personId, mediaId },
    );
    return (result.rowCount ?? 0) > 0;
  });

  const deleteMedia = async (mediaId: string): Promise<boolean> => {
    const result = await store.run('DELETE FROM media WHERE media_id = @mediaId', { mediaId });
    return (result.rowCount ?? 0) > 0;
  };

  const migrateLegacyPhoto = async (personId: string, filename: string, source: string): Promise<string | null> => {
    const legacyPath = path.join(photosDir, filename);
    if (!fs.existsSync(legacyPath)) return null;
    const blob = await storeBlobFromFile(legacyPath);
    return createMedia(personId, blob.hash, source, { isPrimary: true });
  };

  const getStorageStats = async (): Promise<{ blobCount: number; totalSize: number; mediaCount: number }> => {
    const [blobStats, mediaStats] = await Promise.all([
      store.queryOne<{ count: string; total_size: string }>('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS total_size FROM blob'),
      store.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM media'),
    ]);
    return { blobCount: Number(blobStats?.count ?? 0), totalSize: Number(blobStats?.total_size ?? 0), mediaCount: Number(mediaStats?.count ?? 0) };
  };

  return { computeHash, storeBlob, storeBlobFromFile, getBlob, getBlobBuffer, getBlobStream,
    blobExists, deleteBlob, createMedia, getMediaForPerson, getPrimaryPhoto, setPrimaryMedia,
    deleteMedia, migrateLegacyPhoto, getStorageStats, BLOBS_DIR: blobsDir, PHOTOS_DIR: photosDir, MIME_TYPES };
}

export const blobService = createBlobService();
