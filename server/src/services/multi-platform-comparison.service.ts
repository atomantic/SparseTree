/**
 * Multi-Platform Comparison Service
 *
 * Provides functionality to compare person data across multiple genealogy providers
 * (FamilySearch, Ancestry, WikiTree, etc.) and generate comparison reports.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
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
import { sqliteService } from '../db/sqlite.service.js';
import { familySearchRefreshService } from './familysearch-refresh.service.js';
import { browserService } from './browser.service.js';
import { getScraper } from './scrapers/index.js';
import { json2person } from '../lib/familysearch/index.js';
import { logger } from '../lib/logger.js';
import { localOverrideService } from './local-override.service.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// Ensure directories exist
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

/**
 * Download an image from URL to local file
 */
function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Handle both http and https
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlink(destPath, () => {});
          // Handle relative redirects
          const fullRedirectUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).toString();
          downloadImage(fullRedirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Get the photo suffix for a provider (e.g., '-ancestry', '-wikitree', '-familysearch')
 * All providers now use a consistent suffixed naming convention.
 */
function getPhotoSuffix(provider: BuiltInProvider): string {
  switch (provider) {
    case 'ancestry': return '-ancestry';
    case 'wikitree': return '-wikitree';
    case 'familysearch': return '-familysearch';
    default: return `-${provider}`;
  }
}

/**
 * Check if photo exists locally for a person from a provider
 */
function hasLocalPhoto(personId: string, provider: BuiltInProvider): boolean {
  const suffix = getPhotoSuffix(provider);
  const jpgPath = path.join(PHOTOS_DIR, `${personId}${suffix}.jpg`);
  const pngPath = path.join(PHOTOS_DIR, `${personId}${suffix}.png`);
  return fs.existsSync(jpgPath) || fs.existsSync(pngPath);
}

/**
 * Normalize photo URL to absolute
 */
function normalizePhotoUrl(photoUrl: string, provider: BuiltInProvider): string {
  if (photoUrl.startsWith('//')) {
    return 'https:' + photoUrl;
  }
  if (photoUrl.startsWith('/')) {
    switch (provider) {
      case 'ancestry': return 'https://www.ancestry.com' + photoUrl;
      case 'familysearch': return 'https://www.familysearch.org' + photoUrl;
      case 'wikitree': return 'https://www.wikitree.com' + photoUrl;
      default: return photoUrl;
    }
  }
  return photoUrl;
}

/**
 * Download photo from provider, optionally forcing re-download
 */
async function downloadProviderPhoto(
  personId: string,
  provider: BuiltInProvider,
  photoUrl: string,
  forceRefresh = false
): Promise<string | null> {
  // Check if we already have this photo (skip if forcing refresh)
  if (!forceRefresh && hasLocalPhoto(personId, provider)) {
    return null;
  }

  // Normalize URL to absolute
  const normalizedUrl = normalizePhotoUrl(photoUrl, provider);

  const suffix = getPhotoSuffix(provider);
  const ext = normalizedUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
  const photoPath = path.join(PHOTOS_DIR, `${personId}${suffix}.${ext}`);

  await downloadImage(normalizedUrl, photoPath).catch(err => {
    logger.error('compare', `Failed to download ${provider} photo: ${err.message}`);
    return null;
  });

  if (fs.existsSync(photoPath)) {
    return photoPath;
  }

  return null;
}

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
  { fieldName: 'fatherName', label: 'Father' },
  { fieldName: 'motherName', label: 'Mother' },
  { fieldName: 'childrenCount', label: 'Children' },
  { fieldName: 'occupations', label: 'Occupations', isArray: true },
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
 * Resolve a parent's display name from a FamilySearch external ID.
 * Tries three sources in order: local DB → FS cache → FS API.
 */
async function resolveParentName(dbId: string, fsExternalId: string): Promise<string | null> {
  // 1. Try local database via ID mapping
  const canonicalId = idMappingService.resolveId(fsExternalId, 'familysearch');
  if (canonicalId) {
    const person = await databaseService.getPerson(dbId, canonicalId).catch(() => null);
    if (person) return person.name;
  }

  // 2. Try reading from FamilySearch cache file
  const cachedFs = loadFamilySearchData(fsExternalId);
  if (cachedFs?.scrapedData?.name) return cachedFs.scrapedData.name;

  // 3. Fetch from FamilySearch API (also caches the result)
  const name = await familySearchRefreshService.fetchPersonDisplayName(fsExternalId).catch(() => null);
  if (name) logger.data('comparison', `Resolved parent name from FS API: ${fsExternalId} → ${name}`);
  return name;
}

/**
 * Resolve a parent's display name from a provider external ID.
 * Tries: local DB via id-mapping → provider cache.
 */
async function resolveParentNameByProvider(
  dbId: string,
  externalId: string,
  provider: BuiltInProvider
): Promise<string | null> {
  const canonicalId = idMappingService.resolveId(externalId, provider);
  if (canonicalId) {
    const person = await databaseService.getPerson(dbId, canonicalId).catch(() => null);
    if (person) return person.name;
  }

  // Try provider cache
  const cached = getCachedProviderData(provider, externalId);
  if (cached?.scrapedData?.name) return cached.scrapedData.name;

  return null;
}

/**
 * Check if cached data is raw GEDCOMX format (FamilySearch API response)
 * rather than the standard ProviderCache format
 */
function isRawGedcomx(data: unknown): boolean {
  const obj = data as Record<string, unknown>;
  return obj && 'persons' in obj && Array.isArray(obj.persons) && !('scrapedData' in obj);
}

/**
 * Convert raw FamilySearch GEDCOMX API data to ScrapedPersonData
 * This handles the case where the FamilySearch cache stores the raw API response
 */
function convertGedcomxToScrapedData(rawData: Record<string, unknown>, fsId: string): ScrapedPersonData {
  // Use json2person to parse the GEDCOMX data
  const person = json2person(rawData);

  const data: ScrapedPersonData = {
    externalId: fsId,
    provider: 'familysearch',
    name: person?.name || '',
    gender: person?.gender,
    birth: person?.birth ? { date: person.birth.date, place: person.birth.place } : undefined,
    death: person?.death ? { date: person.death.date, place: person.death.place } : undefined,
    alternateNames: person?.alternateNames,
    occupations: person?.occupations,
    sourceUrl: `https://www.familysearch.org/tree/person/details/${fsId}`,
    scrapedAt: new Date().toISOString(),
  };

  // Extract parent names from display data (need to resolve from other persons in response or database)
  // Parent IDs are available from json2person
  if (person?.parents?.length) {
    data.fatherExternalId = person.parents[0];
    data.motherExternalId = person.parents.length > 1 ? person.parents[1] : undefined;
  }

  // Extract children count from display.familiesAsParent
  const persons = rawData.persons as Array<{ display?: { familiesAsParent?: Array<{ children?: unknown[] }> } }>;
  const display = persons?.[0]?.display;
  if (display?.familiesAsParent) {
    let childCount = 0;
    for (const family of display.familiesAsParent) {
      childCount += family.children?.length || 0;
    }
    data.childrenCount = childCount;
  }

  return data;
}

/**
 * Load FamilySearch cached data, handling both raw GEDCOMX and ProviderCache formats
 */
function loadFamilySearchData(fsId: string): { scrapedData: ScrapedPersonData; scrapedAt: string } | null {
  const cacheDir = path.join(PROVIDER_CACHE_DIR, 'familysearch');
  const cachePath = path.join(cacheDir, `${fsId}.json`);

  if (!fs.existsSync(cachePath)) return null;

  const content = fs.readFileSync(cachePath, 'utf-8');
  const rawData = JSON.parse(content);

  // Check if it's raw GEDCOMX format
  if (isRawGedcomx(rawData)) {
    const scrapedData = convertGedcomxToScrapedData(rawData, fsId);
    // Use file mtime as scrapedAt
    const stat = fs.statSync(cachePath);
    return { scrapedData, scrapedAt: stat.mtime.toISOString() };
  }

  // Standard ProviderCache format
  const cache = rawData as ProviderCache;
  if (cache.scrapedData) {
    return { scrapedData: cache.scrapedData, scrapedAt: cache.scrapedAt };
  }

  return null;
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
    case 'fatherName':
      return data.fatherName || null;
    case 'motherName':
      return data.motherName || null;
    case 'childrenCount':
      return data.childrenCount != null ? String(data.childrenCount) : null;
    case 'occupations':
      return data.occupations?.join(', ') || null;
    default:
      return null;
  }
}

