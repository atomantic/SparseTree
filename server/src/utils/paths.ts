import fs from 'fs';
import path from 'path';

export const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
export const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
export const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');
export const PERSON_CACHE_DIR = path.join(DATA_DIR, 'person');
export const SCRAPE_DIR = path.join(DATA_DIR, 'scrape');

export type PhotoSource = 'familysearch' | 'ancestry' | 'wikitree' | 'wiki' | 'generic' | 'linkedin';
type PhotoLookupSource = PhotoSource | '23andme';

export interface LocalPhoto {
  source: PhotoSource;
  path: string;
  extension: 'jpg' | 'png';
}

const PHOTO_SUFFIXES: Record<PhotoLookupSource, string> = {
  familysearch: 'familysearch',
  ancestry: 'ancestry',
  wikitree: 'wikitree',
  wiki: 'wiki',
  generic: '',
  linkedin: 'linkedin',
  '23andme': '23andme',
};

const PHOTO_ROUTE_SUFFIXES: Partial<Record<PhotoSource, string>> = {
  familysearch: 'familysearch',
  ancestry: 'ancestry',
  wikitree: 'wikitree',
  wiki: 'wiki',
  linkedin: 'linkedin',
};

export function getLocalPhotoSuffix(source: PhotoLookupSource): string {
  return PHOTO_SUFFIXES[source];
}

/** Create directory if it doesn't exist */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Ensure core directories exist
for (const dir of [DATA_DIR, PHOTOS_DIR, AUGMENT_DIR, PROVIDER_CACHE_DIR, SCRAPE_DIR]) {
  ensureDir(dir);
}

/**
 * Check if a photo file exists for a person, trying jpg then png.
 * Returns the full path if found, null otherwise.
 */
export function findPhoto(personId: string, suffix?: string): string | null {
  return resolvePhotoFile(personId, suffix || '', PHOTOS_DIR)?.path ?? null;
}

/**
 * Find the first available local photo according to the caller's source priority.
 * For each source, jpg takes precedence over png.
 */
export function findLocalPhoto(
  personId: string,
  sources: readonly PhotoSource[],
  photosDir = PHOTOS_DIR,
): LocalPhoto | null {
  for (const source of sources) {
    const photo = resolvePhotoFile(personId, getLocalPhotoSuffix(source), photosDir);
    if (photo) return { source, ...photo };
  }
  return null;
}

/** Check whether a local photo exists for a particular source. */
export function hasLocalPhoto(personId: string, source: PhotoLookupSource, photosDir = PHOTOS_DIR): boolean {
  return resolvePhotoFile(personId, getLocalPhotoSuffix(source), photosDir) !== null;
}

function resolvePhotoFile(
  personId: string,
  suffix: string,
  photosDir: string,
): { path: string; extension: 'jpg' | 'png' } | null {
  const base = suffix ? `${personId}-${suffix}` : personId;
  for (const extension of ['jpg', 'png'] as const) {
    const photoPath = path.join(photosDir, `${base}.${extension}`);
    if (fs.existsSync(photoPath)) return { path: photoPath, extension };
  }
  return null;
}

/**
 * Build the API route that serves a local photo. Pass an empty apiPrefix for
 * client-relative routes used by the upload comparison services.
 */
export function localPhotoRoute(personId: string, source: PhotoSource, apiPrefix = '/api'): string {
  if (source === 'generic') return `${apiPrefix}/browser/photos/${personId}`;

  const routeSuffix = PHOTO_ROUTE_SUFFIXES[source];
  if (!routeSuffix) throw new Error(`No photo route is configured for ${source}`);
  return `${apiPrefix}/augment/${personId}/${routeSuffix}-photo`;
}
