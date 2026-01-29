import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { browserService } from './browser.service';
import { idMappingService } from './id-mapping.service';
import { checkForRedirect, type RedirectInfo } from './familysearch-redirect.service.js';
import { isPlaceholderImage } from './scrapers/base.scraper.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const SCRAPE_DIR = path.join(DATA_DIR, 'scrape');

// Ensure directories exist
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(SCRAPE_DIR)) fs.mkdirSync(SCRAPE_DIR, { recursive: true });

export interface ScrapedPersonData {
  id: string;
  photoUrl?: string;
  photoPath?: string;
  fullName?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  scrapedAt: string;
}

export interface ScrapeProgress {
  phase: 'connecting' | 'navigating' | 'scraping' | 'downloading' | 'complete' | 'error' | 'redirect';
  message: string;
  personId?: string;
  data?: ScrapedPersonData;
  error?: string;
  /** Redirect information if person was merged/redirected on FamilySearch */
  redirectInfo?: RedirectInfo;
}

type ProgressCallback = (progress: ScrapeProgress) => void;

function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {}); // Delete partial file
      reject(err);
    });
  });
}

export const scraperService = {
  getScrapedData(personId: string): ScrapedPersonData | null {
    const filePath = path.join(SCRAPE_DIR, `${personId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  },

  saveScrapedData(data: ScrapedPersonData): void {
    const filePath = path.join(SCRAPE_DIR, `${data.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  },

  hasPhoto(personId: string): boolean {
    return this.getPhotoPath(personId) !== null;
  },

  /** Check if a FamilySearch-specific photo exists */
  hasFsPhoto(personId: string): boolean {
    const extensions = ['.jpg', '.png'];
    for (const ext of extensions) {
      if (fs.existsSync(path.join(PHOTOS_DIR, `${personId}-familysearch${ext}`))) return true;
    }
    return false;
  },

  getPhotoPath(personId: string): string | null {
    const extensions = ['.jpg', '.png'];

    // First check for primary photo (user-selected, no suffix)
    for (const ext of extensions) {
      const primaryPath = path.join(PHOTOS_DIR, `${personId}${ext}`);
      if (fs.existsSync(primaryPath)) return primaryPath;
    }

    // Then check provider-specific photos
    const suffixes = ['-familysearch', '-wiki', '-ancestry', '-wikitree', '-linkedin'];
    for (const suffix of suffixes) {
      for (const ext of extensions) {
        const filePath = path.join(PHOTOS_DIR, `${personId}${suffix}${ext}`);
        if (fs.existsSync(filePath)) return filePath;
      }
    }

    return null;
  },

  async scrapePerson(personId: string, onProgress?: ProgressCallback): Promise<ScrapedPersonData> {
    const sendProgress = (progress: ScrapeProgress) => {
      if (onProgress) onProgress(progress);
      logger.browser('scraper', `${progress.phase}: ${progress.message}`);
    };

    // Resolve canonical ULID and FamilySearch external ID
    // personId could be either a ULID or a FamilySearch ID
    const canonicalId = idMappingService.resolveId(personId) || personId;
    const familySearchId = idMappingService.getExternalId(canonicalId, 'familysearch') || personId;

    logger.data('scraper', `Resolved IDs - canonical: ${canonicalId}, familysearch: ${familySearchId}`);

    sendProgress({ phase: 'connecting', message: 'Connecting to browser...' });

    if (!browserService.isConnected()) {
      await browserService.connect();
    }

    sendProgress({ phase: 'navigating', message: `Navigating to person ${familySearchId}...`, personId: canonicalId });

    // Use FamilySearch ID for the URL, but track with canonical ID
    const url = `https://www.familysearch.org/tree/person/details/${familySearchId}`;
    const page = await browserService.navigateTo(url);

    // Wait for page to load - use domcontentloaded with shorter timeout
    // FamilySearch pages never fully "idle" due to continuous API calls
    sendProgress({ phase: 'navigating', message: 'Waiting for page to load...', personId });

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {
      logger.warn('scraper', 'domcontentloaded timeout, continuing anyway');
    });

    // Give a bit more time for dynamic content
    await page.waitForTimeout(2000);

    // Check if we're redirected to signin
    if (page.url().includes('/signin')) {
      sendProgress({
        phase: 'error',
        message: 'Not logged in to FamilySearch. Please log in via the browser.',
        personId: canonicalId,
        error: 'Not authenticated'
      });
      throw new Error('Not authenticated - please log in to FamilySearch in the browser');
    }

    // Check for FamilySearch redirect/merge (person deleted and merged into another)
    const redirectInfo = await checkForRedirect(page, familySearchId, canonicalId, {
      purgeCachedData: true,
    });

    // If redirect detected, notify and navigate to the new page
    if (redirectInfo.wasRedirected && redirectInfo.newFsId) {
      sendProgress({
        phase: 'redirect',
        message: `Person was merged on FamilySearch: ${familySearchId} → ${redirectInfo.newFsId}${redirectInfo.survivingPersonName ? ` (${redirectInfo.survivingPersonName})` : ''}`,
        personId: canonicalId,
        redirectInfo,
      });
      logger.sync('scraper', `FamilySearch redirect detected: ${familySearchId} → ${redirectInfo.newFsId}`);

      // If we detected a redirect but are still on the old (deleted) page, navigate to the new one
      if (redirectInfo.isDeleted && redirectInfo.newFsId) {
        const newUrl = `https://www.familysearch.org/tree/person/details/${redirectInfo.newFsId}`;
        sendProgress({ phase: 'navigating', message: `Navigating to surviving person ${redirectInfo.newFsId}...`, personId: canonicalId });
        await page.goto(newUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }
    }

    sendProgress({ phase: 'scraping', message: 'Extracting person data...', personId: canonicalId });

    // Extract data and store with canonical ID
    const data = await this.extractPersonData(page, canonicalId);

    // Download photo if available
    if (data.photoUrl) {
      sendProgress({ phase: 'downloading', message: 'Downloading photo...', personId: canonicalId });

      const ext = data.photoUrl.includes('.png') ? 'png' : 'jpg';
      // Store photo with canonical ID and -familysearch suffix for consistency
      const photoPath = path.join(PHOTOS_DIR, `${canonicalId}-familysearch.${ext}`);

      await downloadImage(data.photoUrl, photoPath).catch(err => {
        logger.error('scraper', `Failed to download photo for ${canonicalId}: ${err.message}`);
      });

      if (fs.existsSync(photoPath)) {
        data.photoPath = photoPath;
      }
    }

    // Save scraped data with canonical ID
    this.saveScrapedData(data);

    sendProgress({
      phase: 'complete',
      message: 'Scraping complete',
      personId: canonicalId,
      data
    });

    return data;
  },

  async extractPersonData(page: Page, personId: string): Promise<ScrapedPersonData> {
    const data: ScrapedPersonData = {
      id: personId,
      scrapedAt: new Date().toISOString()
    };

    const getImageUrlFromSelector = async (selector: string): Promise<string | null> => {
      return page.evaluate((sel) => {
        const pickSrcFromImg = (img: any): string | null => {
          if (!img) return null;
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
          const srcsetUrl = srcset ? srcset.split(',')[0]?.trim().split(' ')[0] : null;
          return img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || srcsetUrl || null;
        };

        const pickSrcFromPicture = (picture: any): string | null => {
          if (!picture) return null;
          const source = picture.querySelector('source[srcset], source[data-srcset]');
          const srcset = source?.getAttribute('srcset') || source?.getAttribute('data-srcset');
          if (srcset) return srcset.split(',')[0]?.trim().split(' ')[0] || null;
          const img = picture.querySelector('img');
          return pickSrcFromImg(img);
        };

        const pickSrcFromBackground = (el: any): string | null => {
          if (!el) return null;
          const style = window.getComputedStyle(el);
          const bg = style?.backgroundImage;
          if (bg && bg !== 'none') {
            const match = bg.match(/url\\([\"']?(.+?)[\"']?\\)/);
            if (match?.[1]) return match[1];
          }
          return null;
        };

        const pickSrcFromSvgImage = (el: any): string | null => {
          if (!el) return null;
          const svgImg = el.querySelector('image');
          if (!svgImg) return null;
          return svgImg.getAttribute('href') || svgImg.getAttribute('xlink:href');
        };

        const extractFromElement = (el: any): string | null => {
          if (!el) return null;
          if (el.tagName === 'IMG') return pickSrcFromImg(el);
          const picture = el.querySelector('picture');
          const pictureSrc = pickSrcFromPicture(picture);
          if (pictureSrc) return pictureSrc;
          const img = el.querySelector('img');
          const imgSrc = pickSrcFromImg(img);
          if (imgSrc) return imgSrc;
          const svgSrc = pickSrcFromSvgImage(el);
          if (svgSrc) return svgSrc;
          return pickSrcFromBackground(el);
        };

        const target = document.querySelector(sel);
        if (!target) return null;

        if (sel === '[data-testid="update-portrait-button"]') {
          const candidates: Array<any> = [
            target.parentElement,
            target.previousElementSibling,
            target.parentElement?.previousElementSibling,
            target.parentElement?.parentElement,
          ];
          for (const candidate of candidates) {
            const src = extractFromElement(candidate);
            if (src) return src;
          }
        }

        return extractFromElement(target);
      }, selector).catch(() => null);
    };

    // Try multiple selectors for profile photo - FamilySearch uses various structures
    // The person portrait is near the update-portrait-button, NOT the user's profile photo
    const photoSelectors = [
      // Primary: Avatar image near the update portrait button (person's portrait)
      '[data-testid="update-portrait-button"]',  // We'll get sibling image
      // Main portrait selectors
      '[data-testid="person-portrait"]',
      '[data-testid="person-portrait"] img',
      '.person-portrait',
      '.person-portrait img',
      '.portrait-container',
      '.portrait-container img',
      '.fs-person-portrait',
      '.fs-person-portrait img',
      // Artifact/photo gallery
      '[data-testid="artifact-image"]',
      '.artifact-image',
      '.artifact-image img',
    ];

    for (const selector of photoSelectors) {
      if (data.photoUrl) break;

      const src = await getImageUrlFromSelector(selector);
      if (src && !isPlaceholderImage(src)) {
        data.photoUrl = src.startsWith('//') ? `https:${src}` : src;
        logger.photo('scraper', `Found photo URL: ${data.photoUrl.slice(0, 100)}`);
      }
    }

    // If still no photo, use page.evaluate to find the correct portrait
    // This is more reliable than scanning all images since we can use DOM context
    if (!data.photoUrl) {
      const src = await page.evaluate(() => {
        const pickSrcFromImg = (img: any): string | null => {
          if (!img) return null;
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
          const srcsetUrl = srcset ? srcset.split(',')[0]?.trim().split(' ')[0] : null;
          return img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || srcsetUrl || null;
        };

        const pickSrcFromBackground = (el: any): string | null => {
          if (!el) return null;
          const style = window.getComputedStyle(el);
          const bg = style?.backgroundImage;
          if (bg && bg !== 'none') {
            const match = bg.match(/url\\([\"']?(.+?)[\"']?\\)/);
            if (match?.[1]) return match[1];
          }
          return null;
        };

        const pickSrcFromElement = (el: any): string | null => {
          if (!el) return null;
          if (el.tagName === 'IMG') return pickSrcFromImg(el);
          const img = el.querySelector('img');
          const imgSrc = pickSrcFromImg(img);
          if (imgSrc) return imgSrc;
          const svgImg = el.querySelector('image');
          const svgSrc = svgImg?.getAttribute('href') || svgImg?.getAttribute('xlink:href');
          if (svgSrc) return svgSrc;
          return pickSrcFromBackground(el);
        };

        // First try: Look for image inside the person details header (near h1)
        const h1 = document.querySelector('h1');
        if (h1) {
          const container = h1.closest('[class*="rowCss"]')?.parentElement;
          if (container) {
            const src = pickSrcFromElement(container);
            if (src && !src.includes('silhouette') && !src.includes('default')) return src;
          }
        }

        const scope = document.querySelector('main') || document.body;

        // Second try: Look for artifact images in the main content
        const artifactEl = scope.querySelector('[data-testid="artifact-image"], .artifact-image, [data-testid*="portrait"], [data-testid*="photo"]');
        const artifactSrc = pickSrcFromElement(artifactEl);
        if (artifactSrc && !artifactSrc.includes('silhouette') && !artifactSrc.includes('default')) return artifactSrc;

        return null;
      }).catch(() => null);

      if (src) {
        data.photoUrl = src.startsWith('//') ? `https:${src}` : src;
        logger.photo('scraper', `Found photo from DOM context: ${data.photoUrl.slice(0, 100)}`);
      }
    }

    // Get full name - multiple selector options
    const nameSelectors = [
      '[data-testid="person-name"]',
      '.person-name',
      'h1.name',
      '.person-header h1',
      '[data-testid="conclusion-name"]'
    ];

    for (const selector of nameSelectors) {
      const nameEl = await page.$(selector).catch(() => null);
      if (nameEl) {
        const text = await nameEl.textContent().catch(() => null);
        if (text) {
          data.fullName = text.trim();
          break;
        }
      }
    }

    // Get vital information
    const vitalSelectors = {
      birth: '[data-testid="birth-date"], .birth-date, .vital-birth .date, [data-testid="vital-birth"] .date',
      birthPlace: '[data-testid="birth-place"], .birth-place, .vital-birth .place, [data-testid="vital-birth"] .place',
      death: '[data-testid="death-date"], .death-date, .vital-death .date, [data-testid="vital-death"] .date',
      deathPlace: '[data-testid="death-place"], .death-place, .vital-death .place, [data-testid="vital-death"] .place'
    };

    for (const [key, selector] of Object.entries(vitalSelectors)) {
      const el = await page.$(selector).catch(() => null);
      if (el) {
        const text = await el.textContent().catch(() => null);
        if (text) {
          if (key === 'birth') data.birthDate = text.trim();
          else if (key === 'birthPlace') data.birthPlace = text.trim();
          else if (key === 'death') data.deathDate = text.trim();
          else if (key === 'deathPlace') data.deathPlace = text.trim();
        }
      }
    }

    logger.data('scraper', `Extracted: ${data.fullName || 'unknown'}, birth: ${data.birthDate || 'n/a'}, death: ${data.deathDate || 'n/a'}, photo: ${data.photoUrl ? 'yes' : 'no'}`);
    return data;
  },

  getPhotoUrl(personId: string): string | null {
    const photoPath = this.getPhotoPath(personId);
    if (photoPath) {
      return `/api/photos/${personId}`;
    }
    return null;
  }
};