/**
 * Apply local overrides to a person object
 * Modifies the person in place to reflect user overrides
 */
function applyLocalOverrides(
  person: { name?: string; gender?: string; birth?: { date?: string; place?: string }; death?: { date?: string; place?: string }; alternateNames?: string[] },
  personId: string
): void {
  // Get person-level overrides (name, gender)
  const personOverrides = localOverrideService.getOverridesForEntity('person', personId);

  for (const override of personOverrides) {
    switch (override.fieldName) {
      case 'name':
        person.name = override.overrideValue ?? undefined;
        break;
      case 'gender':
        person.gender = override.overrideValue ?? undefined;
        break;
    }
  }

  // Get vital event IDs for this person and check for overrides
  const vitalEventIds = sqliteService.queryAll<{ id: number; event_type: string }>(
    `SELECT id, event_type FROM vital_event WHERE person_id = @personId`,
    { personId }
  );

  for (const event of vitalEventIds) {
    const eventOverrides = localOverrideService.getOverridesForEntity('vital_event', String(event.id));
    for (const override of eventOverrides) {
      if (event.event_type === 'birth') {
        if (!person.birth) person.birth = {};
        if (override.fieldName === 'birth_date' || override.fieldName === 'date') {
          person.birth.date = override.overrideValue ?? undefined;
        } else if (override.fieldName === 'birth_place' || override.fieldName === 'place') {
          person.birth.place = override.overrideValue ?? undefined;
        }
      } else if (event.event_type === 'death') {
        if (!person.death) person.death = {};
        if (override.fieldName === 'death_date' || override.fieldName === 'date') {
          person.death.date = override.overrideValue ?? undefined;
        } else if (override.fieldName === 'death_place' || override.fieldName === 'place') {
          person.death.place = override.overrideValue ?? undefined;
        }
      }
    }
  }
}

