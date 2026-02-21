import fs from 'fs';
import path from 'path';

export const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
export const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
export const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');
export const PERSON_CACHE_DIR = path.join(DATA_DIR, 'person');
export const SCRAPE_DIR = path.join(DATA_DIR, 'scrape');

// Ensure directories exist
for (const dir of [DATA_DIR, PHOTOS_DIR, AUGMENT_DIR, PROVIDER_CACHE_DIR, SCRAPE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Check if a photo file exists for a person, trying jpg then png.
 * Returns the full path if found, null otherwise.
 */
export function findPhoto(personId: string, suffix?: string): string | null {
  const base = suffix ? `${personId}-${suffix}` : personId;
  const jpgPath = path.join(PHOTOS_DIR, `${base}.jpg`);
  if (fs.existsSync(jpgPath)) return jpgPath;
  const pngPath = path.join(PHOTOS_DIR, `${base}.png`);
  if (fs.existsSync(pngPath)) return pngPath;
  return null;
}

/**
 * Build a photo file path without checking existence.
 */
export function getPhotoPath(personId: string, suffix?: string, ext = 'jpg'): string {
  const base = suffix ? `${personId}-${suffix}` : personId;
  return path.join(PHOTOS_DIR, `${base}.${ext}`);
}
