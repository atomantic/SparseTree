import type { Page } from 'playwright';
import type { PersonAugmentation } from '@fsf/shared';
import { browserService } from './browser.service.js';
import { credentialsService } from './credentials.service.js';
import { getScraper } from './scrapers/index.js';
import { isPlaceholderImage } from './scrapers/base.scraper.js';
import { databaseService } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { augmentationService, registerExternalIdentityIfEnabled } from './augmentation.service.js';
import { logger } from '../lib/logger.js';
import { ensureBrowserConnected } from '../utils/browserConnect.js';
import { fetchHtml } from '../utils/fetchHtml.js';
import { normalizePhotoUrl } from '../utils/normalizePhotoUrl.js';

export interface WikipediaData {
  title: string;
  description: string;
  photoUrl?: string;
}

/**
 * Parse Ancestry URL to extract treeId and personId
 * Format: https://www.ancestry.com/family-tree/person/tree/{treeId}/person/{personId}/facts
 */
export function parseAncestryUrl(url: string): { treeId: string; ancestryPersonId: string } | null {
  const match = url.match(/\/tree\/(\d+)\/person\/(\d+)/);
  if (!match) return null;
  return { treeId: match[1], ancestryPersonId: match[2] };
}

export function parseLinkedInUrl(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Parse WikiTree URL to extract the WikiTree ID
 * Format: https://www.wikitree.com/wiki/Surname-12345
 */
export function parseWikiTreeUrl(url: string): string | null {
  const match = url.match(/wikitree\.com\/wiki\/([A-Za-z]+-\d+)/);
  return match ? match[1] : null;
}

export async function scrapeWikipedia(url: string): Promise<WikipediaData> {
  const html = await fetchHtml(url);
  logger.api('augment', `Fetched ${html.length} bytes from Wikipedia`);

  // Extract title from <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/ - Wikipedia$/, '').trim()
    : 'Unknown';

  // Extract short description
  const shortDescMatch = html.match(/<div class="shortdescription[^"]*"[^>]*>([^<]+)<\/div>/i);
  const shortDesc = shortDescMatch ? shortDescMatch[1].trim() : '';
  logger.data('augment', `Short description: ${shortDesc}`);

  // Extract first paragraph - look for <p> containing <b> (article title)
  let description = shortDesc;
  const contentMatch = html.match(/<div[^>]*class="[^"]*mw-parser-output[^"]*"[^>]*>([\s\S]*?)(?:<div class="mw-heading|<h2|$)/i);

  if (contentMatch) {
    // Find paragraphs with bold text (usually the intro paragraph)
    const paragraphs = contentMatch[1].match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];

    for (const p of paragraphs) {
      // Skip paragraphs that are just coordinates or empty
      if (p.includes('coordinates') || p.length < 50) continue;

      // Strip HTML and check if it has content
      const text = p
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '') // Remove citations
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      if (text.length > 50) {
        description = text;
        break;
      }
    }
  }
  logger.data('augment', `Description: ${description.slice(0, 100)}...`);

  // Extract main image URL
  let photoUrl: string | undefined;

  // Try figure with thumb image
  const figureMatch = html.match(/<figure[^>]*typeof="mw:File\/Thumb"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i);
  if (figureMatch) {
    photoUrl = figureMatch[1];
  }

  // Try infobox image
  if (!photoUrl) {
    const infoboxMatch = html.match(/class="infobox[^"]*"[\s\S]*?<img[^>]*src="([^"]*upload\.wikimedia\.org[^"]+)"[^>]*>/i);
    if (infoboxMatch) {
      photoUrl = infoboxMatch[1];
    }
  }

  // Try any wikimedia image
  if (!photoUrl) {
    const imgMatch = html.match(/<img[^>]*src="([^"]*upload\.wikimedia\.org[^"]+(?:\.jpg|\.jpeg|\.png)[^"]*)"[^>]*>/i);
    if (imgMatch) {
      photoUrl = imgMatch[1];
    }
  }

  if (photoUrl) {
    // Get larger version by removing size constraint
    photoUrl = normalizePhotoUrl(photoUrl, 'wikipedia').replace(/\/\d+px-/, '/500px-');
    logger.photo('augment', `Photo URL: ${photoUrl.slice(0, 100)}`);
  }

  return { title, description, photoUrl };
}

