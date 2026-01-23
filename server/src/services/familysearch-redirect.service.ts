/**
 * FamilySearch Redirect/Merge Handler Service
 *
 * Handles detection and resolution of FamilySearch person records that have been
 * deleted or merged. When a person is merged on FamilySearch, the old ID redirects
 * to the surviving person's ID. This service:
 *
 * 1. Detects redirects after browser navigation
 * 2. Extracts the new/surviving FamilySearch ID from the final URL
 * 3. Updates the external_identity mapping to point to the new ID
 * 4. Optionally purges old cached data and fetches fresh data
 *
 * This is a DRY handler used by both photo scraping and profile sync.
 */

import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { idMappingService } from './id-mapping.service.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const PERSON_CACHE_DIR = path.join(DATA_DIR, 'person');

export interface RedirectInfo {
  /** Whether a redirect was detected */
  wasRedirected: boolean;
  /** The original FamilySearch ID that was requested */
  originalFsId: string;
  /** The new/surviving FamilySearch ID after redirect (undefined if no redirect) */
  newFsId?: string;
  /** The canonical ULID for this person */
  canonicalId: string;
  /** Whether this is a deleted/merged person based on page content */
  isDeleted?: boolean;
  /** The surviving person's name (if detected from page) */
  survivingPersonName?: string;
  /** Error message if detection failed */
  error?: string;
}

export interface SyncResult {
  success: boolean;
  redirectInfo?: RedirectInfo;
  /** Whether any data was updated */
  dataUpdated: boolean;
  /** Error message if sync failed */
  error?: string;
}

/**
 * Extract FamilySearch ID from a URL
 * Handles various URL formats:
 * - https://www.familysearch.org/tree/person/details/XXXX-XXX
 * - https://www.familysearch.org/tree/person/XXXX-XXX
 */
