/**
 * Ancestry Upload Service
 *
 * Handles uploading local photos to Ancestry via Playwright browser automation.
 * Mirrors the FamilySearch upload service pattern but focused on photo upload only.
 */

import { Page } from 'playwright';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { browserService } from './browser.service.js';
import { augmentationService } from './augmentation.service.js';
import { idMappingService } from './id-mapping.service.js';
import { credentialsService } from './credentials.service.js';
import { getScraper } from './scrapers/index.js';
import { logger } from '../lib/logger.js';
import type { PhotoComparison, UploadResult } from './familysearch-upload.service.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../data');

/**
 * Resolve tree ID and person ID from augmentation data
 */
function getAncestryIds(canonicalId: string): { treeId: string; ancestryPersonId: string } | null {
  const augmentation = augmentationService.getAugmentation(canonicalId);
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
  if (!ancestryPlatform?.url) return null;
  return augmentationService.parseAncestryUrl(ancestryPlatform.url);
}

/**
 * Find the best local photo for a person (same priority as FS upload)
 */
function findLocalPhoto(canonicalId: string): { path: string; url: string } | null {
  const photosDir = join(DATA_DIR, 'photos');
  const photoChecks = [
    { suffix: '-ancestry', path: join(photosDir, `${canonicalId}-ancestry.jpg`), url: `/augment/${canonicalId}/ancestry-photo` },
    { suffix: '-ancestry', path: join(photosDir, `${canonicalId}-ancestry.png`), url: `/augment/${canonicalId}/ancestry-photo` },
    { suffix: '-wikitree', path: join(photosDir, `${canonicalId}-wikitree.jpg`), url: `/augment/${canonicalId}/wikitree-photo` },
    { suffix: '-wikitree', path: join(photosDir, `${canonicalId}-wikitree.png`), url: `/augment/${canonicalId}/wikitree-photo` },
    { suffix: '-wiki', path: join(photosDir, `${canonicalId}-wiki.jpg`), url: `/augment/${canonicalId}/wiki-photo` },
    { suffix: '-wiki', path: join(photosDir, `${canonicalId}-wiki.png`), url: `/augment/${canonicalId}/wiki-photo` },
    { suffix: '', path: join(photosDir, `${canonicalId}.jpg`), url: `/browser/photos/${canonicalId}` },
    { suffix: '', path: join(photosDir, `${canonicalId}.png`), url: `/browser/photos/${canonicalId}` },
  ];

  for (const check of photoChecks) {
    if (existsSync(check.path)) {
      return { path: check.path, url: check.url };
    }
  }
  return null;
}