/**
 * Ensure the page is logged in to Ancestry. If redirected to /signin, attempts
 * auto-login with stored credentials and re-navigates to `targetUrl`. Closes
 * the page and throws on any failure.
 */
async function ensureAncestryLoggedIn(page: Page, targetUrl: string): Promise<void> {
  let currentUrl = page.url();
  if (!currentUrl.includes('/signin') && !currentUrl.includes('/login')) return;

  logger.auth('augment', 'Redirected to login page, attempting auto-login...');

  const credentials = credentialsService.getCredentials('ancestry');
  if (!credentials?.password) {
    await page.close();
    throw new Error('Not authenticated to Ancestry. Please save your Ancestry credentials in Settings > Providers, or log in manually in the browser.');
  }

  const username = credentials.email || credentials.username || '';
  logger.auth('augment', `Auto-login triggered: Using saved credentials for ${username}`);

  const scraper = getScraper('ancestry');
  const loginSuccess = await scraper.performLogin(page, username, credentials.password)
    .catch(err => {
      logger.error('augment', `Auto-login failed: ${err.message}`);
      return false;
    });

  if (!loginSuccess) {
    await page.close();
    throw new Error('Auto-login failed. Please check your saved credentials or log in manually.');
  }

  logger.ok('augment', 'Auto-login successful, navigating to person page...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  currentUrl = page.url();
  if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
    await page.close();
    throw new Error('Login requires additional verification. Please log in manually in the browser.');
  }
}

const ANCESTRY_SRCSET_MULTIPLIERS = ['5x', '4x', '3x', '2x', '1.75x', '1.5x', '1.25x', '1x'] as const;

/**
 * Extract the highest-resolution Ancestry profile photo URL from a logged-in page.
 * Returns the raw (non-normalized) URL, or null if no photo is present.
 */
async function extractAncestryPhotoFromPage(page: Page): Promise<string | null> {
  const profilePhotoData = await page.$eval(
    '#profileImage img, [data-testid="usercardimg-element"] img',
    (el) => ({ srcset: el.getAttribute('srcset'), src: el.getAttribute('src') })
  ).catch(() => null);

  if (profilePhotoData?.srcset) {
    const srcsetParts = profilePhotoData.srcset.split(',').map(s => s.trim());
    for (const multiplier of ANCESTRY_SRCSET_MULTIPLIERS) {
      const match = srcsetParts.find(part => part.endsWith(multiplier));
      if (match) {
        return match.replace(new RegExp(`\\s+${multiplier}$`), '').trim();
      }
    }
  }

  return profilePhotoData?.src ?? null;
}

export async function scrapeAncestryPhoto(ancestryUrl: string): Promise<string | undefined> {
  await ensureBrowserConnected('augment');

  const page = await browserService.createPage(ancestryUrl);
  await page.waitForTimeout(3000);

  await ensureAncestryLoggedIn(page, ancestryUrl);

  const rawPhotoUrl = await extractAncestryPhotoFromPage(page);
  await page.close();

  return rawPhotoUrl ? normalizePhotoUrl(rawPhotoUrl, 'ancestry') : undefined;
}

export async function scrapeLinkedIn(url: string): Promise<{ headline?: string; company?: string; photoUrl?: string; profileId: string }> {
  const profileId = parseLinkedInUrl(url);
  if (!profileId) {
    throw new Error('Invalid LinkedIn URL format. Expected: https://www.linkedin.com/in/person-name');
  }

  await ensureBrowserConnected('augment');

  const page = await browserService.createPage(url);
  await page.waitForTimeout(3000);

  // Extract headline (occupation) and photo
  const data = await page.evaluate(() => {
    const result: { headline?: string; company?: string; photoUrl?: string } = {};

    // Headline (usually contains occupation/title)
    const headlineEl = document.querySelector('.text-body-medium, [data-anonymize="headline"], .pv-text-details__left-panel h2');
    if (headlineEl) {
      result.headline = headlineEl.textContent?.trim();
    }

    // Current company
    const companyEl = document.querySelector('[data-anonymize="company-name"], .pv-text-details__right-panel span');
    if (companyEl) {
      result.company = companyEl.textContent?.trim();
    }

    // Profile photo
    const photoEl = document.querySelector('.pv-top-card-profile-picture__image, .profile-photo-edit__preview, img.pv-top-card-profile-picture__image--show') as HTMLImageElement;
    if (photoEl?.src && !photoEl.src.includes('ghost') && !photoEl.src.includes('default')) {
      result.photoUrl = photoEl.src;
    }

    return result;
  }).catch((): { headline?: string; company?: string; photoUrl?: string } => ({}));

  await page.close();

  logger.ok('augment', `Scraped LinkedIn: headline="${data.headline}", company="${data.company}"`);

  return { ...data, profileId };
}

