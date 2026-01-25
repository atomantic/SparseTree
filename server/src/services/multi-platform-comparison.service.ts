/**
 * Multi-Platform Comparison Service
 *
 * Provides functionality to compare person data across multiple genealogy providers
 * (FamilySearch, Ancestry, WikiTree, etc.) and generate comparison reports.
 */

import fs from 'fs';
import path from 'path';
import type {
  BuiltInProvider,
  MultiPlatformComparison,
  FieldComparison,
  ComparisonStatus,
  ProviderLinkInfo,
  ProviderCache,
  ScrapedPersonData,
} from '@fsf/shared';
import { databaseService } from './database.service.js';
import { augmentationService } from './augmentation.service.js';
import { idMappingService } from './id-mapping.service.js';
import { familySearchRefreshService } from './familysearch-refresh.service.js';
import { browserService } from './browser.service.js';
import { getScraper } from './scrapers/index.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');

// Ensure cache directories exist
const PROVIDERS: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree', '23andme'];
for (const provider of PROVIDERS) {
  const dir = path.join(PROVIDER_CACHE_DIR, provider);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Field definitions for comparison
const COMPARISON_FIELDS = [
  { fieldName: 'name', label: 'Name' },
  { fieldName: 'gender', label: 'Gender' },
  { fieldName: 'birthDate', label: 'Birth Date' },
  { fieldName: 'birthPlace', label: 'Birth Place' },
  { fieldName: 'deathDate', label: 'Death Date' },
  { fieldName: 'deathPlace', label: 'Death Place' },
  { fieldName: 'alternateNames', label: 'Alternate Names', isArray: true },
];

/**
 * Get cached provider data from file system
 */
function getCachedProviderData(provider: BuiltInProvider, externalId: string): ProviderCache | null {
  const cacheDir = path.join(PROVIDER_CACHE_DIR, provider);
  const cachePath = path.join(cacheDir, `${externalId}.json`);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  const content = fs.readFileSync(cachePath, 'utf-8');
  return JSON.parse(content) as ProviderCache;
}

/**
 * Save provider data to cache
 */
function saveProviderCache(cache: ProviderCache): void {
  const cacheDir = path.join(PROVIDER_CACHE_DIR, cache.provider);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cachePath = path.join(cacheDir, `${cache.externalId}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Normalize and sort an array of alternate names for comparison
 */
function normalizeAlternateNames(names: string[] | undefined | null): string {
  if (!names || names.length === 0) return '';
  // Sort alphabetically (case-insensitive) and join with comma
  return [...names]
    .map(n => n.trim())
    .filter(n => n.length > 0)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .join(', ');
}

/**
 * Extract a field value from ScrapedPersonData
 */
function extractFieldValue(data: ScrapedPersonData | null, fieldName: string): string | null {
  if (!data) return null;

  switch (fieldName) {
    case 'name':
      return data.name || null;
    case 'gender':
      return data.gender || null;
    case 'birthDate':
      return data.birth?.date || null;
    case 'birthPlace':
      return data.birth?.place || null;
    case 'deathDate':
      return data.death?.date || null;
    case 'deathPlace':
      return data.death?.place || null;
    case 'alternateNames':
      return normalizeAlternateNames(data.alternateNames) || null;
    default:
      return null;
  }
}

/**
 * Extract field value from local person data (from database)
 */
function extractLocalFieldValue(person: { name?: string; gender?: string; birth?: { date?: string; place?: string }; death?: { date?: string; place?: string }; alternateNames?: string[] } | null, fieldName: string): string | null {
  if (!person) return null;

  switch (fieldName) {
    case 'name':
      return person.name || null;
    case 'gender':
      return person.gender || null;
    case 'birthDate':
      return person.birth?.date || null;
    case 'birthPlace':
      return person.birth?.place || null;
    case 'deathDate':
      return person.death?.date || null;
    case 'deathPlace':
      return person.death?.place || null;
    case 'alternateNames':
      return normalizeAlternateNames(person.alternateNames) || null;
    default:
      return null;
  }
}

/**
 * Normalize a value for comparison (lowercase, trim, remove extra spaces)
 */
function normalizeForComparison(value: string | null): string {
  if (!value) return '';
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Determine comparison status between local and provider values
 */
function getComparisonStatus(localValue: string | null, providerValue: string | null): ComparisonStatus {
  const normalizedLocal = normalizeForComparison(localValue);
  const normalizedProvider = normalizeForComparison(providerValue);

  if (!normalizedLocal && !normalizedProvider) {
    return 'match'; // Both empty is considered a match
  }

  if (!normalizedLocal) {
    return 'missing_local';
  }

  if (!normalizedProvider) {
    return 'missing_provider';
  }

  // Check for exact match or fuzzy match (contains)
  if (normalizedLocal === normalizedProvider) {
    return 'match';
  }

  // Check if one contains the other (common for place names with different specificity)
  if (normalizedLocal.includes(normalizedProvider) || normalizedProvider.includes(normalizedLocal)) {
    return 'match';
  }

  return 'different';
}

export const multiPlatformComparisonService = {
  /**
   * Get provider data from cache or scrape fresh
   */
  async getProviderData(
    personId: string,
    provider: BuiltInProvider,
    forceRefresh = false
  ): Promise<ProviderCache | null> {
    // Get the external ID for this provider
    const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Check augmentation for provider links
    const augmentation = augmentationService.getAugmentation(personId);
    const platformRef = augmentation?.platforms?.find(p => p.platform === provider);

    if (!platformRef?.externalId) {
      // Provider not linked for this person
      return null;
    }

    const externalId = platformRef.externalId;

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = getCachedProviderData(provider, externalId);
      if (cached) {
        return cached;
      }
    }

    // Need to scrape - but only if browser is connected
    if (!browserService.isConnected()) {
      return null;
    }

    // FamilySearch is handled differently - use the refresh service
    if (provider === 'familysearch') {
      const fsId = idMappingService.getExternalId(canonicalId, 'familysearch');
      if (fsId) {
        const cached = getCachedProviderData('familysearch', fsId);
        if (cached) return cached;
      }
      return null;
    }

    // Scrape from provider - use the linked URL if available
    const scraper = getScraper(provider);
    const personUrl = platformRef.url || `https://www.${provider}.com`;
    console.log(`[comparison] Scraping ${provider} from URL: ${personUrl}`);
    const page = await browserService.createPage(personUrl);

    // Wait for page to load
    await page.waitForTimeout(2000);

    const scrapedData = await scraper.scrapePersonById(page, externalId).catch(err => {
      console.error(`[comparison] Failed to scrape ${provider}/${externalId}:`, err.message);
      return null;
    });

    // Close the page to free resources
    await page.close().catch(() => {});

    if (!scrapedData) {
      return null;
    }

    // Build and save cache
    const cache: ProviderCache = {
      personId: canonicalId,
      provider,
      externalId,
      scrapedData,
      scrapedAt: new Date().toISOString(),
      sourceUrl: platformRef.url,
    };

    saveProviderCache(cache);
    return cache;
  },

  /**
   * Build complete multi-platform comparison for a person
   */
  async compareAcrossPlatforms(
    dbId: string,
    personId: string
  ): Promise<MultiPlatformComparison> {
    // Get local person data (FamilySearch as baseline)
    const person = await databaseService.getPerson(dbId, personId);
    if (!person) {
      throw new Error(`Person ${personId} not found in database ${dbId}`);
    }

    const canonicalId = person.canonicalId || idMappingService.resolveId(personId, 'familysearch') || personId;
    const augmentation = augmentationService.getAugmentation(personId);

    // Build provider info list
    const providers: ProviderLinkInfo[] = [];
    const providerData: Record<string, ScrapedPersonData | null> = {};

    for (const providerName of PROVIDERS) {
      const platformRef = augmentation?.platforms?.find(p => p.platform === providerName);
      const isLinked = !!platformRef?.externalId;

      const info: ProviderLinkInfo = {
        provider: providerName,
        isLinked,
        externalId: platformRef?.externalId,
        url: platformRef?.url,
      };

      if (isLinked) {
        // Try to get cached data
        const cached = getCachedProviderData(providerName, platformRef!.externalId!);
        if (cached) {
          info.lastScrapedAt = cached.scrapedAt;
          providerData[providerName] = cached.scrapedData;
        } else {
          providerData[providerName] = null;
        }
      } else {
        providerData[providerName] = null;
      }

      providers.push(info);
    }

    // Build field comparisons
    const fields: FieldComparison[] = [];
    let matchingFields = 0;
    let differingFields = 0;
    const missingOnProviders: Record<string, number> = {};

    for (const providerName of PROVIDERS) {
      missingOnProviders[providerName] = 0;
    }

    for (const fieldDef of COMPARISON_FIELDS) {
      const localValue = extractLocalFieldValue(person, fieldDef.fieldName);

      const providerValues: FieldComparison['providerValues'] = {};

      for (const providerName of PROVIDERS) {
        const data = providerData[providerName];
        const value = extractFieldValue(data, fieldDef.fieldName);
        const status = getComparisonStatus(localValue, value);

        const cached = providers.find(p => p.provider === providerName && p.isLinked);
        providerValues[providerName] = {
          value,
          status,
          lastScrapedAt: cached?.lastScrapedAt,
        };

        if (status === 'missing_provider') {
          missingOnProviders[providerName]++;
        }
      }

      // Count matches/differences (only for linked providers)
      const linkedProviderStatuses = Object.entries(providerValues)
        .filter(([name]) => providers.find(p => p.provider === name)?.isLinked)
        .map(([, v]) => v.status);

      const hasMatch = linkedProviderStatuses.some(s => s === 'match');
      const hasDifferent = linkedProviderStatuses.some(s => s === 'different');

      if (hasMatch && !hasDifferent) {
        matchingFields++;
      } else if (hasDifferent) {
        differingFields++;
      }

      fields.push({
        fieldName: fieldDef.fieldName,
        label: fieldDef.label,
        localValue,
        providerValues,
      });
    }

    return {
      personId,
      canonicalId,
      displayName: person.name,
      providers,
      fields,
      summary: {
        totalFields: COMPARISON_FIELDS.length,
        matchingFields,
        differingFields,
        missingOnProviders,
      },
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Refresh data from a specific provider
   */
  async refreshFromProvider(
    dbId: string,
    personId: string,
    provider: BuiltInProvider
  ): Promise<ProviderCache | null> {
    // FamilySearch uses a different refresh mechanism
    if (provider === 'familysearch') {
      const result = await familySearchRefreshService.refreshPerson(dbId, personId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to refresh from FamilySearch');
      }

      // Get the cached FamilySearch data
      const fsId = result.currentFsId || idMappingService.getExternalId(personId, 'familysearch');
      if (fsId) {
        const cached = getCachedProviderData('familysearch', fsId);
        return cached;
      }
      return null;
    }

    // For other providers, force refresh
    return this.getProviderData(personId, provider, true);
  },

  /**
   * Get all cached provider data for a person
   */
  getCachedProviderDataForPerson(personId: string): Record<BuiltInProvider, ProviderCache | null> {
    const result: Record<BuiltInProvider, ProviderCache | null> = {
      familysearch: null,
      ancestry: null,
      wikitree: null,
      '23andme': null,
    };

    const augmentation = augmentationService.getAugmentation(personId);
    if (!augmentation) return result;

    for (const provider of PROVIDERS) {
      const platformRef = augmentation.platforms?.find(p => p.platform === provider);
      if (platformRef?.externalId) {
        result[provider] = getCachedProviderData(provider, platformRef.externalId);
      }
    }

    // Also check FamilySearch by direct ID lookup
    const fsId = idMappingService.getExternalId(personId, 'familysearch');
    if (fsId && !result.familysearch) {
      result.familysearch = getCachedProviderData('familysearch', fsId);
    }

    return result;
  },
};
