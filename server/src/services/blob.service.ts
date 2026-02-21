/**
 * Blob Service
 *
 * Content-addressed storage for media files (photos, documents).
 * Files are stored by SHA-256 hash for automatic deduplication.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { sqliteService } from '../db/sqlite.service.js';
import { DATA_DIR, PHOTOS_DIR } from '../utils/paths.js';

const BLOBS_DIR = path.join(DATA_DIR, 'blobs');

// MIME type mappings
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

/**
 * Compute SHA-256 hash of a buffer
 */
function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get the storage path for a blob hash
 * Uses 2-character prefix directories for better filesystem performance
 */
function getBlobPath(hash: string, ext: string): string {
  const prefix = hash.substring(0, 2);
  return path.join(BLOBS_DIR, prefix, `${hash}${ext}`);
}

/**
 * Ensure blob storage directories exist
 */
function ensureBlobsDir(): void {
  if (!fs.existsSync(BLOBS_DIR)) {
    fs.mkdirSync(BLOBS_DIR, { recursive: true });
  }
}

/**
 * Store a blob from buffer
 * Returns blob info including hash and path
 */
function storeBlob(
  buffer: Buffer,
  options?: {
    mimeType?: string;
    width?: number;
    height?: number;
  }
): {
  hash: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  isNew: boolean;
} {
  const hash = computeHash(buffer);

  // Check if blob already exists
  const existing = sqliteService.queryOne<{ path: string; mime_type: string }>(
    'SELECT path, mime_type FROM blob WHERE blob_hash = @hash',
    { hash }
  );

  if (existing) {
    return {
      hash,
      path: existing.path,
      mimeType: existing.mime_type,
      sizeBytes: buffer.length,
      isNew: false,
    };
  }

  // Determine file extension
  const mimeType = options?.mimeType ?? 'application/octet-stream';
  const ext = EXT_FROM_MIME[mimeType] ?? '.bin';

  // Ensure directory exists
  ensureBlobsDir();
  const prefix = hash.substring(0, 2);
  const prefixDir = path.join(BLOBS_DIR, prefix);
  if (!fs.existsSync(prefixDir)) {
    fs.mkdirSync(prefixDir, { recursive: true });
  }

  // Write file
  const blobPath = getBlobPath(hash, ext);
  const relativePath = path.relative(DATA_DIR, blobPath);
  fs.writeFileSync(blobPath, buffer);

  // Record in database
  sqliteService.run(
    `INSERT INTO blob (blob_hash, path, mime_type, size_bytes, width, height)
     VALUES (@hash, @path, @mimeType, @sizeBytes, @width, @height)`,
    {
      hash,
      path: relativePath,
      mimeType,
      sizeBytes: buffer.length,
      width: options?.width ?? null,
      height: options?.height ?? null,
    }
  );

  return {
    hash,
    path: relativePath,
    mimeType,
    sizeBytes: buffer.length,
    isNew: true,
  };
}

/**
 * Store a blob from a file path
 */
function storeBlobFromFile(
  filePath: string,
  options?: {
    mimeType?: string;
    width?: number;
    height?: number;
  }
): ReturnType<typeof storeBlob> {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = options?.mimeType ?? MIME_TYPES[ext] ?? 'application/octet-stream';

  return storeBlob(buffer, { ...options, mimeType });
}

/**
 * Get a blob by hash
 */
function getBlob(hash: string): {
  hash: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
} | null {
  const blob = sqliteService.queryOne<{
    blob_hash: string;
    path: string;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
  }>('SELECT * FROM blob WHERE blob_hash = @hash', { hash });

  if (!blob) return null;

  return {
    hash: blob.blob_hash,
    path: blob.path,
    mimeType: blob.mime_type,
    sizeBytes: blob.size_bytes,
    width: blob.width ?? undefined,
    height: blob.height ?? undefined,
  };
}

/**
 * Get blob file as buffer
 */
function getBlobBuffer(hash: string): Buffer | null {
  const blob = getBlob(hash);
  if (!blob) return null;

  const fullPath = path.join(DATA_DIR, blob.path);
  if (!fs.existsSync(fullPath)) return null;

  return fs.readFileSync(fullPath);
}

/**
 * Get blob as readable stream
 */
function getBlobStream(hash: string): fs.ReadStream | null {
  const blob = getBlob(hash);
  if (!blob) return null;

  const fullPath = path.join(DATA_DIR, blob.path);
  if (!fs.existsSync(fullPath)) return null;

  return fs.createReadStream(fullPath);
}

/**
 * Check if a blob exists
 */
function blobExists(hash: string): boolean {
  const result = sqliteService.queryOne<{ blob_hash: string }>(
    'SELECT blob_hash FROM blob WHERE blob_hash = @hash',
    { hash }
  );
  return !!result;
}

/**
 * Delete a blob (only if no media records reference it)
 */
function deleteBlob(hash: string): boolean {
  // Check for references
  const refs = sqliteService.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM media WHERE blob_hash = @hash',
    { hash }
  );

  if (refs && refs.count > 0) {
    return false; // Still referenced
  }

  const blob = getBlob(hash);
  if (!blob) return false;

  // Delete file
  const fullPath = path.join(DATA_DIR, blob.path);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  // Delete record
  sqliteService.run('DELETE FROM blob WHERE blob_hash = @hash', { hash });

  return true;
}

