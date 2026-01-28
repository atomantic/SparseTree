import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import type { PersonAugmentation, PlatformReference, PersonPhoto, PersonDescription, PlatformType, ProviderPersonMapping } from '@fsf/shared';
import { browserService } from './browser.service.js';
import { credentialsService } from './credentials.service.js';
import { getScraper } from './scrapers/index.js';
import { databaseService } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// Ensure directories exist
if (!fs.existsSync(AUGMENT_DIR)) fs.mkdirSync(AUGMENT_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// Legacy interface for migration
interface LegacyAugmentation {
  id: string;
  wikipediaUrl?: string;
  wikipediaTitle?: string;
  wikipediaDescription?: string;
  wikipediaPhotoUrl?: string;
  customPhotoUrl?: string;
  customDescription?: string;
  updatedAt: string;
}

export interface WikipediaData {
  title: string;
  description: string;
  photoUrl?: string;
}

/**
 * Migrate legacy augmentation to new format
 */
function migrateAugmentation(legacy: LegacyAugmentation): PersonAugmentation {
  const augmentation: PersonAugmentation = {
    id: legacy.id,
    platforms: [],
    photos: [],
    descriptions: [],
    updatedAt: legacy.updatedAt,
  };

  // Migrate Wikipedia data
  if (legacy.wikipediaUrl) {
    augmentation.platforms.push({
      platform: 'wikipedia',
      url: legacy.wikipediaUrl,
      linkedAt: legacy.updatedAt,
    });

    if (legacy.wikipediaPhotoUrl) {
      augmentation.photos.push({
        url: legacy.wikipediaPhotoUrl,
        source: 'wikipedia',
        isPrimary: true,
      });
    }

    if (legacy.wikipediaDescription) {
      augmentation.descriptions.push({
        text: legacy.wikipediaDescription,
        source: 'wikipedia',
        language: 'en',
      });
    }
  }

  // Migrate custom data
  if (legacy.customPhotoUrl) {
    augmentation.customPhotoUrl = legacy.customPhotoUrl;
  }
  if (legacy.customDescription) {
    augmentation.customBio = legacy.customDescription;
  }

  return augmentation;
}

/**
 * Check if augmentation is in legacy format
 */
function isLegacyFormat(data: unknown): data is LegacyAugmentation {
  const obj = data as Record<string, unknown>;
  // Legacy format has wikipediaUrl but not platforms array
  return obj && 'wikipediaUrl' in obj && !('platforms' in obj);
}

/**
 * Register an external identity in SQLite if enabled
 */
function registerExternalIdentityIfEnabled(
  personId: string,  // FamilySearch ID
  platform: PlatformType,
  externalId: string | undefined,
  url: string
): void {
  if (!databaseService.isSqliteEnabled()) return;
  if (!externalId) return;  // No external ID to register

  // Get canonical ID for this person
  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register the external identity
  idMappingService.registerExternalId(canonicalId, platform, externalId, { url });
}

/**
 * Register a provider mapping in SQLite if enabled
 */
function registerProviderMappingIfEnabled(
  personId: string,  // FamilySearch ID
  provider: string,
  externalId: string | undefined,
  matchMethod: string = 'manual',
  confidence: number = 1.0
): void {
  if (!databaseService.isSqliteEnabled()) return;

  // Get canonical ID for this person
  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register in provider_mapping table
  sqliteService.run(
    `INSERT OR REPLACE INTO provider_mapping (person_id, provider, account_id, match_method, match_confidence)
     VALUES (@personId, @provider, @accountId, @matchMethod, @confidence)`,
    {
      personId: canonicalId,
      provider,
      accountId: externalId ?? null,
      matchMethod,
      confidence,
    }
  );
}

function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'FamilySearchFinder/1.0 (https://github.com/atomantic/FamilySearchFinder)'
      }
    };

    const file = fs.createWriteStream(destPath);

    protocol.get(options, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
          downloadImage(fullRedirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
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

export const augmentationService = {
  getAugmentation(personId: string): PersonAugmentation | null {
    // Try direct lookup first
    let filePath = path.join(AUGMENT_DIR, `${personId}.json`);

    if (!fs.existsSync(filePath)) {
      // If personId looks like a canonical ULID, try to find the FamilySearch ID
      if (personId.length === 26 && /^[0-9A-Z]+$/.test(personId)) {
        const externalId = idMappingService.getExternalId(personId, 'familysearch');
        if (externalId) {
          filePath = path.join(AUGMENT_DIR, `${externalId}.json`);
        }
      } else {
        // Maybe it's a FamilySearch ID, try to find canonical and then back to FS ID
        // (in case augmentation was saved with canonical ID)
        const canonicalId = idMappingService.resolveId(personId, 'familysearch');
        if (canonicalId && canonicalId !== personId) {
          filePath = path.join(AUGMENT_DIR, `${canonicalId}.json`);
        }
      }
    }

    if (!fs.existsSync(filePath)) return null;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Migrate legacy format if needed
    if (isLegacyFormat(data)) {
      const migrated = migrateAugmentation(data);
      // Save migrated version
      this.saveAugmentation(migrated);
      return migrated;
    }

    return data as PersonAugmentation;
  },

  saveAugmentation(data: PersonAugmentation): void {
    const filePath = path.join(AUGMENT_DIR, `${data.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  },

  /**
   * Add or update a platform reference
   */
  addPlatform(personId: string, platform: PlatformType, url: string, externalId?: string): PersonAugmentation {
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Check if platform already linked
    const existingPlatform = existing.platforms.find(p => p.platform === platform);
    if (existingPlatform) {
      existingPlatform.url = url;
      if (externalId) existingPlatform.externalId = externalId;
      existingPlatform.linkedAt = new Date().toISOString();
    } else {
      existing.platforms.push({
        platform,
        url,
        externalId,
        linkedAt: new Date().toISOString(),
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);

    // Also register in SQLite external_identity
    registerExternalIdentityIfEnabled(personId, platform, externalId, url);

    return existing;
  },

  /**
   * Add a photo from a source
   */
  addPhoto(personId: string, url: string, source: string, isPrimary = false, localPath?: string): PersonAugmentation {
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // If setting as primary, unset other primary photos
    if (isPrimary) {
      existing.photos.forEach(p => p.isPrimary = false);
    }

    // Check if photo from this source already exists
    const existingPhoto = existing.photos.find(p => p.source === source);
    if (existingPhoto) {
      existingPhoto.url = url;
      existingPhoto.isPrimary = isPrimary;
      if (localPath) existingPhoto.localPath = localPath;
    } else {
      existing.photos.push({
        url,
        source,
        isPrimary,
        localPath,
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Add a description from a source
   */
  addDescription(personId: string, text: string, source: string, language = 'en'): PersonAugmentation {
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Check if description from this source already exists
    const existingDesc = existing.descriptions.find(d => d.source === source);
    if (existingDesc) {
      existingDesc.text = text;
      existingDesc.language = language;
    } else {
      existing.descriptions.push({
        text,
        source,
        language,
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  async scrapeWikipedia(url: string): Promise<WikipediaData> {
    // Fetch Wikipedia page HTML with proper headers
    const html = await new Promise<string>((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FamilySearchFinder/1.0)',
          'Accept': 'text/html'
        }
      };

      const doFetch = (targetUrl: string) => {
        https.get(targetUrl, options, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              doFetch(redirectUrl.startsWith('http') ? redirectUrl : `https:${redirectUrl}`);
              return;
            }
          }
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => resolve(data));
        }).on('error', reject);
      };

      doFetch(url);
    });

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
      const infoboxMatch = html.match(/class="infobox[^"]*"[\s\S]*?<img[^>]*src="([^"]+upload\.wikimedia\.org[^"]+)"[^>]*>/i);
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

    // Normalize photo URL
    if (photoUrl) {
      if (photoUrl.startsWith('//')) {
        photoUrl = 'https:' + photoUrl;
      }
      // Get larger version by removing size constraint
      photoUrl = photoUrl.replace(/\/\d+px-/, '/500px-');
      logger.photo('augment', `Photo URL: ${photoUrl.slice(0, 100)}`);
    }

    return { title, description, photoUrl };
  },

  async linkWikipedia(personId: string, wikipediaUrl: string): Promise<PersonAugmentation> {
    logger.start('augment', `Linking Wikipedia for ${personId}: ${wikipediaUrl}`);

    // Scrape Wikipedia data
    const wikiData = await this.scrapeWikipedia(wikipediaUrl);
    logger.ok('augment', `Scraped Wikipedia: ${wikiData.title}`);

    // Get existing augmentation or create new
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Add or update Wikipedia platform reference
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

    // Add or update Wikipedia description
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
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Get primary photo for a person
   */
  getPrimaryPhoto(personId: string): PersonPhoto | null {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return null;

    // First try to find explicitly marked primary photo
    const primary = augmentation.photos.find(p => p.isPrimary);
    if (primary) return primary;

    // Fall back to first photo
    return augmentation.photos[0] || null;
  },

  /**
   * Get primary description for a person
   */
  getPrimaryDescription(personId: string): PersonDescription | null {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return null;

    // Prefer custom bio
    if (augmentation.customBio) {
      return { text: augmentation.customBio, source: 'custom' };
    }

    // Return first description
    return augmentation.descriptions[0] || null;
  },

  getWikiPhotoPath(personId: string): string | null {
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-wiki.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-wiki.png`);
    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  },

  hasWikiPhoto(personId: string): boolean {
    return this.getWikiPhotoPath(personId) !== null;
  },

  getAncestryPhotoPath(personId: string): string | null {
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-ancestry.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-ancestry.png`);
    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  },

  hasAncestryPhoto(personId: string): boolean {
    return this.getAncestryPhotoPath(personId) !== null;
  },

  /**
   * Parse Ancestry URL to extract treeId and personId
   * Format: https://www.ancestry.com/family-tree/person/tree/{treeId}/person/{personId}/facts
   */
  parseAncestryUrl(url: string): { treeId: string; ancestryPersonId: string } | null {
    const match = url.match(/\/tree\/(\d+)\/person\/(\d+)/);
    if (!match) return null;
    return { treeId: match[1], ancestryPersonId: match[2] };
  },

  /**
   * Scrape just the photo URL from an Ancestry page using the browser
   */
  async scrapeAncestryPhoto(ancestryUrl: string): Promise<string | undefined> {
    // Auto-connect to browser if not connected
    if (!browserService.isConnected()) {
      logger.browser('augment', 'Browser not connected, attempting to connect...');
      const isRunning = await browserService.checkBrowserRunning();

      if (!isRunning) {
        logger.browser('augment', 'Browser not running, launching...');
        const launchResult = await browserService.launchBrowser();
        if (!launchResult.success) {
          throw new Error(`Failed to launch browser: ${launchResult.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      await browserService.connect().catch(err => {
        throw new Error(`Failed to connect to browser: ${err.message}`);
      });
    }

    const page = await browserService.createPage(ancestryUrl);
    await page.waitForTimeout(3000);

    // Check if redirected to login
    let currentUrl = page.url();
    if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
      const credentials = credentialsService.getCredentials('ancestry');
      if (credentials?.password) {
        const username = credentials.email || credentials.username || '';
        const scraper = getScraper('ancestry');
        const loginSuccess = await scraper.performLogin(page, username, credentials.password).catch(() => false);

        if (loginSuccess) {
          await page.goto(ancestryUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          currentUrl = page.url();
          if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
            await page.close();
            throw new Error('Login requires additional verification. Please log in manually.');
          }
        } else {
          await page.close();
          throw new Error('Auto-login failed. Please check credentials or log in manually.');
        }
      } else {
        await page.close();
        throw new Error('Not authenticated to Ancestry. Please save credentials or log in manually.');
      }
    }

    // Extract photo URL
    let photoUrl: string | undefined;

    const profilePhotoData = await page.$eval(
      '#profileImage img, [data-testid="usercardimg-element"] img',
      (el) => {
        const srcset = el.getAttribute('srcset');
        const src = el.getAttribute('src');
        return { srcset, src };
      }
    ).catch(() => null);

    if (profilePhotoData?.srcset) {
      const srcsetParts = profilePhotoData.srcset.split(',').map(s => s.trim());
      for (const multiplier of ['5x', '4x', '3x', '2x', '1.75x', '1.5x', '1.25x', '1x']) {
        const match = srcsetParts.find(part => part.endsWith(multiplier));
        if (match) {
          photoUrl = match.replace(new RegExp(`\\s+${multiplier}$`), '').trim();
          break;
        }
      }
    }

    if (!photoUrl && profilePhotoData?.src) {
      photoUrl = profilePhotoData.src;
    }

    await page.close();

    if (photoUrl) {
      if (photoUrl.startsWith('//')) photoUrl = 'https:' + photoUrl;
      else if (photoUrl.startsWith('/')) photoUrl = 'https://www.ancestry.com' + photoUrl;
    }

    return photoUrl;
  },

  async linkAncestry(personId: string, ancestryUrl: string): Promise<PersonAugmentation> {
    logger.start('augment', `Linking Ancestry for ${personId}: ${ancestryUrl}`);

    // Parse the Ancestry URL
    const parsed = this.parseAncestryUrl(ancestryUrl);
    if (!parsed) {
      throw new Error('Invalid Ancestry URL format. Expected: https://www.ancestry.com/family-tree/person/tree/{treeId}/person/{personId}/facts');
    }

    // Auto-connect to browser if not connected
    if (!browserService.isConnected()) {
      logger.browser('augment', 'Browser not connected, attempting to connect...');
      const isRunning = await browserService.checkBrowserRunning();

      if (!isRunning) {
        logger.browser('augment', 'Browser not running, launching...');
        const launchResult = await browserService.launchBrowser();
        if (!launchResult.success) {
          throw new Error(`Failed to launch browser: ${launchResult.message}`);
        }
        // Wait a bit for browser to fully start
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Now connect to the browser
      await browserService.connect().catch(err => {
        throw new Error(`Failed to connect to browser: ${err.message}`);
      });
      logger.ok('augment', 'Browser connected successfully');
    }

    // Get or create page
    const page = await browserService.createPage(ancestryUrl);
    await page.waitForTimeout(3000); // Wait for page to load

    // Check if redirected to login
    let currentUrl = page.url();
    if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
      logger.auth('augment', 'Redirected to login page, attempting auto-login...');

      // Check for saved credentials
      const credentials = credentialsService.getCredentials('ancestry');
      if (credentials?.password) {
        const username = credentials.email || credentials.username || '';
        logger.auth('augment', `Auto-login triggered: Using saved credentials for ${username}`);

        const scraper = getScraper('ancestry');
        const loginSuccess = await scraper.performLogin(page, username, credentials.password)
          .catch(err => {
            logger.error('augment', `Auto-login failed: ${err.message}`);
            return false;
          });

        if (loginSuccess) {
          logger.ok('augment', 'Auto-login successful, navigating to person page...');
          // Navigate back to the person page after login
          await page.goto(ancestryUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          currentUrl = page.url();

          // Check if still on login page (might need 2FA or other verification)
          if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
            await page.close();
            throw new Error('Login requires additional verification. Please log in manually in the browser.');
          }
        } else {
          await page.close();
          throw new Error('Auto-login failed. Please check your saved credentials or log in manually.');
        }
      } else {
        await page.close();
        throw new Error('Not authenticated to Ancestry. Please save your Ancestry credentials in Settings > Providers, or log in manually in the browser.');
      }
    }

    // Extract photo URL from page
    let photoUrl: string | null = null;

    // Primary selector: Ancestry profile image with srcset (get highest resolution)
    const profilePhotoData = await page.$eval(
      '#profileImage img, [data-testid="usercardimg-element"] img',
      (el) => {
        const srcset = el.getAttribute('srcset');
        const src = el.getAttribute('src');
        return { srcset, src };
      }
    ).catch(() => null);

    if (profilePhotoData) {
      // Parse srcset to get highest resolution (look for 5x, 4x, 3x, etc.)
      if (profilePhotoData.srcset) {
        const srcsetParts = profilePhotoData.srcset.split(',').map(s => s.trim());
        // Find highest resolution (5x > 4x > 3x > 2x > 1x)
        for (const multiplier of ['5x', '4x', '3x', '2x', '1.75x', '1.5x', '1.25x', '1x']) {
          const match = srcsetParts.find(part => part.endsWith(multiplier));
          if (match) {
            photoUrl = match.replace(new RegExp(`\\s+${multiplier}$`), '').trim();
            logger.photo('augment', `Found Ancestry photo from srcset (${multiplier}): ${photoUrl}`);
            break;
          }
        }
      }
      // Fall back to src if srcset parsing failed
      if (!photoUrl && profilePhotoData.src) {
        photoUrl = profilePhotoData.src;
        logger.photo('augment', `Found Ancestry photo from src: ${photoUrl}`);
      }
    }

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
        if (photoSrc && !photoSrc.includes('default') && !photoSrc.includes('silhouette') && !photoSrc.includes('placeholder')) {
          photoUrl = photoSrc;
          logger.photo('augment', `Found Ancestry photo via fallback: ${photoUrl}`);
          break;
        }
      }
    }

    // Normalize URL
    if (photoUrl) {
      if (photoUrl.startsWith('//')) {
        photoUrl = 'https:' + photoUrl;
      } else if (photoUrl.startsWith('/')) {
        photoUrl = 'https://www.ancestry.com' + photoUrl;
      }
    }

    // Extract parent IDs from the page before closing
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

    // Create parent records and edges if parents were found
    if (parentData.fatherId || parentData.motherId) {
      // Create parent records and edges
      const createParentLink = (
        parentExternalId: string,
        parentName: string | undefined,
        parentRole: 'father' | 'mother'
      ) => {
        // Build parent URL
        const parentUrl = `https://www.ancestry.com/family-tree/person/tree/${parsed.treeId}/person/${parentExternalId}/facts`;

        // Check if we already have a canonical ID for this Ancestry person
        let parentCanonicalId = idMappingService.getCanonicalId('ancestry', parentExternalId);

        if (!parentCanonicalId) {
          // Create a new person record for this parent
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
          // Person exists, just ensure the external ID is registered
          idMappingService.registerExternalId(parentCanonicalId, 'ancestry', parentExternalId, {
            url: parentUrl,
          });
          logger.data('augment', `Found existing person for ${parentRole}: ${parentCanonicalId}`);
        }

        // Create parent_edge linking child to parent (if it doesn't exist)
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

        // Also add platform reference for the parent in augmentation data
        this.addPlatform(parentCanonicalId, 'ancestry', parentUrl, parentExternalId);

        return parentCanonicalId;
      };

      if (parentData.fatherId) {
        createParentLink(parentData.fatherId, parentData.fatherName, 'father');
      }
      if (parentData.motherId) {
        createParentLink(parentData.motherId, parentData.motherName, 'mother');
      }
    }

    // Get existing augmentation or create new
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Add or update Ancestry platform reference
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
    this.saveAugmentation(existing);

    // Also register external identity in SQLite for the main person
    registerExternalIdentityIfEnabled(personId, 'ancestry', parsed.ancestryPersonId, ancestryUrl);

    return existing;
  },

  getWikiTreePhotoPath(personId: string): string | null {
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-wikitree.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-wikitree.png`);
    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  },

  hasWikiTreePhoto(personId: string): boolean {
    return this.getWikiTreePhotoPath(personId) !== null;
  },

  getLinkedInPhotoPath(personId: string): string | null {
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-linkedin.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-linkedin.png`);
    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  },

  hasLinkedInPhoto(personId: string): boolean {
    return this.getLinkedInPhotoPath(personId) !== null;
  },

  getFamilySearchPhotoPath(personId: string): string | null {
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-familysearch.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-familysearch.png`);
    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  },

  hasFamilySearchPhoto(personId: string): boolean {
    return this.getFamilySearchPhotoPath(personId) !== null;
  },

  parseLinkedInUrl(url: string): string | null {
    const match = url.match(/linkedin\.com\/in\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  /**
   * Parse FamilySearch URL to extract the person ID
   * Format: https://www.familysearch.org/tree/person/details/XXXX-XXX
   */
  parseFamilySearchUrl(url: string): string | null {
    const match = url.match(/familysearch\.org\/tree\/person\/(?:details|vitals|sources|memories)\/([A-Z0-9-]+)/i);
    return match ? match[1] : null;
  },

  /**
   * Link a FamilySearch profile to a person
   * This registers FamilySearch as an augmentation platform like other providers
   */
  async linkFamilySearch(personId: string, familySearchUrl: string): Promise<PersonAugmentation> {
    logger.start('augment', `Linking FamilySearch for ${personId}: ${familySearchUrl}`);

    const familySearchId = this.parseFamilySearchUrl(familySearchUrl);
    if (!familySearchId) {
      throw new Error('Invalid FamilySearch URL format. Expected: https://www.familysearch.org/tree/person/details/XXXX-XXX');
    }

    // Get existing augmentation or create new
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Add or update FamilySearch platform reference
    const existingPlatform = existing.platforms.find(p => p.platform === 'familysearch');
    if (existingPlatform) {
      existingPlatform.url = familySearchUrl;
      existingPlatform.externalId = familySearchId;
      existingPlatform.linkedAt = new Date().toISOString();
    } else {
      existing.platforms.push({
        platform: 'familysearch',
        url: familySearchUrl,
        externalId: familySearchId,
        linkedAt: new Date().toISOString(),
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);

    // Also register external identity in SQLite
    registerExternalIdentityIfEnabled(personId, 'familysearch', familySearchId, familySearchUrl);

    logger.ok('augment', `Linked FamilySearch ${familySearchId} to ${personId}`);

    return existing;
  },

  async scrapeLinkedIn(url: string): Promise<{ headline?: string; company?: string; photoUrl?: string; profileId: string }> {
    const profileId = this.parseLinkedInUrl(url);
    if (!profileId) {
      throw new Error('Invalid LinkedIn URL format. Expected: https://www.linkedin.com/in/person-name');
    }

    // Auto-connect to browser if not connected
    if (!browserService.isConnected()) {
      logger.browser('augment', 'Browser not connected, attempting to connect...');
      const isRunning = await browserService.checkBrowserRunning();

      if (!isRunning) {
        logger.browser('augment', 'Browser not running, launching...');
        const launchResult = await browserService.launchBrowser();
        if (!launchResult.success) {
          throw new Error(`Failed to launch browser: ${launchResult.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      await browserService.connect().catch(err => {
        throw new Error(`Failed to connect to browser: ${err.message}`);
      });
    }

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
  },

  async linkLinkedIn(personId: string, linkedInUrl: string): Promise<PersonAugmentation> {
    logger.start('augment', `🔗 Linking LinkedIn for ${personId}: ${linkedInUrl}`);

    const profileId = this.parseLinkedInUrl(linkedInUrl);
    if (!profileId) {
      throw new Error('Invalid LinkedIn URL format. Expected: https://www.linkedin.com/in/person-name');
    }

    // Scrape LinkedIn data
    const linkedInData = await this.scrapeLinkedIn(linkedInUrl);
    logger.ok('augment', `📋 Scraped LinkedIn: ${linkedInData.headline || 'no headline'}`);

    // Get existing augmentation or create new
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Add or update LinkedIn platform reference
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

    // Add or update LinkedIn description (headline as description)
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
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Parse WikiTree URL to extract the WikiTree ID
   * Format: https://www.wikitree.com/wiki/Surname-12345
   */
  parseWikiTreeUrl(url: string): string | null {
    const match = url.match(/wikitree\.com\/wiki\/([A-Za-z]+-\d+)/);
    return match ? match[1] : null;
  },

  async scrapeWikiTree(url: string): Promise<{ title: string; description: string; photoUrl?: string; wikiTreeId: string }> {
    // Fetch WikiTree page HTML
    const html = await new Promise<string>((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FamilySearchFinder/1.0)',
          'Accept': 'text/html'
        }
      };

      const doFetch = (targetUrl: string) => {
        https.get(targetUrl, options, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              doFetch(redirectUrl.startsWith('http') ? redirectUrl : `https:${redirectUrl}`);
              return;
            }
          }
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => resolve(data));
        }).on('error', reject);
      };

      doFetch(url);
    });

    logger.api('augment', `Fetched ${html.length} bytes from WikiTree`);

    // Extract WikiTree ID from URL
    const wikiTreeId = this.parseWikiTreeUrl(url) || '';

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
    }

    // Normalize photo URL
    if (photoUrl) {
      if (photoUrl.startsWith('//')) {
        photoUrl = 'https:' + photoUrl;
      } else if (photoUrl.startsWith('/')) {
        photoUrl = 'https://www.wikitree.com' + photoUrl;
      }
      // Filter out default/placeholder images
      if (photoUrl.includes('default') || photoUrl.includes('silhouette')) {
        photoUrl = undefined;
      }
      logger.photo('augment', `WikiTree Photo URL: ${photoUrl}`);
    }

    return { title, description, photoUrl, wikiTreeId };
  },

  async linkWikiTree(personId: string, wikiTreeUrl: string): Promise<PersonAugmentation> {
    logger.start('augment', `Linking WikiTree for ${personId}: ${wikiTreeUrl}`);

    // Parse the WikiTree URL
    const wikiTreeId = this.parseWikiTreeUrl(wikiTreeUrl);
    if (!wikiTreeId) {
      throw new Error('Invalid WikiTree URL format. Expected: https://www.wikitree.com/wiki/Surname-12345');
    }

    // Scrape WikiTree data
    const wikiTreeData = await this.scrapeWikiTree(wikiTreeUrl);
    logger.ok('augment', `Scraped WikiTree: ${wikiTreeData.title}`);

    // Get existing augmentation or create new
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      updatedAt: new Date().toISOString(),
    };

    // Add or update WikiTree platform reference
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

    // Add or update WikiTree description
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
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Fetch and download photo from a linked platform, making it the primary photo
   */
  async fetchPhotoFromPlatform(personId: string, platform: PlatformType): Promise<PersonAugmentation> {
    const existing = this.getAugmentation(personId);
    if (!existing) {
      throw new Error('No augmentation data found for this person');
    }

    const platformRef = existing.platforms.find(p => p.platform === platform);
    if (!platformRef) {
      throw new Error(`Platform ${platform} is not linked to this person`);
    }

    // Check if we already have a photo from this platform locally - skip if we do
    // All providers now use consistent suffixed naming: -{provider}
    const photoSuffix = platform === 'wikipedia' ? 'wiki' : platform;
    const jpgPath = path.join(PHOTOS_DIR, `${personId}-${photoSuffix}.jpg`);
    const pngPath = path.join(PHOTOS_DIR, `${personId}-${photoSuffix}.png`);
    const existingLocalPath = fs.existsSync(jpgPath) ? jpgPath : fs.existsSync(pngPath) ? pngPath : null;

    if (existingLocalPath) {
      // Just ensure it's marked as primary and return
      existing.photos.forEach(p => p.isPrimary = false);
      const existingPhoto = existing.photos.find(p => p.source === platform);
      if (existingPhoto) {
        existingPhoto.localPath = existingLocalPath;
        existingPhoto.isPrimary = true;
      } else {
        existing.photos.push({
          url: platformRef.photoUrl || `/api/browser/photos/${personId}`,
          source: platform,
          localPath: existingLocalPath,
          isPrimary: true,
        });
      }
      existing.updatedAt = new Date().toISOString();
      this.saveAugmentation(existing);
      return existing;
    }

    let photoUrl = platformRef.photoUrl;

    // Special case for FamilySearch - use the already-scraped photo
    if (platform === 'familysearch') {
      const fsJpgPath = path.join(PHOTOS_DIR, `${personId}-familysearch.jpg`);
      const fsPngPath = path.join(PHOTOS_DIR, `${personId}-familysearch.png`);
      const fsPhotoPath = fs.existsSync(fsJpgPath) ? fsJpgPath :
                          fs.existsSync(fsPngPath) ? fsPngPath : null;

      if (!fsPhotoPath) {
        throw new Error('No FamilySearch photo available for this person. Download from FamilySearch first.');
      }

      // FamilySearch photo already exists, just set it as primary
      existing.photos.forEach(p => p.isPrimary = false);

      const existingPhoto = existing.photos.find(p => p.source === 'familysearch');
      if (existingPhoto) {
        existingPhoto.localPath = fsPhotoPath;
        existingPhoto.isPrimary = true;
      } else {
        existing.photos.push({
          url: `/api/browser/photos/${personId}`,
          source: 'familysearch',
          localPath: fsPhotoPath,
          isPrimary: true,
        });
      }

      existing.updatedAt = new Date().toISOString();
      this.saveAugmentation(existing);
      return existing;
    }

    // If no stored photoUrl, try to re-scrape it
    if (!photoUrl) {
      if (platform === 'wikipedia') {
        const wikiData = await this.scrapeWikipedia(platformRef.url);
        photoUrl = wikiData.photoUrl;
      } else if (platform === 'wikitree') {
        const wikiTreeData = await this.scrapeWikiTree(platformRef.url);
        photoUrl = wikiTreeData.photoUrl;
      } else if (platform === 'ancestry') {
        // For Ancestry, check provider cache first to avoid re-scraping
        if (platformRef.externalId) {
          const cacheDir = path.join(DATA_DIR, 'provider-cache', 'ancestry');
          const cachePath = path.join(cacheDir, `${platformRef.externalId}.json`);
          if (fs.existsSync(cachePath)) {
            const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            if (cache.scrapedData?.photoUrl) {
              photoUrl = cache.scrapedData.photoUrl;
            }
          }
        }
        // Only re-scrape if not in cache
        if (!photoUrl) {
          logger.browser('augment', `Re-scraping Ancestry photo for ${personId}`);
          photoUrl = await this.scrapeAncestryPhoto(platformRef.url);
        }
      } else if (platform === 'linkedin') {
        const linkedInData = await this.scrapeLinkedIn(platformRef.url);
        photoUrl = linkedInData.photoUrl;
      }

      // Update the stored photoUrl
      if (photoUrl) {
        platformRef.photoUrl = photoUrl;
      }
    }

    if (!photoUrl) {
      // No photo available is a valid state, not an error
      logger.data('augment', `No photo available from ${platform} for ${personId}`);
      existing.updatedAt = new Date().toISOString();
      this.saveAugmentation(existing);
      return existing;
    }

    // Normalize relative URLs to absolute (especially for Ancestry)
    // Note: familysearch is handled above with early return, so we don't need to check for it here
    let normalizedPhotoUrl = photoUrl;
    if (photoUrl.startsWith('//')) {
      normalizedPhotoUrl = 'https:' + photoUrl;
    } else if (photoUrl.startsWith('/')) {
      // Relative URL - need to determine the base domain
      const platformDomains: Record<string, string> = {
        'ancestry': 'https://www.ancestry.com',
        'wikitree': 'https://www.wikitree.com',
        'wikipedia': 'https://en.wikipedia.org',
        'linkedin': 'https://www.linkedin.com',
      };
      const domain = platformDomains[platform];
      if (domain) {
        normalizedPhotoUrl = domain + photoUrl;
      }
    }

    // Determine file extension and path
    // Use 'wiki' instead of 'wikipedia' to match getWikiPhotoPath convention
    const ext = normalizedPhotoUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const suffix = platform === 'wikipedia' ? 'wiki' : platform;
    const photoPath = path.join(PHOTOS_DIR, `${personId}-${suffix}.${ext}`);

    // Download the photo
    await downloadImage(normalizedPhotoUrl, photoPath);

    if (!fs.existsSync(photoPath)) {
      throw new Error(`Failed to download photo from ${platform}`);
    }

    // Update or create photo entry and set as primary
    // First, unset any existing primary
    existing.photos.forEach(p => p.isPrimary = false);

    const existingPhoto = existing.photos.find(p => p.source === platform);
    if (existingPhoto) {
      existingPhoto.url = photoUrl;
      existingPhoto.localPath = photoPath;
      existingPhoto.downloadedAt = new Date().toISOString();
      existingPhoto.isPrimary = true;
    } else {
      existing.photos.push({
        url: photoUrl,
        source: platform,
        localPath: photoPath,
        downloadedAt: new Date().toISOString(),
        isPrimary: true,
      });
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Check if a platform is linked for a person
   */
  hasPlatform(personId: string, platform: PlatformType): boolean {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation) return false;
    return augmentation.platforms.some(p => p.platform === platform);
  },

  /**
   * Get all linked platforms for a person
   */
  getLinkedPlatforms(personId: string): PlatformReference[] {
    const augmentation = this.getAugmentation(personId);
    return augmentation?.platforms || [];
  },

  /**
   * Add or update a provider mapping for a person
   */
  addProviderMapping(personId: string, mapping: Omit<ProviderPersonMapping, 'linkedAt'>): PersonAugmentation {
    const existing = this.getAugmentation(personId) || {
      id: personId,
      platforms: [],
      photos: [],
      descriptions: [],
      providerMappings: [],
      updatedAt: new Date().toISOString(),
    };

    if (!existing.providerMappings) {
      existing.providerMappings = [];
    }

    const fullMapping: ProviderPersonMapping = {
      ...mapping,
      linkedAt: new Date().toISOString(),
    };

    // Check if mapping for this provider already exists
    const existingIdx = existing.providerMappings.findIndex(m => m.providerId === mapping.providerId);
    if (existingIdx >= 0) {
      existing.providerMappings[existingIdx] = fullMapping;
    } else {
      existing.providerMappings.push(fullMapping);
    }

    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);

    // Also register in SQLite provider_mapping
    const confidence = mapping.confidence === 'high' ? 1.0 : mapping.confidence === 'low' ? 0.5 : 0.75;
    registerProviderMappingIfEnabled(
      personId,
      mapping.platform,
      mapping.externalId,
      mapping.matchedBy ?? 'manual',
      confidence
    );

    return existing;
  },

  /**
   * Remove a provider mapping from a person
   */
  removeProviderMapping(personId: string, providerId: string): PersonAugmentation | null {
    const existing = this.getAugmentation(personId);
    if (!existing || !existing.providerMappings) return existing;

    const idx = existing.providerMappings.findIndex(m => m.providerId === providerId);
    if (idx < 0) return existing;

    existing.providerMappings.splice(idx, 1);
    existing.updatedAt = new Date().toISOString();
    this.saveAugmentation(existing);
    return existing;
  },

  /**
   * Get all provider mappings for a person
   */
  getProviderMappings(personId: string): ProviderPersonMapping[] {
    const augmentation = this.getAugmentation(personId);
    return augmentation?.providerMappings || [];
  },

  /**
   * Check if a person has a mapping to a specific provider
   */
  hasProviderMapping(personId: string, providerId: string): boolean {
    const augmentation = this.getAugmentation(personId);
    if (!augmentation?.providerMappings) return false;
    return augmentation.providerMappings.some(m => m.providerId === providerId);
  },
};
