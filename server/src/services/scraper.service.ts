import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { browserService } from './browser.service';
import { idMappingService } from './id-mapping.service';
import { checkForRedirect, type RedirectInfo } from './familysearch-redirect.service.js';

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

  getPhotoPath(personId: string): string | null {
    // Photo patterns to check: base, -wiki, -ancestry, -wikitree suffixes
    const suffixes = ['', '-wiki', '-ancestry', '-wikitree'];
    const extensions = ['.jpg', '.png'];

    // Check by canonical ULID first
    for (const suffix of suffixes) {
      for (const ext of extensions) {
        const filePath = path.join(PHOTOS_DIR, `${personId}${suffix}${ext}`);
        if (fs.existsSync(filePath)) return filePath;
      }
    }

    // Also check by FamilySearch ID (legacy photos may be stored this way)
    const fsId = idMappingService.getExternalId(personId, 'familysearch');
    if (fsId) {
      for (const suffix of suffixes) {
        for (const ext of extensions) {
          const filePath = path.join(PHOTOS_DIR, `${fsId}${suffix}${ext}`);
          if (fs.existsSync(filePath)) return filePath;
        }
      }
    }

    return null;
  },

  async scrapePerson(personId: string, onProgress?: ProgressCallback): Promise<ScrapedPersonData> {
    const sendProgress = (progress: ScrapeProgress) => {
      if (onProgress) onProgress(progress);
      console.log(`[scraper] ${progress.phase}: ${progress.message}`);
    };

    // Resolve canonical ULID and FamilySearch external ID
    // personId could be either a ULID or a FamilySearch ID
    const canonicalId = idMappingService.resolveId(personId) || personId;
    const familySearchId = idMappingService.getExternalId(canonicalId, 'familysearch') || personId;

    console.log(`[scraper] Resolved IDs - canonical: ${canonicalId}, familysearch: ${familySearchId}`);

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
      console.log('[scraper] domcontentloaded timeout, continuing anyway');
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
      console.log(`[scraper] FamilySearch redirect detected: ${familySearchId} -> ${redirectInfo.newFsId}`);

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
      // Store photo with canonical ID, not FamilySearch ID
      const photoPath = path.join(PHOTOS_DIR, `${canonicalId}.${ext}`);

      await downloadImage(data.photoUrl, photoPath).catch(err => {
        console.error(`Failed to download photo for ${canonicalId}:`, err.message);
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

    // Try multiple selectors for profile photo - FamilySearch uses various structures
    // The person portrait is near the update-portrait-button, NOT the user's profile photo
    const photoSelectors = [
      // Primary: Avatar image near the update portrait button (person's portrait)
      '[data-testid="update-portrait-button"]',  // We'll get sibling image
      // Main portrait selectors
      '[data-testid="person-portrait"] img',
      '.person-portrait img',
      '.portrait-container img',
      '.fs-person-portrait img',
      // Artifact/photo gallery
      '[data-testid="artifact-image"]',
      '.artifact-image img',
    ];

    for (const selector of photoSelectors) {
      if (data.photoUrl) break;

      // Special handling for update-portrait-button - find sibling image
      if (selector === '[data-testid="update-portrait-button"]') {
        const portraitImg = await page.$('[data-testid="update-portrait-button"]').catch(() => null);
        if (portraitImg) {
          // Get the parent container and find the img inside it
          const src = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="update-portrait-button"]');
            if (!btn) return null;
            // The image is in a sibling div (avatarCircleCss) before the button
            const container = btn.parentElement;
            if (!container) return null;
            const img = container.querySelector('img[class*="imageCss"]');
            return img?.getAttribute('src') || null;
          }).catch(() => null);

          if (src && !src.includes('silhouette') && !src.includes('placeholder') && !src.includes('default')) {
            data.photoUrl = src.startsWith('//') ? `https:${src}` : src;
            console.log(`[scraper] Found person portrait: ${data.photoUrl.slice(0, 100)}`);
          }
        }
        continue;
      }

      const photoImg = await page.$(selector).catch(() => null);
      if (photoImg) {
        const src = await photoImg.getAttribute('src').catch(() => null);
        if (src && !src.includes('default') && !src.includes('silhouette') && !src.includes('placeholder')) {
          data.photoUrl = src.startsWith('//') ? `https:${src}` : src;
          console.log(`[scraper] Found photo URL: ${data.photoUrl.slice(0, 100)}`);
        }
      }
    }

    // If still no photo, use page.evaluate to find the correct portrait
    // This is more reliable than scanning all images since we can use DOM context
    if (!data.photoUrl) {
      const src = await page.evaluate(() => {
        // First try: Look for image inside the person details header (near h1)
        const h1 = document.querySelector('h1');
        if (h1) {
          const container = h1.closest('[class*="rowCss"]')?.parentElement;
          if (container) {
            const img = container.querySelector('img[class*="imageCss"]');
            const src = img?.getAttribute('src');
            if (src && !src.includes('silhouette') && !src.includes('default')) {
              return src;
            }
          }
        }

        // Second try: Look for artifact images in the main content
        const artifactImg = document.querySelector('[data-testid="artifact-image"] img, .artifact-image img');
        if (artifactImg) {
          const src = artifactImg.getAttribute('src');
          if (src && !src.includes('silhouette') && !src.includes('default')) {
            return src;
          }
        }

        return null;
      }).catch(() => null);

      if (src) {
        data.photoUrl = src.startsWith('//') ? `https:${src}` : src;
        console.log(`[scraper] Found photo from DOM context: ${data.photoUrl.slice(0, 100)}`);
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

    console.log(`[scraper] Extracted data:`, JSON.stringify(data, null, 2));
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