export async function scrapeWikiTree(url: string): Promise<{ title: string; description: string; photoUrl?: string; wikiTreeId: string }> {
  const html = await fetchHtml(url);
  logger.api('augment', `Fetched ${html.length} bytes from WikiTree`);

  // Extract WikiTree ID from URL
  const wikiTreeId = parseWikiTreeUrl(url) || '';

  // Extract title/name from page
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/ \| WikiTree FREE Family Tree$/, '').trim()
    : 'Unknown';

  // Extract birth/death info for description
  let description = '';
  const vitalMatch = html.match(/<span class="VITALS"[^>]*>([^<]+)</i);
  if (vitalMatch) {
    description = vitalMatch[1].trim();
  } else {
    logger.warn('augment', 'WikiTree: Could not extract vital info (VITALS pattern not found)');
  }

  // Extract profile text/bio
  const bioMatch = html.match(/<div class="profile-text"[^>]*>([\s\S]*?)<\/div>/i);
  if (bioMatch) {
    const bioText = bioMatch[1]
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (bioText.length > description.length) {
      description = bioText;
    }
  } else {
    logger.warn('augment', 'WikiTree: Could not extract bio (profile-text pattern not found)');
  }

  // Extract photo URL
  let photoUrl: string | undefined;

  // Try profile image
  const imgMatch = html.match(/<img[^>]*class="[^"]*photo[^"]*"[^>]*src="([^"]+)"[^>]*>/i);
  if (imgMatch) {
    photoUrl = imgMatch[1];
  }

  // Try another pattern for WikiTree photos
  if (!photoUrl) {
    const altImgMatch = html.match(/<img[^>]*src="([^"]*wikitree\.com[^"]*(?:\.jpg|\.jpeg|\.png)[^"]*)"[^>]*>/i);
    if (altImgMatch) {
      photoUrl = altImgMatch[1];
    }
  }

  // Try GEDCOM photo
  if (!photoUrl) {
    const gedcomImgMatch = html.match(/src="(https:\/\/www\.wikitree\.com\/photo\.php[^"]+)"/i);
    if (gedcomImgMatch) {
      photoUrl = gedcomImgMatch[1];
    }
  }

  if (!photoUrl) {
    logger.warn('augment', 'WikiTree: Could not extract photo URL (no photo patterns matched)');
  } else if (isPlaceholderImage(photoUrl)) {
    photoUrl = undefined;
  } else {
    photoUrl = normalizePhotoUrl(photoUrl, 'wikitree');
    logger.photo('augment', `WikiTree Photo URL: ${photoUrl}`);
  }

  return { title, description, photoUrl, wikiTreeId };
}