export const ancestryUploadService = {
  /**
   * Compare local photo with Ancestry for upload
   */
  async compareForUpload(dbId: string, personId: string): Promise<{ photo: PhotoComparison }> {
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    const ancestryIds = getAncestryIds(canonical);
    if (!ancestryIds) {
      throw new Error('Person has no linked Ancestry profile');
    }

    const localPhoto = findLocalPhoto(canonical);

    // Check if Ancestry already has a photo (from scraped data)
    const ancestryPhotoPath = join(DATA_DIR, 'photos', `${canonical}-ancestry.jpg`);
    const ancestryPngPath = join(DATA_DIR, 'photos', `${canonical}-ancestry.png`);
    const ancestryHasPhoto = existsSync(ancestryPhotoPath) || existsSync(ancestryPngPath);

    // Photo differs if we have a local photo from a non-Ancestry source
    const photoDiffers = localPhoto !== null && (
      !ancestryHasPhoto ||
      !localPhoto.path.includes('-ancestry')
    );

    return {
      photo: {
        localPhotoUrl: localPhoto?.url || null,
        localPhotoPath: localPhoto?.path || null,
        fsHasPhoto: ancestryHasPhoto,
        photoDiffers,
      },
    };
  },

  /**
   * Upload selected fields to Ancestry (currently photo only)
   */
  async uploadToAncestry(
    dbId: string,
    personId: string,
    fields: string[]
  ): Promise<UploadResult> {
    const result: UploadResult = {
      success: false,
      uploaded: [],
      errors: [],
    };

    if (fields.length === 0) return result;

    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;
    const ancestryIds = getAncestryIds(canonical);
    if (!ancestryIds) {
      result.errors.push({ field: '*', error: 'Person has no linked Ancestry profile' });
      return result;
    }

    // Only photo upload is supported
    if (!fields.includes('photo')) {
      result.errors.push({ field: '*', error: 'Only photo upload is supported for Ancestry' });
      return result;
    }

    const localPhoto = findLocalPhoto(canonical);
    if (!localPhoto) {
      result.errors.push({ field: 'photo', error: 'No local photo found' });
      return result;
    }

    // Ensure browser is connected
    if (!browserService.isConnected()) {
      const connected = await browserService.connect().catch(() => null);
      if (!connected) {
        result.errors.push({ field: '*', error: 'Browser not connected' });
        return result;
      }
    }

    const galleryUrl = `https://www.ancestry.com/family-tree/person/tree/${ancestryIds.treeId}/person/${ancestryIds.ancestryPersonId}/gallery`;
    logger.browser('ancestry-upload', `Navigating to gallery: ${galleryUrl}`);
    const page = await browserService.createPage(galleryUrl);
    await page.waitForTimeout(3000);

    // Handle login if redirected
    const loggedIn = await this.handleLoginIfNeeded(page, galleryUrl);
    if (loggedIn === false) {
      await page.close();
      result.errors.push({ field: '*', error: 'Not logged in to Ancestry. Please log in via the browser or save credentials.' });
      return result;
    }

    // Upload the photo
    const uploadResult = await this.uploadPhoto(
      page,
      ancestryIds.treeId,
      ancestryIds.ancestryPersonId,
      localPhoto.path
    ).catch(err => ({ success: false, error: err.message }));

    await page.close();

    if (uploadResult.success) {
      result.uploaded.push('photo');
      result.success = true;
    } else {
      result.errors.push({ field: 'photo', error: uploadResult.error || 'Unknown error' });
    }

    return result;
  },

  /**
   * Detect Ancestry login page and auto-login using stored credentials.
   * Returns true if login succeeded, false if login failed, null if already logged in.
   */
  async handleLoginIfNeeded(page: Page, returnUrl: string): Promise<boolean | null> {
    let currentUrl = page.url();
    if (!currentUrl.includes('/signin') && !currentUrl.includes('/login') && !currentUrl.includes('/account/signin')) {
      return null; // Already logged in
    }

    logger.auth('ancestry-upload', 'Login page detected, attempting auto-login...');

    const credentials = credentialsService.getCredentials('ancestry');
    if (!credentials?.password) {
      logger.error('ancestry-upload', 'No saved Ancestry credentials');
      return false;
    }

    const username = credentials.email || credentials.username || '';
    const scraper = getScraper('ancestry');
    const loginSuccess = await scraper.performLogin(page, username, credentials.password).catch(err => {
      logger.error('ancestry-upload', `Auto-login failed: ${err.message}`);
      return false;
    });

    if (!loginSuccess) {
      logger.error('ancestry-upload', 'Auto-login failed');
      return false;
    }

    logger.ok('ancestry-upload', 'Auto-login successful, navigating back to gallery...');
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    currentUrl = page.url();
    if (currentUrl.includes('/signin') || currentUrl.includes('/login')) {
      logger.error('ancestry-upload', 'Still on login page after auto-login (may need 2FA)');
      return false;
    }

    return true;
  },

  /**
   * Upload photo to Ancestry via the gallery page
   */
  async uploadPhoto(
    page: Page,
    treeId: string,
    ancestryPersonId: string,
    photoPath: string
  ): Promise<{ success: boolean; error?: string }> {
    // Ensure we're on the gallery page
    const galleryUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${ancestryPersonId}/gallery`;
    const currentUrl = page.url();
    if (!currentUrl.includes('/gallery')) {
      await page.goto(galleryUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    logger.photo('ancestry-upload', `Uploading photo: ${photoPath}`);

    // Step 1: Click "Add" or "Add Media" button to open upload dialog
    const addButton = await page.$(
      'button:has-text("Add"), ' +
      'button:has-text("Add Media"), ' +
      'button:has-text("Upload"), ' +
      '[data-test="add-media-button"], ' +
      '[data-testid="add-media-button"]'
    );

    if (!addButton) {
      return { success: false, error: 'Could not find Add/Upload button on gallery page' };
    }

    logger.browser('ancestry-upload', 'Clicking Add button...');
    await addButton.click();
    await page.waitForTimeout(2000);

    // Step 2: Set the file on the file input
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      return { success: false, error: 'Could not find file input for photo upload' };
    }

    logger.photo('ancestry-upload', `Setting file input: ${photoPath}`);
    await fileInput.setInputFiles(photoPath);
    await page.waitForTimeout(5000);

    // Step 3: Click Upload/Save/Done button if a confirmation dialog appears
    const confirmButton = await page.$(
      'button:has-text("Upload"), ' +
      'button:has-text("Save"), ' +
      'button:has-text("Done"), ' +
      'button:has-text("Confirm"), ' +
      '[data-test="upload-button"], ' +
      '[data-testid="upload-button"]'
    );

    if (confirmButton) {
      logger.browser('ancestry-upload', 'Clicking confirm button...');
      await confirmButton.click();
      await page.waitForTimeout(5000);
    }

    // Step 4: Check for errors
    const errorEl = await page.$('.error-message, .errorMessage, [data-test="error-message"], [role="alert"]:not(:empty)');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      if (errorText && !errorText.toLowerCase().includes('success')) {
        return { success: false, error: errorText };
      }
    }

    logger.ok('ancestry-upload', 'Photo uploaded successfully to Ancestry');
    return { success: true };
  },
};