/**
 * Extract field value from local person data (from database)
 */
interface LocalPersonContext {
  fatherName?: string;
  fatherId?: string;
  motherName?: string;
  motherId?: string;
  childrenCount?: number;
  occupations?: string[];
}

function extractLocalFieldValue(
  person: { name?: string; gender?: string; birth?: { date?: string; place?: string }; death?: { date?: string; place?: string }; alternateNames?: string[] } | null,
  fieldName: string,
  context?: LocalPersonContext
): string | null {
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
    case 'fatherName':
      return context?.fatherName || null;
    case 'motherName':
      return context?.motherName || null;
    case 'childrenCount':
      return context?.childrenCount != null ? String(context.childrenCount) : null;
    case 'occupations':
      return context?.occupations?.join(', ') || null;
    default:
      return null;
  }
}

/**
 * Month abbreviation to full name mapping
 */
const MONTH_ABBREVS: Record<string, string> = {
  jan: 'january', feb: 'february', mar: 'march', apr: 'april',
  may: 'may', jun: 'june', jul: 'july', aug: 'august',
  sep: 'september', oct: 'october', nov: 'november', dec: 'december',
};

/**
 * Normalize a date string by expanding month abbreviations
 * e.g., "29 AUG 1933" -> "29 august 1933"
 */
function normalizeDateString(value: string): string {
  let normalized = value.toLowerCase().trim().replace(/\s+/g, ' ');
  // Replace month abbreviations with full names
  for (const [abbrev, full] of Object.entries(MONTH_ABBREVS)) {
    // Match abbreviation as a word boundary (not part of a longer word)
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    normalized = normalized.replace(regex, full);
  }
  return normalized;
}

/**
 * Normalize a value for comparison (lowercase, trim, remove extra spaces)
 * For date-like values, also expands month abbreviations
 */
function normalizeForComparison(value: string | null): string {
  if (!value) return '';
  const basic = value.toLowerCase().trim().replace(/\s+/g, ' ');
  // Check if this looks like a date (contains a month name or abbreviation)
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(value)) {
    return normalizeDateString(basic);
  }
  return basic;
}

/**
 * Normalize a name for fuzzy comparison (lowercase, trim, remove accents/extra spaces)
 */
function normalizeNameForComparison(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ');
}