function extractFsIdFromUrl(url: string): string | null {
  // Match various FamilySearch URL patterns
  const patterns = [
    /\/tree\/person\/details\/([A-Z0-9-]+)/i,
    /\/tree\/person\/([A-Z0-9-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if the current page shows a deleted/merged person notice
 * FamilySearch shows a specific banner when a person has been merged
 */
async function detectDeletedPersonNotice(page: Page): Promise<{
  isDeleted: boolean;
  survivingPersonName?: string;
  survivingPersonId?: string;
}> {
  const result = await page.evaluate(() => {
    // Look for the "Deleted Person" banner that FamilySearch shows
    const deletedBanner = document.querySelector('[data-testid="person-header-banner"]');
    const deletedHeading = Array.from(document.querySelectorAll('h2, h3')).find(
      el => el.textContent?.toLowerCase().includes('deleted person')
    );

    // Also check for text content indicating deletion
    const bodyText = document.body.innerText.toLowerCase();
    const isDeleted = !!deletedBanner ||
      !!deletedHeading ||
      bodyText.includes('this person was deleted by merge') ||
      bodyText.includes('deleted person') ||
      bodyText.includes('surviving person:');

    // Try to extract surviving person info
    let survivingPersonName: string | undefined;
    let survivingPersonId: string | undefined;

    if (isDeleted) {
      // Strategy 1: Find the paragraph containing "Surviving person:" and get the link inside it
      const paragraphs = document.querySelectorAll('p');
      for (const p of paragraphs) {
        if (p.textContent?.toLowerCase().includes('surviving person')) {
          const link = p.querySelector('a[href*="/tree/person/"]');
          if (link) {
            survivingPersonName = link.textContent?.trim();
            const href = link.getAttribute('href');
            if (href) {
              // Match both /tree/person/details/ID and /en/tree/person/details/ID
              const match = href.match(/\/tree\/person\/(?:details\/)?([A-Z0-9-]+)/i);
              if (match) survivingPersonId = match[1];
            }
            break;
          }
        }
      }

      // Strategy 2: Look for any link to /tree/person/details/ that's not the current person
      if (!survivingPersonId) {
        const currentUrl = window.location.href;
        const currentIdMatch = currentUrl.match(/\/tree\/person\/(?:details\/)?([A-Z0-9-]+)/i);
        const currentId = currentIdMatch ? currentIdMatch[1] : null;

        const links = document.querySelectorAll('a[href*="/tree/person/details/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href) {
            const match = href.match(/\/tree\/person\/(?:details\/)?([A-Z0-9-]+)/i);
            if (match && match[1] !== currentId) {
              survivingPersonId = match[1];
              survivingPersonName = link.textContent?.trim() || survivingPersonName;
              break;
            }
          }
        }
      }

      // Strategy 3: Parse from text pattern "ID numbers: XXX and YYY"
      if (!survivingPersonId) {
        const idMatch = document.body.innerText.match(/ID numbers?:\s*([A-Z0-9-]+)\s+and\s+([A-Z0-9-]+)/i);
        if (idMatch) {
          // The surviving ID is typically the second one, but check which is not the current page
          const currentUrl = window.location.href;
          if (!currentUrl.includes(idMatch[1])) {
            survivingPersonId = idMatch[1];
          } else if (!currentUrl.includes(idMatch[2])) {
            survivingPersonId = idMatch[2];
          }
        }
      }

      // Extract name from text if we still don't have it
      if (!survivingPersonName) {
        const textMatch = document.body.innerText.match(/surviving person:?\s*([^\n]+)/i);
        if (textMatch) {
          survivingPersonName = textMatch[1].trim();
        }
      }
    }

    return { isDeleted, survivingPersonName, survivingPersonId };
  }).catch((err) => {
    console.error('[fs-redirect] Error in page.evaluate:', err);
    return { isDeleted: false };
  });

  return result;
}

/**
 * Detect if a redirect occurred by comparing requested URL with final URL
 */
function detectRedirect(requestedFsId: string, finalUrl: string): {
  wasRedirected: boolean;
  newFsId?: string;
} {
  const finalFsId = extractFsIdFromUrl(finalUrl);

  // Check if the final URL has a different FamilySearch ID
  if (finalFsId && finalFsId.toUpperCase() !== requestedFsId.toUpperCase()) {
    return {
      wasRedirected: true,
      newFsId: finalFsId,
    };
  }

  return { wasRedirected: false };
}

/**
 * Handle a detected redirect/merge by updating ID mappings
 */
function handleRedirectMapping(
  canonicalId: string,
  originalFsId: string,
  newFsId: string
): void {
  console.log(`[fs-redirect] Handling merge: ${originalFsId} -> ${newFsId} (canonical: ${canonicalId})`);

  // Register the new FamilySearch ID to point to our canonical person
  // The old ID will remain in the mapping but this ensures we use the new ID going forward
  idMappingService.registerExternalId(canonicalId, 'familysearch', newFsId, {
    url: `https://www.familysearch.org/tree/person/details/${newFsId}`,
    confidence: 1.0,
  });

  // Keep the old ID mapped too (with lower confidence) for historical reference
  // This allows lookups by either ID to find the same canonical person
  idMappingService.registerExternalId(canonicalId, 'familysearch', originalFsId, {
    url: `https://www.familysearch.org/tree/person/details/${originalFsId}`,
    confidence: 0.5, // Lower confidence indicates this is a deprecated/merged ID
  });
}

/**
 * Purge old cached data for a FamilySearch ID
 */
function purgeCachedData(fsId: string): { jsonPurged: boolean; scrapePurged: boolean } {
  let jsonPurged = false;
  let scrapePurged = false;

  // Purge JSON cache file
  const jsonPath = path.join(PERSON_CACHE_DIR, `${fsId}.json`);
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    jsonPurged = true;
    console.log(`[fs-redirect] Purged JSON cache: ${jsonPath}`);
  }

  // Note: Scrape cache uses canonical ID, not FS ID, so we don't purge it here
  // The scrape data will be updated when rescraping occurs

  return { jsonPurged, scrapePurged };
}

/**
 * Main function to check for and handle FamilySearch redirects after browser navigation
 *
 * Call this after navigating to a FamilySearch person page. It will:
 * 1. Check if the final URL differs from the requested URL (redirect detection)
 * 2. Check if the page shows a "deleted person" notice
 * 3. Update ID mappings if a redirect was detected
 * 4. Optionally purge old cached data
 *
 * @param page - Playwright page after navigation
 * @param requestedFsId - The FamilySearch ID that was originally requested
 * @param canonicalId - The canonical ULID for this person
 * @param options - Configuration options
 */
export async function checkForRedirect(
  page: Page,
  requestedFsId: string,
  canonicalId: string,
  options: {
    /** Whether to purge cached data for the old ID */
    purgeCachedData?: boolean;
  } = {}
): Promise<RedirectInfo> {
  const finalUrl = page.url();

  // Check for URL-based redirect
  const { wasRedirected, newFsId } = detectRedirect(requestedFsId, finalUrl);

  // Check for deleted person notice on page
  const { isDeleted, survivingPersonName, survivingPersonId } = await detectDeletedPersonNotice(page);

  // Determine the actual new ID (from URL redirect or from page content)
  const actualNewFsId = newFsId || survivingPersonId;

  const result: RedirectInfo = {
    wasRedirected: wasRedirected || isDeleted,
    originalFsId: requestedFsId,
    newFsId: actualNewFsId,
    canonicalId,
    isDeleted,
    survivingPersonName,
  };

  // If we detected a redirect/merge, update the mappings
  if (actualNewFsId && actualNewFsId.toUpperCase() !== requestedFsId.toUpperCase()) {
    handleRedirectMapping(canonicalId, requestedFsId, actualNewFsId);

    // Optionally purge old cached data
    if (options.purgeCachedData) {
      purgeCachedData(requestedFsId);
    }

    console.log(`[fs-redirect] Redirect detected and handled: ${requestedFsId} -> ${actualNewFsId}`);
  }

  return result;
}

/**
 * Resolve a FamilySearch person - handles redirects and returns the correct current ID
 *
 * This is a higher-level function that:
 * 1. Navigates to the FamilySearch person page
 * 2. Checks for redirects
 * 3. Returns both the redirect info and whether data needs to be refreshed
 *
 * @param page - Playwright page to use for navigation
 * @param fsId - FamilySearch ID to resolve
 * @param canonicalId - Canonical ULID (if known)
 */
export async function resolveAndCheckPerson(
  page: Page,
  fsId: string,
  canonicalId?: string
): Promise<{
  redirectInfo: RedirectInfo;
  currentFsId: string;
  canonicalId: string;
}> {
  // Get or determine canonical ID
  const resolvedCanonicalId = canonicalId || idMappingService.getCanonicalId('familysearch', fsId) || fsId;

  // Navigate to the person page
  const url = `https://www.familysearch.org/tree/person/details/${fsId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // Give dynamic content time to load

  // Check for redirects
  const redirectInfo = await checkForRedirect(page, fsId, resolvedCanonicalId, {
    purgeCachedData: true,
  });

  // Determine the current (possibly new) FamilySearch ID to use
  const currentFsId = redirectInfo.newFsId || fsId;

  return {
    redirectInfo,
    currentFsId,
    canonicalId: resolvedCanonicalId,
  };
}

/**
 * Get the best FamilySearch ID for a person (handles cases where we have both old and new)
 *
 * When a person has been merged, we may have multiple FamilySearch IDs pointing to them.
 * This function returns the "best" one (the new/surviving ID if we know it).
 */
export function getBestFsId(canonicalId: string): string | undefined {
  // Get all FamilySearch IDs for this person
  const externalIds = idMappingService.getExternalIds(canonicalId);
  const fsId = externalIds.get('familysearch');

  // If we only have one, return it
  if (!fsId) return undefined;

  // Check if we have multiple FamilySearch mappings by querying all
  // For now, just return what we have - the most recently registered one
  // should be the best (newest) one due to how registerExternalId works
  return fsId;
}

export const familysearchRedirectService = {
  checkForRedirect,
  resolveAndCheckPerson,
  extractFsIdFromUrl,
  detectRedirect,
  detectDeletedPersonNotice,
  handleRedirectMapping,
  purgeCachedData,
  getBestFsId,
};
