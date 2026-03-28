import type { BuiltInProvider } from '@fsf/shared';
import { PROVIDER_DEFAULTS } from './base.scraper.js';
import type { ProviderScraper, ProviderInfo } from './base.scraper.js';
import { familySearchScraper } from './familysearch.scraper.js';
import { ancestryScraper } from './ancestry.scraper.js';
import { twentyThreeAndMeScraper } from './23andme.scraper.js';
import { wikiTreeScraper } from './wikitree.scraper.js';

/**
 * Registry of all available provider scrapers
 */
const scraperRegistry: Record<BuiltInProvider, ProviderScraper> = {
  familysearch: familySearchScraper,
  ancestry: ancestryScraper,
  '23andme': twentyThreeAndMeScraper,
  wikitree: wikiTreeScraper
};

/**
 * Get a scraper for the specified provider
 */
export function getScraper(provider: BuiltInProvider): ProviderScraper {
  const scraper = scraperRegistry[provider];
  if (!scraper) {
    throw new Error(`No scraper available for provider: ${provider}`);
  }
  return scraper;
}

/**
 * Get provider information for a specific provider
 */
export function getProviderInfo(provider: BuiltInProvider): ProviderInfo {
  const info = PROVIDER_DEFAULTS[provider];
  if (!info) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return info;
}

/**
 * List all built-in provider types
 */
export function listProviders(): BuiltInProvider[] {
  return Object.keys(scraperRegistry) as BuiltInProvider[];
}

export type { ProviderScraper, ProviderInfo };
export { PROVIDER_DEFAULTS };