/**
 * Compare two names and return whether they match
 */
function namesMatch(localName: string, providerName: string): boolean {
  const a = normalizeNameForComparison(localName);
  const b = normalizeNameForComparison(providerName);

  if (!a || !b) return false;
  if (a === b) return true;

  // Check if one contains the other (handles "John Smith" vs "John Adam Smith")
  if (a.includes(b) || b.includes(a)) return true;

  // Check if last names match (common for first-name variations)
  const aLast = a.split(' ').pop() || '';
  const bLast = b.split(' ').pop() || '';
  if (aLast === bLast && aLast.length > 2) return true;

  return false;
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

  // Check for exact match
  if (normalizedLocal === normalizedProvider) {
    return 'match';
  }

  // Check if local contains the provider value (provider is less specific)
  // This is still a match since there's nothing more detailed to use
  if (normalizedLocal.includes(normalizedProvider)) {
    return 'match';
  }

  // If provider contains local value but is longer, provider has more detail
  // Mark as 'different' so user can choose to use the more specific value
  // e.g., local "1933" vs provider "29 August 1933"
  // e.g., local "Canada" vs provider "Saskatchewan, Canada"
  if (normalizedProvider.includes(normalizedLocal)) {
    return 'different';
  }

  return 'different';
}

/**
 * Build a provider-specific URL for a parent external ID
 */
