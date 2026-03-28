import fs from 'fs';
import path from 'path';
import type { BuiltInProvider, ProviderCache } from '@fsf/shared';
import { PROVIDER_CACHE_DIR } from './paths.js';

/**
 * Get the photo filename suffix for a provider (e.g., '-ancestry', '-wikitree')
 */
export function getPhotoSuffix(provider: BuiltInProvider): string {
  return `-${provider}`;
}

/**
 * Read cached provider data from the file system.
 * Returns null if the cache file doesn't exist or can't be parsed.
 */
export function getCachedProviderData(provider: BuiltInProvider, externalId: string): ProviderCache | null {
  const cachePath = path.join(PROVIDER_CACHE_DIR, provider, `${externalId}.json`);

  if (!fs.existsSync(cachePath)) return null;

  const content = fs.readFileSync(cachePath, 'utf-8');
  return JSON.parse(content) as ProviderCache;
}