export async function linkWikipedia(personId: string, wikipediaUrl: string): Promise<PersonAugmentation> {
  logger.start('augment', `Linking Wikipedia for ${personId}: ${wikipediaUrl}`);

  const wikiData = await scrapeWikipedia(wikipediaUrl);
  logger.ok('augment', `Scraped Wikipedia: ${wikiData.title}`);

  const existing = augmentationService.getOrCreate(personId);

  const existingPlatform = existing.platforms.find(p => p.platform === 'wikipedia');
  if (existingPlatform) {
    existingPlatform.url = wikipediaUrl;
    existingPlatform.linkedAt = new Date().toISOString();
  } else {
    existing.platforms.push({
      platform: 'wikipedia',
      url: wikipediaUrl,
      linkedAt: new Date().toISOString(),
    });
  }

  const existingDesc = existing.descriptions.find(d => d.source === 'wikipedia');
  if (existingDesc) {
    existingDesc.text = wikiData.description;
  } else if (wikiData.description) {
    existing.descriptions.push({
      text: wikiData.description,
      source: 'wikipedia',
      language: 'en',
    });
  }

  // Store photo URL reference (but don't download - user can fetch manually)
  if (wikiData.photoUrl) {
    const existingPlatformRef = existing.platforms.find(p => p.platform === 'wikipedia');
    if (existingPlatformRef) {
      existingPlatformRef.photoUrl = wikiData.photoUrl;
    }
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}

export async function linkAncestry(personId: string, ancestryUrl: string): Promise<PersonAugmentation> {
  logger.start('augment', `Linking Ancestry for ${personId}: ${ancestryUrl}`);

  const parsed = parseAncestryUrl(ancestryUrl);
  if (!parsed) {
    throw new Error('Invalid Ancestry URL format. Expected: https://www.ancestry.com/family-tree/person/tree/{treeId}/person/{personId}/facts');
  }

  await ensureBrowserConnected('augment');

  const page = await browserService.createPage(ancestryUrl);
  await page.waitForTimeout(3000); // Wait for page to load

  await ensureAncestryLoggedIn(page, ancestryUrl);

  let photoUrl: string | null = await extractAncestryPhotoFromPage(page);
  if (photoUrl) logger.photo('augment', `Found Ancestry photo: ${photoUrl}`);

  // Fallback selectors if primary didn't work
  if (!photoUrl) {
    const fallbackSelectors = [
      '.personPhoto img',
      '.person-photo img',
      '[data-test="person-photo"] img',
      '.profilePhoto img',
      '.profile-photo img',
      '.userCardImg img'
    ];

    for (const selector of fallbackSelectors) {
      const photoSrc = await page.$eval(selector, el => el.getAttribute('src')).catch(() => null);
      if (photoSrc && !isPlaceholderImage(photoSrc)) {
        photoUrl = photoSrc;
        logger.photo('augment', `Found Ancestry photo via fallback: ${photoUrl}`);
        break;
      }
    }
  }

  if (photoUrl) {
    photoUrl = normalizePhotoUrl(photoUrl, 'ancestry');
  }

  const scraper = getScraper('ancestry');
  let parentData: { fatherId?: string; motherId?: string; fatherName?: string; motherName?: string } = {};
  if (scraper.extractParentIds) {
    parentData = await scraper.extractParentIds(page, parsed.ancestryPersonId).catch(err => {
      logger.warn('augment', `Failed to extract parent IDs: ${err.message}`);
      return { fatherId: undefined, motherId: undefined, fatherName: undefined, motherName: undefined };
    });
  }

  logger.data('augment', `Extracted parents: father=${parentData.fatherId}(${parentData.fatherName}), mother=${parentData.motherId}(${parentData.motherName})`);

  await page.close();

  // Get the canonical ID for this person (must exist since we're linking to them)
  const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

  if (parentData.fatherId || parentData.motherId) {
    const createParentLink = (
      parentExternalId: string,
      parentName: string | undefined,
      parentRole: 'father' | 'mother'
    ) => {
      const parentUrl = `https://www.ancestry.com/family-tree/person/tree/${parsed.treeId}/person/${parentExternalId}/facts`;

      let parentCanonicalId = idMappingService.getCanonicalId('ancestry', parentExternalId);

      if (!parentCanonicalId) {
        parentCanonicalId = idMappingService.createPerson(
          parentName || `Unknown ${parentRole}`,
          'ancestry',
          parentExternalId,
          {
            gender: parentRole === 'father' ? 'male' : 'female',
            url: parentUrl,
          }
        );
        logger.done('augment', `Created new person for ${parentRole}: ${parentName || 'Unknown'} (${parentCanonicalId})`);
      } else {
        idMappingService.registerExternalId(parentCanonicalId, 'ancestry', parentExternalId, {
          url: parentUrl,
        });
        logger.data('augment', `Found existing person for ${parentRole}: ${parentCanonicalId}`);
      }

      if (databaseService.isSqliteEnabled()) {
        sqliteService.run(
          `INSERT OR IGNORE INTO parent_edge (child_id, parent_id, parent_role, source)
           VALUES (@childId, @parentId, @parentRole, 'ancestry')`,
          {
            childId: canonicalId,
            parentId: parentCanonicalId,
            parentRole,
          }
        );
        logger.done('augment', `Linked ${parentRole} edge: ${canonicalId} -> ${parentCanonicalId}`);
      }

      augmentationService.addPlatform(parentCanonicalId, 'ancestry', parentUrl, parentExternalId);

      return parentCanonicalId;
    };

    if (parentData.fatherId) {
      createParentLink(parentData.fatherId, parentData.fatherName, 'father');
    }
    if (parentData.motherId) {
      createParentLink(parentData.motherId, parentData.motherName, 'mother');
    }
  }

  const existing = augmentationService.getOrCreate(personId);

  const existingPlatform = existing.platforms.find(p => p.platform === 'ancestry');
  if (existingPlatform) {
    existingPlatform.url = ancestryUrl;
    existingPlatform.externalId = parsed.ancestryPersonId;
    existingPlatform.linkedAt = new Date().toISOString();
    if (photoUrl) existingPlatform.photoUrl = photoUrl;
  } else {
    existing.platforms.push({
      platform: 'ancestry',
      url: ancestryUrl,
      externalId: parsed.ancestryPersonId,
      linkedAt: new Date().toISOString(),
      photoUrl: photoUrl || undefined,
    });
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);

  registerExternalIdentityIfEnabled(personId, 'ancestry', parsed.ancestryPersonId, ancestryUrl);

  return existing;
}

export async function linkLinkedIn(personId: string, linkedInUrl: string): Promise<PersonAugmentation> {
  logger.start('augment', `Linking LinkedIn for ${personId}: ${linkedInUrl}`);

  const profileId = parseLinkedInUrl(linkedInUrl);
  if (!profileId) {
    throw new Error('Invalid LinkedIn URL format. Expected: https://www.linkedin.com/in/person-name');
  }

  const linkedInData = await scrapeLinkedIn(linkedInUrl);
  logger.ok('augment', `Scraped LinkedIn: ${linkedInData.headline || 'no headline'}`);

  const existing = augmentationService.getOrCreate(personId);

  const existingPlatform = existing.platforms.find(p => p.platform === 'linkedin');
  if (existingPlatform) {
    existingPlatform.url = linkedInUrl;
    existingPlatform.externalId = profileId;
    existingPlatform.linkedAt = new Date().toISOString();
    if (linkedInData.photoUrl) existingPlatform.photoUrl = linkedInData.photoUrl;
  } else {
    existing.platforms.push({
      platform: 'linkedin',
      url: linkedInUrl,
      externalId: profileId,
      linkedAt: new Date().toISOString(),
      photoUrl: linkedInData.photoUrl,
    });
  }

  if (linkedInData.headline) {
    const existingDesc = existing.descriptions.find(d => d.source === 'linkedin');
    if (existingDesc) {
      existingDesc.text = linkedInData.headline;
    } else {
      existing.descriptions.push({
        text: linkedInData.headline,
        source: 'linkedin',
        language: 'en',
      });
    }
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}

export async function linkWikiTree(personId: string, wikiTreeUrl: string): Promise<PersonAugmentation> {
  logger.start('augment', `Linking WikiTree for ${personId}: ${wikiTreeUrl}`);

  const wikiTreeId = parseWikiTreeUrl(wikiTreeUrl);
  if (!wikiTreeId) {
    throw new Error('Invalid WikiTree URL format. Expected: https://www.wikitree.com/wiki/Surname-12345');
  }

  const wikiTreeData = await scrapeWikiTree(wikiTreeUrl);
  logger.ok('augment', `Scraped WikiTree: ${wikiTreeData.title}`);

  const existing = augmentationService.getOrCreate(personId);

  const existingPlatform = existing.platforms.find(p => p.platform === 'wikitree');
  if (existingPlatform) {
    existingPlatform.url = wikiTreeUrl;
    existingPlatform.externalId = wikiTreeId;
    existingPlatform.linkedAt = new Date().toISOString();
    if (wikiTreeData.photoUrl) existingPlatform.photoUrl = wikiTreeData.photoUrl;
  } else {
    existing.platforms.push({
      platform: 'wikitree',
      url: wikiTreeUrl,
      externalId: wikiTreeId,
      linkedAt: new Date().toISOString(),
      photoUrl: wikiTreeData.photoUrl,
    });
  }

  if (wikiTreeData.description) {
    const existingDesc = existing.descriptions.find(d => d.source === 'wikitree');
    if (existingDesc) {
      existingDesc.text = wikiTreeData.description;
    } else {
      existing.descriptions.push({
        text: wikiTreeData.description,
        source: 'wikitree',
        language: 'en',
      });
    }
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}