function buildProviderParentUrl(provider: BuiltInProvider, externalId: string): string | undefined {
  switch (provider) {
    case 'familysearch':
      return `https://www.familysearch.org/tree/person/details/${externalId}`;
    case 'wikitree':
      return `https://www.wikitree.com/wiki/${externalId}`;
    case 'ancestry':
      // Ancestry URLs require a tree ID - return undefined here,
      // resolveParentProviderUrl will use the full augmentation URL instead
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Build a provider URL for a person, using treeId when required.
 */
function buildProviderPersonUrl(
  provider: BuiltInProvider,
  externalId: string,
  treeId?: string
): string | undefined {
  switch (provider) {
    case 'ancestry':
      return treeId
        ? `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${externalId}/facts`
        : undefined;
    case 'familysearch':
      return `https://www.familysearch.org/tree/person/details/${externalId}`;
    case 'wikitree':
      return `https://www.wikitree.com/wiki/${externalId}`;
    default:
      return undefined;
  }
}

/**
 * Extract parent external ID from scraped data for a given field
 */
function extractParentExternalId(data: ScrapedPersonData | null, fieldName: string): string | undefined {
  if (!data) return undefined;
  if (fieldName === 'fatherName') return data.fatherExternalId;
  if (fieldName === 'motherName') return data.motherExternalId;
  return undefined;
}

/**
 * Resolve a parent's provider URL from id-mapping and augmentation.
 * This picks up links registered by parent discovery (not just scraped data).
 */
function resolveParentProviderUrl(
  localContext: LocalPersonContext,
  fieldName: string,
  providerName: BuiltInProvider
): string | undefined {
  // Get the parent's canonical ID from local context
  let parentCanonicalId: string | undefined;
  if (fieldName === 'fatherName') parentCanonicalId = localContext.fatherId;
  else if (fieldName === 'motherName') parentCanonicalId = localContext.motherId;

  if (!parentCanonicalId) return undefined;

  // Check if parent has an external ID for this provider
  const extId = idMappingService.getExternalId(parentCanonicalId, providerName);
  if (!extId) return undefined;

  // Get the full URL from augmentation (includes tree ID for Ancestry)
  const aug = augmentationService.getAugmentation(parentCanonicalId);
  const platform = aug?.platforms?.find(p => p.platform === providerName);
  if (platform?.url) return platform.url;

  // Fall back to building URL from external ID (works for FS/WikiTree)
  return buildProviderParentUrl(providerName, extId);
}

/**
 * Cache parent information from scraped data WITHOUT creating parent edges or person records.
 * Parent data is stored in the provider cache for later explicit application via "Use" button.
 *
 * This function intentionally does NOT:
 * - Create new person records for parents
 * - Create parent_edge records
 * - Auto-apply any relationships
 *
 * Users must explicitly click "Use" to apply parent links from provider data.
 */
function cacheScrapedParentInfo(
  scrapedData: ScrapedPersonData,
  provider: BuiltInProvider,
  treeId?: string
): void {
  if (!scrapedData.fatherExternalId && !scrapedData.motherExternalId) {
    return; // No parents to cache
  }

  // Build parent URLs for reference (stored in scrapedData)
  if (scrapedData.fatherExternalId) {
    let fatherUrl: string | undefined;
    if (provider === 'ancestry' && treeId) {
      fatherUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${scrapedData.fatherExternalId}/facts`;
    } else if (provider === 'familysearch') {
      fatherUrl = `https://www.familysearch.org/tree/person/details/${scrapedData.fatherExternalId}`;
    } else if (provider === 'wikitree') {
      fatherUrl = `https://www.wikitree.com/wiki/${scrapedData.fatherExternalId}`;
    }
    if (fatherUrl) {
      scrapedData.fatherUrl = fatherUrl;
    }
    logger.data('compare', `Cached father info: ${scrapedData.fatherName || 'Unknown'} (${scrapedData.fatherExternalId})`);
  }

  if (scrapedData.motherExternalId) {
    let motherUrl: string | undefined;
    if (provider === 'ancestry' && treeId) {
      motherUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${scrapedData.motherExternalId}/facts`;
    } else if (provider === 'familysearch') {
      motherUrl = `https://www.familysearch.org/tree/person/details/${scrapedData.motherExternalId}`;
    } else if (provider === 'wikitree') {
      motherUrl = `https://www.wikitree.com/wiki/${scrapedData.motherExternalId}`;
    }
    if (motherUrl) {
      scrapedData.motherUrl = motherUrl;
    }
    logger.data('compare', `Cached mother info: ${scrapedData.motherName || 'Unknown'} (${scrapedData.motherExternalId})`);
  }
}

/**
 * Link scraped parent external IDs to existing local parent records.
 * This does NOT create new parent records or edges.
 */
async function linkScrapedParentsToLocal(
  dbId: string,
  personId: string,
  provider: BuiltInProvider,
  scrapedData: ScrapedPersonData,
  treeId?: string
): Promise<void> {
  const person = await databaseService.getPerson(dbId, personId).catch(() => null);
  if (!person || !person.parents || person.parents.length === 0) return;

  const [fatherId, motherId] = person.parents;
  const parentLinks: Array<{
    parentId?: string;
    externalId?: string;
    providerName?: string;
    providerUrl?: string;
  }> = [
    {
      parentId: fatherId,
      externalId: scrapedData.fatherExternalId,
      providerName: scrapedData.fatherName,
      providerUrl: scrapedData.fatherUrl,
    },
    {
      parentId: motherId,
      externalId: scrapedData.motherExternalId,
      providerName: scrapedData.motherName,
      providerUrl: scrapedData.motherUrl,
    },
  ];

  for (const link of parentLinks) {
    if (!link.parentId || !link.externalId) continue;

    const existing = idMappingService.getExternalId(link.parentId, provider);
    if (existing) continue;

    let confidence = 0.7;
    if (link.providerName) {
      const localParent = await databaseService.getPerson(dbId, link.parentId).catch(() => null);
      if (localParent?.name && namesMatch(localParent.name, link.providerName)) {
        confidence = 1.0;
      }
    }

    const providerUrl =
      link.providerUrl ||
      buildProviderPersonUrl(provider, link.externalId, treeId);
    if (!providerUrl) continue;

    idMappingService.registerExternalId(link.parentId, provider, link.externalId, {
      url: providerUrl,
      confidence,
    });

    augmentationService.addPlatform(link.parentId, provider, providerUrl, link.externalId);
  }
}

export const multiPlatformComparisonService = {
  /**
   * Get provider data from cache or scrape fresh
   */
  async getProviderData(
    personId: string,
    provider: BuiltInProvider,
    forceRefresh = false,
    dbId?: string
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
    logger.browser('compare', `Scraping ${provider} from URL: ${personUrl}`);
    const page = await browserService.createPage();

    if (provider === 'ancestry' && platformRef.url) {
      await page.goto(platformRef.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    const scrapedData = await scraper.scrapePersonById(page, externalId).catch(err => {
      logger.error('compare', `Failed to scrape ${provider}/${externalId}: ${err.message}`);
      return null;
    });

    // Close the page to free resources
    await page.close().catch(() => {});

    if (!scrapedData) {
      return null;
    }

    // Extract tree ID for Ancestry parent URLs
    let treeId: string | undefined;
    if (provider === 'ancestry' && platformRef.url) {
      const treeMatch = platformRef.url.match(/\/tree\/(\d+)/);
      if (treeMatch) treeId = treeMatch[1];
    }

    // Cache parent info (URLs, names, IDs) but do NOT auto-create edges/persons
    // Users must explicitly click "Use" to apply parent links from provider data
    cacheScrapedParentInfo(scrapedData, provider, treeId);

    // Link scraped parent IDs to existing local parent records when possible
    if (dbId) {
      await linkScrapedParentsToLocal(dbId, canonicalId, provider, scrapedData, treeId);
    }

    // Handle provider photo - download new one or clean up stale local copy
    if (scrapedData.photoUrl) {
      const existingAug = augmentationService.getAugmentation(personId);
      if (existingAug) {
        const platform = existingAug.platforms.find(p => p.platform === provider);
        if (platform) {
          // Update photo URL (may have changed)
          platform.photoUrl = scrapedData.photoUrl;
          augmentationService.saveAugmentation(existingAug);
        }
      }

      // Download the photo (force re-download on refresh to get updated content)
      const photoPath = await downloadProviderPhoto(canonicalId, provider, scrapedData.photoUrl, forceRefresh);
      if (photoPath) {
        // Update augmentation photos array - never auto-set as primary
        const aug = augmentationService.getAugmentation(personId);
        if (aug) {
          const existingPhoto = aug.photos.find(p => p.source === provider);
          if (existingPhoto) {
            existingPhoto.localPath = photoPath;
            existingPhoto.url = scrapedData.photoUrl;
          } else {
            aug.photos.push({
              url: scrapedData.photoUrl,
              source: provider,
              localPath: photoPath,
              isPrimary: false, // Never auto-set as primary - user must explicitly "Use"
            });
          }
          augmentationService.saveAugmentation(aug);
        }
      }
    } else if (forceRefresh) {
      // Provider no longer has a photo - remove stale local copy
      const suffix = getPhotoSuffix(provider);
      const jpgPath = path.join(PHOTOS_DIR, `${canonicalId}${suffix}.jpg`);
      const pngPath = path.join(PHOTOS_DIR, `${canonicalId}${suffix}.png`);
      if (fs.existsSync(jpgPath)) {
        fs.unlinkSync(jpgPath);
      }
      if (fs.existsSync(pngPath)) {
        fs.unlinkSync(pngPath);
      }
      // Clean up augmentation photo reference
      const aug = augmentationService.getAugmentation(personId);
      if (aug) {
        const photoIdx = aug.photos.findIndex(p => p.source === provider);
        if (photoIdx >= 0) {
          aug.photos.splice(photoIdx, 1);
          augmentationService.saveAugmentation(aug);
        }
        const platform = aug.platforms.find(p => p.platform === provider);
        if (platform?.photoUrl) {
          platform.photoUrl = undefined;
          augmentationService.saveAugmentation(aug);
        }
      }
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

    // Apply local overrides so comparison uses user's chosen values
    applyLocalOverrides(person, canonicalId);
    const augmentation = augmentationService.getAugmentation(personId);

    // Build provider info list
    const providers: ProviderLinkInfo[] = [];
    const providerData: Record<string, ScrapedPersonData | null> = {};

    for (const providerName of PROVIDERS) {
      const platformRef = augmentation?.platforms?.find(p => p.platform === providerName);
      let isLinked = !!platformRef?.externalId;
      let externalId = platformRef?.externalId;

      // FamilySearch: also check ID mapping as it may not be in augmentation platforms
      if (providerName === 'familysearch' && !isLinked) {
        const fsId = idMappingService.getExternalId(canonicalId, 'familysearch') || person.externalId;
        if (fsId) {
          isLinked = true;
          externalId = fsId;
        }
      }

      const info: ProviderLinkInfo = {
        provider: providerName,
        isLinked,
        externalId,
        url: platformRef?.url,
      };

      if (isLinked && externalId) {
        if (providerName === 'familysearch') {
          // FamilySearch uses special loader that handles raw GEDCOMX format
          const fsData = loadFamilySearchData(externalId);
          if (fsData) {
            info.lastScrapedAt = fsData.scrapedAt;
            // Resolve parent names: try local DB → FS cache → FS API
            if (fsData.scrapedData.fatherExternalId && !fsData.scrapedData.fatherName) {
              fsData.scrapedData.fatherName = await resolveParentName(dbId, fsData.scrapedData.fatherExternalId) ?? undefined;
            }
            if (fsData.scrapedData.motherExternalId && !fsData.scrapedData.motherName) {
              fsData.scrapedData.motherName = await resolveParentName(dbId, fsData.scrapedData.motherExternalId) ?? undefined;
            }
            providerData[providerName] = fsData.scrapedData;
          } else {
            providerData[providerName] = null;
          }
        } else {
          // Standard ProviderCache format
          const cached = getCachedProviderData(providerName, externalId);
          if (cached) {
            info.lastScrapedAt = cached.scrapedAt;
            // Resolve parent names from local DB if scraped data has IDs but no names
            if (cached.scrapedData.fatherExternalId && !cached.scrapedData.fatherName) {
              cached.scrapedData.fatherName = await resolveParentNameByProvider(dbId, cached.scrapedData.fatherExternalId, providerName) ?? undefined;
            }
            if (cached.scrapedData.motherExternalId && !cached.scrapedData.motherName) {
              cached.scrapedData.motherName = await resolveParentNameByProvider(dbId, cached.scrapedData.motherExternalId, providerName) ?? undefined;
            }
            providerData[providerName] = cached.scrapedData;
          } else {
            providerData[providerName] = null;
          }
        }
      } else {
        providerData[providerName] = null;
      }

      providers.push(info);
    }

    // Resolve parent names and build local context
    const localContext: LocalPersonContext = {
      childrenCount: person.children?.length ?? 0,
      occupations: person.occupations,
    };

    if (person.parents?.[0]) {
      localContext.fatherId = person.parents[0];
      const father = await databaseService.getPerson(dbId, person.parents[0]).catch(() => null);
      if (father) localContext.fatherName = father.name;
    }
    if (person.parents?.[1]) {
      localContext.motherId = person.parents[1];
      const mother = await databaseService.getPerson(dbId, person.parents[1]).catch(() => null);
      if (mother) localContext.motherName = mother.name;
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
      const localValue = extractLocalFieldValue(person, fieldDef.fieldName, localContext);

      const providerValues: FieldComparison['providerValues'] = {};

      for (const providerName of PROVIDERS) {
        const data = providerData[providerName];
        let value = extractFieldValue(data, fieldDef.fieldName);

        const cached = providers.find(p => p.provider === providerName && p.isLinked);
        const parentExtId = extractParentExternalId(data, fieldDef.fieldName);
        // Build URL: try scraped parent ID first, then fall back to id-mapping/augmentation
        const url = (parentExtId ? buildProviderParentUrl(providerName, parentExtId) : undefined)
          || resolveParentProviderUrl(localContext, fieldDef.fieldName, providerName);

        // If no value from provider data but URL was resolved (parent is linked to provider),
        // fall back to the local parent name so the UI shows the linked parent
        if (!value && url) {
          if (fieldDef.fieldName === 'fatherName') value = localContext.fatherName ?? null;
          else if (fieldDef.fieldName === 'motherName') value = localContext.motherName ?? null;
        }

        const status = getComparisonStatus(localValue, value);
        providerValues[providerName] = {
          value,
          status,
          lastScrapedAt: cached?.lastScrapedAt,
          url,
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

      // Build local URL for parent fields (links to SparseTree person page)
      let localUrl: string | undefined;
      if (fieldDef.fieldName === 'fatherName' && localContext.fatherId) {
        localUrl = `/person/${dbId}/${localContext.fatherId}`;
      } else if (fieldDef.fieldName === 'motherName' && localContext.motherId) {
        localUrl = `/person/${dbId}/${localContext.motherId}`;
      }

      fields.push({
        fieldName: fieldDef.fieldName,
        label: fieldDef.label,
        localValue,
        localUrl,
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
    return this.getProviderData(personId, provider, true, dbId);
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
