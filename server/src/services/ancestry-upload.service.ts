/**
 * Ancestry Upload Service
 *
 * Handles uploading local data (photos, vital info) to Ancestry via Playwright browser automation.
 * Mirrors the FamilySearch upload service pattern.
 */

import { Page } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { browserService } from './browser.service.js';
import { augmentationService } from './augmentation.service.js';
import { idMappingService } from './id-mapping.service.js';
import { credentialsService } from './credentials.service.js';
import { personService } from './person.service.js';
import { localOverrideService } from './local-override.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { getScraper } from './scrapers/index.js';
import { logger } from '../lib/logger.js';
import type { FieldDifference, PhotoComparison, UploadResult } from './familysearch-upload.service.js';

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
 * Find the best local photo for uploading TO Ancestry.
 * Prioritizes non-Ancestry photos since we want to upload new content.
 * Falls back to the generic photo, then ancestry as last resort (for re-upload).
 */
function findLocalPhoto(canonicalId: string): { path: string; url: string; isFromAncestry: boolean } | null {
  const photosDir = join(DATA_DIR, 'photos');
  // Priority: familysearch > wikitree > wiki > generic > ancestry (last resort)
  const photoChecks = [
    { path: join(photosDir, `${canonicalId}-familysearch.jpg`), url: `/augment/${canonicalId}/familysearch-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}-familysearch.png`), url: `/augment/${canonicalId}/familysearch-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}-wikitree.jpg`), url: `/augment/${canonicalId}/wikitree-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}-wikitree.png`), url: `/augment/${canonicalId}/wikitree-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}-wiki.jpg`), url: `/augment/${canonicalId}/wiki-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}-wiki.png`), url: `/augment/${canonicalId}/wiki-photo`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}.jpg`), url: `/browser/photos/${canonicalId}`, isFromAncestry: false },
    { path: join(photosDir, `${canonicalId}.png`), url: `/browser/photos/${canonicalId}`, isFromAncestry: false },
    // Ancestry photos last - only for re-upload scenarios
    { path: join(photosDir, `${canonicalId}-ancestry.jpg`), url: `/augment/${canonicalId}/ancestry-photo`, isFromAncestry: true },
    { path: join(photosDir, `${canonicalId}-ancestry.png`), url: `/augment/${canonicalId}/ancestry-photo`, isFromAncestry: true },
  ];

  for (const check of photoChecks) {
    if (existsSync(check.path)) {
      return { path: check.path, url: check.url, isFromAncestry: check.isFromAncestry };
    }
  }
  return null;
}

export interface AncestryUploadComparisonResult {
  differences: FieldDifference[];
  photo: PhotoComparison;
  ancestryData: {
    name?: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
  };
  localData: {
    name?: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
  };
}

export const ancestryUploadService = {
  /**
   * Compare local data with Ancestry for upload (vital info + photo)
   */
  async compareForUpload(dbId: string, personId: string): Promise<AncestryUploadComparisonResult> {
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    const ancestryIds = getAncestryIds(canonical);
    if (!ancestryIds) {
      throw new Error('Person has no linked Ancestry profile');
    }

    // Get local person data
    const person = await personService.getPerson(dbId, personId);
    if (!person) {
      throw new Error('Person not found in database');
    }

    // Get local overrides
    const overrides = localOverrideService.getAllOverridesForPerson(canonical);
    const birthDateOverride = overrides.eventOverrides.find(o => o.fieldName === 'birth_date');
    const birthPlaceOverride = overrides.eventOverrides.find(o => o.fieldName === 'birth_place');
    const deathDateOverride = overrides.eventOverrides.find(o => o.fieldName === 'death_date');
    const deathPlaceOverride = overrides.eventOverrides.find(o => o.fieldName === 'death_place');
    const nameOverride = overrides.personOverrides.find(o => o.fieldName === 'display_name');

    const localData = {
      name: nameOverride?.overrideValue || person.name,
      birthDate: birthDateOverride?.overrideValue || person.birth?.date || undefined,
      birthPlace: birthPlaceOverride?.overrideValue || person.birth?.place || undefined,
      deathDate: deathDateOverride?.overrideValue || person.death?.date || undefined,
      deathPlace: deathPlaceOverride?.overrideValue || person.death?.place || undefined,
    };

    // Get cached Ancestry data
    const ancestryData = this.getCachedAncestryData(canonical) || {};

    // Calculate differences
    const differences: FieldDifference[] = [];

    // Name comparison
    if (localData.name && localData.name !== ancestryData.name) {
      differences.push({
        field: 'name',
        label: 'Name',
        localValue: localData.name,
        fsValue: ancestryData.name || null,
        canUpload: true,
      });
    }

    // Birth date
    if (localData.birthDate && localData.birthDate !== ancestryData.birthDate) {
      differences.push({
        field: 'birthDate',
        label: 'Birth Date',
        localValue: localData.birthDate,
        fsValue: ancestryData.birthDate || null,
        canUpload: true,
      });
    }

    // Birth place
    if (localData.birthPlace && localData.birthPlace !== ancestryData.birthPlace) {
      differences.push({
        field: 'birthPlace',
        label: 'Birth Place',
        localValue: localData.birthPlace,
        fsValue: ancestryData.birthPlace || null,
        canUpload: true,
      });
    }

    // Death date - handle "Living" status
    const localDeathDateNormalized = localData.deathDate?.toLowerCase() === 'living' ? undefined : localData.deathDate;
    const ancestryDeathDateNormalized = ancestryData.deathDate?.toLowerCase() === 'living' ? undefined : ancestryData.deathDate;

    if (localDeathDateNormalized && localDeathDateNormalized !== ancestryDeathDateNormalized) {
      differences.push({
        field: 'deathDate',
        label: 'Death Date',
        localValue: localDeathDateNormalized,
        fsValue: ancestryData.deathDate || null,
        canUpload: true,
      });
    }

    // Death place
    if (localData.deathPlace && localData.deathPlace !== ancestryData.deathPlace) {
      differences.push({
        field: 'deathPlace',
        label: 'Death Place',
        localValue: localData.deathPlace,
        fsValue: ancestryData.deathPlace || null,
        canUpload: true,
      });
    }

    // Photo comparison
    const localPhoto = findLocalPhoto(canonical);
    const ancestryPhotoPath = join(DATA_DIR, 'photos', `${canonical}-ancestry.jpg`);
    const ancestryPngPath = join(DATA_DIR, 'photos', `${canonical}-ancestry.png`);
    const ancestryHasPhoto = existsSync(ancestryPhotoPath) || existsSync(ancestryPngPath);
    const photoDiffers = localPhoto !== null && !localPhoto.isFromAncestry;

    return {
      differences,
      photo: {
        localPhotoUrl: localPhoto?.url || null,
        localPhotoPath: localPhoto?.path || null,
        fsHasPhoto: ancestryHasPhoto,
        photoDiffers,
      },
      ancestryData,
      localData,
    };
  },

  /**
   * Get cached Ancestry data for a person
   */
  getCachedAncestryData(canonicalId: string): {
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    name?: string;
    gender?: string;
  } | null {
    const augmentation = augmentationService.getAugmentation(canonicalId);
    const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
    if (!ancestryPlatform?.externalId) return null;

    const cacheDir = join(DATA_DIR, 'provider-cache', 'ancestry');
    const cachePath = join(cacheDir, `${ancestryPlatform.externalId}.json`);

    if (!existsSync(cachePath)) return null;

    const content = readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(content);
    const scrapedData = cache.scrapedData;

    if (!scrapedData) return null;

    return {
      name: scrapedData.name,
      gender: scrapedData.gender,
      birthDate: scrapedData.birth?.date,
      birthPlace: scrapedData.birth?.place,
      deathDate: scrapedData.death?.date,
      deathPlace: scrapedData.death?.place,
    };
  },

  /**
   * Upload selected fields to Ancestry (vital info + photo)
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

    // Get comparison data for local values
    const comparison = await this.compareForUpload(dbId, personId);

    // Ensure browser is connected
    if (!browserService.isConnected()) {
      const connected = await browserService.connect().catch(() => null);
      if (!connected) {
        result.errors.push({ field: '*', error: 'Browser not connected' });
        return result;
      }
    }

    // Navigate to the person's facts page
    const factsUrl = `https://www.ancestry.com/family-tree/person/tree/${ancestryIds.treeId}/person/${ancestryIds.ancestryPersonId}/facts`;
    logger.browser('ancestry-upload', `Navigating to facts page: ${factsUrl}`);
    const page = await browserService.createPage(factsUrl);
    await page.waitForTimeout(3000);

    // Handle login if redirected
    const loggedIn = await this.handleLoginIfNeeded(page, factsUrl);
    if (loggedIn === false) {
      await page.close();
      result.errors.push({ field: '*', error: 'Not logged in to Ancestry. Please log in via the browser or save credentials.' });
      return result;
    }

    // Separate photo from vital info fields
    const vitalFields = fields.filter(f => f !== 'photo');
    const hasPhoto = fields.includes('photo');

    // Upload vital info fields via Quick Edit
    if (vitalFields.length > 0) {
      const vitalResult = await this.uploadVitalInfo(
        page,
        ancestryIds.treeId,
        ancestryIds.ancestryPersonId,
        vitalFields,
        comparison.localData
      ).catch(err => ({ success: false, uploaded: [], errors: [{ field: '*', error: err.message }] }));

      result.uploaded.push(...vitalResult.uploaded);
      result.errors.push(...vitalResult.errors);
    }

    // Upload photo if requested
    if (hasPhoto) {
      const localPhoto = findLocalPhoto(canonical);
      if (!localPhoto) {
        result.errors.push({ field: 'photo', error: 'No local photo found' });
      } else {
        const photoResult = await this.uploadPhoto(
          page,
          ancestryIds.treeId,
          ancestryIds.ancestryPersonId,
          localPhoto.path
        ).catch(err => ({ success: false, error: err.message }));

        if (photoResult.success) {
          result.uploaded.push('photo');
        } else {
          result.errors.push({ field: 'photo', error: photoResult.error || 'Unknown error' });
        }
      }
    }

    await page.close();

    result.success = result.errors.length === 0 && result.uploaded.length > 0;
    return result;
  },

  /**
   * Upload vital info (name, birth date/place, death date/place) via Quick Edit sidebar
   */
  async uploadVitalInfo(
    page: Page,
    treeId: string,
    ancestryPersonId: string,
    fields: string[],
    localData: {
      name?: string;
      birthDate?: string;
      birthPlace?: string;
      deathDate?: string;
      deathPlace?: string;
    }
  ): Promise<{ success: boolean; uploaded: string[]; errors: Array<{ field: string; error: string }> }> {
    const uploaded: string[] = [];
    const errors: Array<{ field: string; error: string }> = [];

    // Ensure we're on the facts page
    const factsUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${ancestryPersonId}/facts`;
    const currentUrl = page.url();
    if (!currentUrl.includes(`/person/${ancestryPersonId}/facts`)) {
      await page.goto(factsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    logger.browser('ancestry-upload', 'Opening Quick Edit sidebar...');

    // Step 1: Click the Edit button to open the menu
    const editButton = await page.$('#editToolsButton, button.editToolsButton');
    if (!editButton) {
      return { success: false, uploaded: [], errors: [{ field: '*', error: 'Could not find Edit button on page' }] };
    }

    await editButton.click();
    await page.waitForTimeout(1000);

    // Step 2: Click "Quick edit" in the dropdown menu
    const quickEditButton = await page.$('#quickEdit, button:has-text("Quick edit")');
    if (!quickEditButton) {
      return { success: false, uploaded: [], errors: [{ field: '*', error: 'Could not find Quick Edit button in menu' }] };
    }

    await quickEditButton.click();
    await page.waitForTimeout(2000);

    // Step 3: Wait for the sidebar to appear
    const sidebar = await page.waitForSelector('.sidebarContents, .addPersonSidebar, #addPerson', { timeout: 5000 }).catch(() => null);
    if (!sidebar) {
      return { success: false, uploaded: [], errors: [{ field: '*', error: 'Quick Edit sidebar did not appear' }] };
    }

    logger.browser('ancestry-upload', 'Quick Edit sidebar opened, filling fields...');

    // Step 4: Fill in the requested fields
    for (const field of fields) {
      const fieldResult = await this.fillQuickEditField(page, field, localData).catch(err => ({
        success: false,
        error: err.message,
      }));

      if (fieldResult.success) {
        uploaded.push(field);
      } else {
        errors.push({ field, error: fieldResult.error || 'Unknown error' });
      }
    }

    // Step 5: Click Save button
    if (uploaded.length > 0) {
      const saveButton = await page.$('#saveAddNew, button:has-text("Save")');
      if (saveButton) {
        logger.browser('ancestry-upload', 'Clicking Save button...');
        await saveButton.click();
        await page.waitForTimeout(3000);

        // Check for errors after save
        const errorMessage = await page.$('.errorMessage:not(.hideVisually), .error-message');
        if (errorMessage) {
          const errorText = await errorMessage.textContent();
          if (errorText && !errorText.toLowerCase().includes('valid')) {
            errors.push({ field: '*', error: `Save failed: ${errorText}` });
          }
        }
      } else {
        errors.push({ field: '*', error: 'Could not find Save button' });
      }
    }

    return {
      success: errors.length === 0 && uploaded.length > 0,
      uploaded,
      errors,
    };
  },

  /**
   * Fill a single field in the Quick Edit sidebar
   */
  async fillQuickEditField(
    page: Page,
    field: string,
    localData: {
      name?: string;
      birthDate?: string;
      birthPlace?: string;
      deathDate?: string;
      deathPlace?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    let inputSelector: string;
    let value: string | undefined;

    switch (field) {
      case 'name': {
        // Name is split into first/middle and last in Ancestry's Quick Edit
        // We'll put the full name in the first name field (Ancestry will parse it)
        const nameParts = (localData.name || '').split(' ');
        const lastName = nameParts.pop() || '';
        const firstName = nameParts.join(' ');

        const fnameInput = await page.$('#fname');
        const lnameInput = await page.$('#lname');

        if (!fnameInput || !lnameInput) {
          return { success: false, error: 'Could not find name input fields' };
        }

        await fnameInput.fill(firstName);
        await lnameInput.fill(lastName);
        logger.browser('ancestry-upload', `Filled name: "${firstName}" "${lastName}"`);
        return { success: true };
      }

      case 'birthDate':
        inputSelector = '#bdate';
        value = localData.birthDate;
        break;

      case 'birthPlace':
        inputSelector = '#bplace';
        value = localData.birthPlace;
        break;

      case 'deathDate':
        // Note: Quick Edit may not have death fields if person is marked as Living
        // We'll need to handle the status radio buttons
        inputSelector = '#ddate';
        value = localData.deathDate;

        // If setting a death date, ensure "Deceased" is selected
        if (value) {
          const deceasedRadio = await page.$('#deceasedRadio');
          if (deceasedRadio) {
            await deceasedRadio.click();
            await page.waitForTimeout(500);
          }
        }
        break;

      case 'deathPlace':
        inputSelector = '#dplace';
        value = localData.deathPlace;

        // If setting a death place, ensure "Deceased" is selected
        if (value) {
          const deceasedRadio = await page.$('#deceasedRadio');
          if (deceasedRadio) {
            await deceasedRadio.click();
            await page.waitForTimeout(500);
          }
        }
        break;

      default:
        return { success: false, error: `Unknown field: ${field}` };
    }

    if (!value) {
      return { success: false, error: `No local value for ${field}` };
    }

    const input = await page.$(inputSelector);
    if (!input) {
      // Try alternate selector (different Ancestry UI versions)
      const altSelector = `input[name="${field.replace('Date', 'date').replace('Place', 'place')}"]`;
      const altInput = await page.$(altSelector);
      if (!altInput) {
        return { success: false, error: `Could not find input for ${field}` };
      }
      await altInput.fill(value);
    } else {
      await input.fill(value);
    }

    logger.browser('ancestry-upload', `Filled ${field}: "${value}"`);
    return { success: true };
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