/**
 * Create a media record linked to a blob
 */
function createMedia(
  personId: string,
  blobHash: string,
  source: string,
  options?: {
    sourceUrl?: string;
    isPrimary?: boolean;
    caption?: string;
  }
): string {
  const mediaId = ulid();

  sqliteService.run(
    `INSERT INTO media (media_id, person_id, blob_hash, source, source_url, is_primary, caption)
     VALUES (@mediaId, @personId, @blobHash, @source, @sourceUrl, @isPrimary, @caption)`,
    {
      mediaId,
      personId,
      blobHash,
      source,
      sourceUrl: options?.sourceUrl ?? null,
      isPrimary: options?.isPrimary ? 1 : 0,
      caption: options?.caption ?? null,
    }
  );

  // If setting as primary, unset other primaries
  if (options?.isPrimary) {
    sqliteService.run(
      `UPDATE media SET is_primary = 0 WHERE person_id = @personId AND media_id != @mediaId`,
      { personId, mediaId }
    );
  }

  return mediaId;
}

/**
 * Get all media for a person
 */
function getMediaForPerson(personId: string): Array<{
  mediaId: string;
  blobHash: string;
  source: string;
  sourceUrl?: string;
  isPrimary: boolean;
  caption?: string;
  path: string;
  mimeType: string;
}> {
  return sqliteService
    .queryAll<{
      media_id: string;
      blob_hash: string;
      source: string;
      source_url: string | null;
      is_primary: number;
      caption: string | null;
      path: string;
      mime_type: string;
    }>(
      `SELECT m.*, b.path, b.mime_type
       FROM media m
       JOIN blob b ON m.blob_hash = b.blob_hash
       WHERE m.person_id = @personId
       ORDER BY m.is_primary DESC, m.created_at`,
      { personId }
    )
    .map((row) => ({
      mediaId: row.media_id,
      blobHash: row.blob_hash,
      source: row.source,
      sourceUrl: row.source_url ?? undefined,
      isPrimary: row.is_primary === 1,
      caption: row.caption ?? undefined,
      path: row.path,
      mimeType: row.mime_type,
    }));
}

/**
 * Get primary photo for a person
 */
function getPrimaryPhoto(personId: string): {
  mediaId: string;
  blobHash: string;
  path: string;
  mimeType: string;
  source: string;
} | null {
  const result = sqliteService.queryOne<{
    media_id: string;
    blob_hash: string;
    path: string;
    mime_type: string;
    source: string;
  }>(
    `SELECT m.media_id, m.blob_hash, b.path, b.mime_type, m.source
     FROM media m
     JOIN blob b ON m.blob_hash = b.blob_hash
     WHERE m.person_id = @personId
     ORDER BY m.is_primary DESC, m.created_at
     LIMIT 1`,
    { personId }
  );

  if (!result) return null;

  return {
    mediaId: result.media_id,
    blobHash: result.blob_hash,
    path: result.path,
    mimeType: result.mime_type,
    source: result.source,
  };
}

/**
 * Set a media item as primary
 */
function setPrimaryMedia(personId: string, mediaId: string): boolean {
  const result = sqliteService.run(
    `UPDATE media SET is_primary = CASE WHEN media_id = @mediaId THEN 1 ELSE 0 END
     WHERE person_id = @personId`,
    { personId, mediaId }
  );
  return result.changes > 0;
}

/**
 * Delete a media record
 */
function deleteMedia(mediaId: string): boolean {
  const result = sqliteService.run('DELETE FROM media WHERE media_id = @mediaId', { mediaId });
  return result.changes > 0;
}

/**
 * Migrate a photo from the legacy photos directory to blob storage
 */
function migrateLegacyPhoto(
  personId: string,
  filename: string,
  source: string
): string | null {
  const legacyPath = path.join(PHOTOS_DIR, filename);
  if (!fs.existsSync(legacyPath)) return null;

  // Store in blob storage
  const blob = storeBlobFromFile(legacyPath);

  // Create media record
  const mediaId = createMedia(personId, blob.hash, source, {
    isPrimary: true,
  });

  return mediaId;
}

/**
 * Get storage statistics
 */
function getStorageStats(): {
  blobCount: number;
  totalSize: number;
  mediaCount: number;
} {
  const blobStats = sqliteService.queryOne<{ count: number; total_size: number }>(
    'SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM blob'
  );
  const mediaCount =
    sqliteService.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM media')?.count ?? 0;

  return {
    blobCount: blobStats?.count ?? 0,
    totalSize: blobStats?.total_size ?? 0,
    mediaCount,
  };
}

export const blobService = {
  computeHash,
  storeBlob,
  storeBlobFromFile,
  getBlob,
  getBlobBuffer,
  getBlobStream,
  blobExists,
  deleteBlob,
  createMedia,
  getMediaForPerson,
  getPrimaryPhoto,
  setPrimaryMedia,
  deleteMedia,
  migrateLegacyPhoto,
  getStorageStats,
  BLOBS_DIR,
  PHOTOS_DIR,
  MIME_TYPES,
};
