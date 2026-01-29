/**
 * FamilySearch Upload Service
 *
 * Handles uploading local edits to FamilySearch via Playwright browser automation.
 * Comparison uses cached API data (refreshed via familysearch-refresh.service).
 */

import { Page } from 'playwright';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { browserService } from './browser.service.js';
import { personService } from './person.service.js';
import { localOverrideService } from './local-override.service.js';
import { idMappingService } from './id-mapping.service.js';
import { familySearchRefreshService } from './familysearch-refresh.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../data');

export interface FieldDifference {
  field: string;
  label: string;
  localValue: string | string[] | null;
  fsValue: string | string[] | null;
  canUpload: boolean;
}

export interface PhotoComparison {
  localPhotoUrl: string | null;
  localPhotoPath: string | null;
  fsHasPhoto: boolean;
  photoDiffers: boolean;
}

export interface UploadComparisonResult {
  differences: FieldDifference[];
  photo: PhotoComparison;
  fsData: {
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    alternateNames: string[];
  };
  localData: {
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    alternateNames: string[];
  };
}

export interface UploadResult {
  success: boolean;
  uploaded: string[];
  errors: Array<{ field: string; error: string }>;
}

/**
 * Get FamilySearch data from SQLite cache
 *
 * This reads the cached data that was refreshed via the FamilySearch API
 * (using familysearch-refresh.service.ts) instead of scraping the web page.
 *
 * Data sources:
 * - person table: display_name, living status
 * - vital_event table: birth/death dates and places
 * - life_event table: more detailed event data
 * - claim table: aliases (predicate = 'alias')
 */
function getFamilySearchDataFromCache(canonicalId: string, fsId: string): {
  name: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  alternateNames: string[];
  living?: boolean;
} {
  // Get person data
  const person = sqliteService.queryOne<{
    display_name: string;
    living: number;
  }>(
    'SELECT display_name, living FROM person WHERE person_id = @personId',
    { personId: canonicalId }
  );

  if (!person) {
    return {
      name: '',
      alternateNames: [],
    };
  }

  // Get vital events (birth and death)
  const vitalEvents = sqliteService.queryAll<{
    event_type: string;
    date_original: string | null;
    place: string | null;
  }>(
    `SELECT event_type, date_original, place
     FROM vital_event
     WHERE person_id = @personId AND event_type IN ('birth', 'death')`,
    { personId: canonicalId }
  );

  let birthDate: string | undefined;
  let birthPlace: string | undefined;
  let deathDate: string | undefined;
  let deathPlace: string | undefined;

  for (const event of vitalEvents) {
    if (event.event_type === 'birth') {
      birthDate = event.date_original || undefined;
      birthPlace = event.place || undefined;
    } else if (event.event_type === 'death') {
      deathDate = event.date_original || undefined;
      deathPlace = event.place || undefined;
    }
  }

  // If no vital_event data, try life_event table
  if (!birthDate || !deathDate) {
    const lifeEvents = sqliteService.queryAll<{
      event_type: string;
      date_original: string | null;
      place_original: string | null;
    }>(
      `SELECT event_type, date_original, place_original
       FROM life_event
       WHERE person_id = @personId
         AND event_type IN ('http://gedcomx.org/Birth', 'http://gedcomx.org/Death')`,
      { personId: canonicalId }
    );

    for (const event of lifeEvents) {
      if (event.event_type === 'http://gedcomx.org/Birth') {
        if (!birthDate) birthDate = event.date_original || undefined;
        if (!birthPlace) birthPlace = event.place_original || undefined;
      } else if (event.event_type === 'http://gedcomx.org/Death') {
        if (!deathDate) deathDate = event.date_original || undefined;
        if (!deathPlace) deathPlace = event.place_original || undefined;
      }
    }
  }

  // Get alternate names from claims (aliases)
  const aliasClaims = sqliteService.queryAll<{ value_text: string }>(
    `SELECT value_text FROM claim
     WHERE person_id = @personId AND predicate = 'alias'`,
    { personId: canonicalId }
  );

  const alternateNames = aliasClaims.map(c => c.value_text).filter(Boolean);

  // Also try to get alternate names from the parsed cached data
  const parsedData = familySearchRefreshService.getParsedCachedData(fsId);
  if (parsedData?.alternateNames) {
    for (const name of parsedData.alternateNames) {
      if (!alternateNames.includes(name)) {
        alternateNames.push(name);
      }
    }
  }
  if (parsedData?.aliases) {
    for (const alias of parsedData.aliases) {
      if (!alternateNames.includes(alias)) {
        alternateNames.push(alias);
      }
    }
  }

  return {
    name: person.display_name || '',
    birthDate,
    birthPlace,
    deathDate,
    deathPlace,
    alternateNames,
    living: person.living === 1,
  };
}

export const familySearchUploadService = {
  /**
   * Compare local data with FamilySearch data for a person
   *
   * Uses cached data from SQLite/JSON that was refreshed via the FamilySearch API.
   * Call refreshPerson() first to ensure data is up-to-date.
   */
  async compareForUpload(dbId: string, personId: string): Promise<UploadComparisonResult> {
    // Resolve to canonical ID
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get the FamilySearch ID
    const fsId = idMappingService.getExternalId(canonical, 'familysearch');
    if (!fsId) {
      throw new Error('Person has no linked FamilySearch ID');
    }

    // Get local person data
    const person = await personService.getPerson(dbId, personId);
    if (!person) {
      throw new Error('Person not found in database');
    }

    // Get local overrides and claims
    const overrides = localOverrideService.getAllOverridesForPerson(canonical);
    const aliasClaims = localOverrideService.getClaimsForPerson(canonical, 'alias');

    // Build local data with overrides applied
    const nameOverride = overrides.personOverrides.find(o => o.fieldName === 'display_name');
    const birthDateOverride = overrides.eventOverrides.find(o => o.fieldName === 'birth_date');
    const birthPlaceOverride = overrides.eventOverrides.find(o => o.fieldName === 'birth_place');
    const deathDateOverride = overrides.eventOverrides.find(o => o.fieldName === 'death_date');
    const deathPlaceOverride = overrides.eventOverrides.find(o => o.fieldName === 'death_place');

    const localData = {
      name: nameOverride?.overrideValue || person.name,
      birthDate: birthDateOverride?.overrideValue || person.birth?.date || undefined,
      birthPlace: birthPlaceOverride?.overrideValue || person.birth?.place || undefined,
      deathDate: deathDateOverride?.overrideValue || person.death?.date || undefined,
      deathPlace: deathPlaceOverride?.overrideValue || person.death?.place || undefined,
      alternateNames: [
        ...(person.alternateNames || []),
        ...aliasClaims.map(c => c.value),
      ],
    };

    // Get FamilySearch data from cache (refreshed via API)
    // This avoids slow Playwright scraping - data should be refreshed first via refresh endpoint
    const fsData = getFamilySearchDataFromCache(canonical, fsId);

    // If no cached data found, we need to refresh first
    if (!fsData.name) {
      throw new Error('No cached FamilySearch data. Please click "Refresh from FamilySearch" first.');
    }

    // Handle "Living" status for death date comparison
    // Normalize "Living" to undefined for both sides so they match
    const fsDeathDate = fsData.living ? undefined : fsData.deathDate;
    const localDeathDateNormalized = localData.deathDate?.toLowerCase() === 'living' ? undefined : localData.deathDate;

    // Check for local photos (prioritize: ancestry > wikitree > wiki > familysearch)
    const photosDir = join(DATA_DIR, 'photos');
    const photoChecks = [
      { suffix: '-ancestry', path: join(photosDir, `${canonical}-ancestry.jpg`) },
      { suffix: '-ancestry', path: join(photosDir, `${canonical}-ancestry.png`) },
      { suffix: '-wikitree', path: join(photosDir, `${canonical}-wikitree.jpg`) },
      { suffix: '-wikitree', path: join(photosDir, `${canonical}-wikitree.png`) },
      { suffix: '-wiki', path: join(photosDir, `${canonical}-wiki.jpg`) },
      { suffix: '-wiki', path: join(photosDir, `${canonical}-wiki.png`) },
      { suffix: '', path: join(photosDir, `${canonical}.jpg`) },
      { suffix: '', path: join(photosDir, `${canonical}.png`) },
    ];

    let localPhotoPath: string | null = null;
    let localPhotoUrl: string | null = null;
    for (const check of photoChecks) {
      if (existsSync(check.path)) {
        localPhotoPath = check.path;
        // Build API URL for the photo (without /api prefix - client adds it)
        if (check.suffix === '-ancestry') {
          localPhotoUrl = `/augment/${canonical}/ancestry-photo`;
        } else if (check.suffix === '-wikitree') {
          localPhotoUrl = `/augment/${canonical}/wikitree-photo`;
        } else if (check.suffix === '-wiki') {
          localPhotoUrl = `/augment/${canonical}/wiki-photo`;
        } else {
          localPhotoUrl = `/browser/photos/${canonical}`;
        }
        break;
      }
    }

    // Check if FamilySearch has a photo (from scraped data)
    const fsPhotoPath = join(photosDir, `${canonical}.jpg`);
    const fsPngPath = join(photosDir, `${canonical}.png`);
    const fsHasPhoto = existsSync(fsPhotoPath) || existsSync(fsPngPath);

    // Photo differs if:
    // 1. We have a local photo from a different source than FS (ancestry/wikitree/wiki)
    // 2. We have any local photo and FS has no photo
    const photoDiffers = localPhotoPath !== null && (
      !fsHasPhoto ||
      localPhotoPath.includes('-ancestry') ||
      localPhotoPath.includes('-wikitree') ||
      localPhotoPath.includes('-wiki')
    );

    const photo: PhotoComparison = {
      localPhotoUrl,
      localPhotoPath,
      fsHasPhoto,
      photoDiffers,
    };

    // Calculate differences
    const differences: FieldDifference[] = [];

    // Name comparison
    if (localData.name !== fsData.name) {
      differences.push({
        field: 'name',
        label: 'Display Name',
        localValue: localData.name,
        fsValue: fsData.name,
        canUpload: true,
      });
    }

    // Birth date
    if (localData.birthDate !== fsData.birthDate) {
      differences.push({
        field: 'birthDate',
        label: 'Birth Date',
        localValue: localData.birthDate || null,
        fsValue: fsData.birthDate || null,
        canUpload: true,
      });
    }

    // Birth place
    if (localData.birthPlace !== fsData.birthPlace) {
      differences.push({
        field: 'birthPlace',
        label: 'Birth Place',
        localValue: localData.birthPlace || null,
        fsValue: fsData.birthPlace || null,
        canUpload: true,
      });
    }

    // Death date - use fsDeathDate which accounts for "Living" status
    // Show "Living" in the display if the person is marked as living on FS
    const fsDeathDateDisplay = fsData.living ? 'Living' : (fsDeathDate || undefined);

    if (localDeathDateNormalized !== fsDeathDate) {
      differences.push({
        field: 'deathDate',
        label: 'Death Date',
        localValue: localDeathDateNormalized || null,
        fsValue: fsDeathDateDisplay || null,
        canUpload: true,
      });
    }

    // Death place - only compare if person is not living on FS
    const fsDeathPlace = fsData.living ? undefined : fsData.deathPlace;
    if (localData.deathPlace !== fsDeathPlace) {
      differences.push({
        field: 'deathPlace',
        label: 'Death Place',
        localValue: localData.deathPlace || null,
        fsValue: fsDeathPlace || null,
        canUpload: true,
      });
    }

    // Alternate names - find names in local that aren't in FS
    const newAliases = localData.alternateNames.filter(
      name => !fsData.alternateNames.some(fsName =>
        fsName.toLowerCase() === name.toLowerCase()
      )
    );

    if (newAliases.length > 0) {
      differences.push({
        field: 'alternateNames',
        label: 'Alternate Names',
        localValue: newAliases,
        fsValue: fsData.alternateNames,
        canUpload: true,
      });
    }

    // Build the response fsData with proper death date display
    const responseFsData = {
      name: fsData.name,
      birthDate: fsData.birthDate,
      birthPlace: fsData.birthPlace,
      deathDate: fsDeathDateDisplay,
      deathPlace: fsDeathPlace,
      alternateNames: fsData.alternateNames,
    };

    return {
      differences,
      photo,
      fsData: responseFsData,
      localData,
    };
  },

  /**
   * Upload selected fields to FamilySearch
   */
  async uploadToFamilySearch(
    dbId: string,
    personId: string,
    fields: string[]
  ): Promise<UploadResult> {
    const result: UploadResult = {
      success: false,
      uploaded: [],
      errors: [],
    };

    if (fields.length === 0) {
      return result;
    }

    // Resolve to canonical ID
    const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get the FamilySearch ID
    const fsId = idMappingService.getExternalId(canonical, 'familysearch');
    if (!fsId) {
      result.errors.push({ field: '*', error: 'Person has no linked FamilySearch ID' });
      return result;
    }

    // Get comparison data
    const comparison = await this.compareForUpload(dbId, personId);

    // Ensure browser is connected
    if (!browserService.isConnected()) {
      const connected = await browserService.connect().catch(() => null);
      if (!connected) {
        result.errors.push({ field: '*', error: 'Browser not connected' });
        return result;
      }
    }

    // Navigate to FamilySearch vitals page for editing
    const vitalsUrl = `https://www.familysearch.org/tree/person/vitals/${fsId}`;
    const page = await browserService.navigateTo(vitalsUrl);

    if (!page) {
      result.errors.push({ field: '*', error: 'Failed to navigate to FamilySearch' });
      return result;
    }

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(2000);

    // Handle login if redirected
    const loggedIn = await this.handleLoginIfNeeded(page);
    if (loggedIn) {
      // Re-navigate to the vitals page after login
      await page.goto(vitalsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    // Verify we're actually logged in now
    const currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch.org') || currentUrl.includes('/signin') || currentUrl.includes('/identity/login')) {
      result.errors.push({ field: '*', error: 'Not logged in to FamilySearch. Please log in via the browser.' });
      return result;
    }

    // Process each selected field
    for (const field of fields) {
      // Handle photo specially - it's not in the differences array
      if (field === 'photo') {
        if (comparison.photo?.localPhotoPath) {
          const uploadResult = await this.uploadPhoto(page, fsId, comparison.photo.localPhotoPath)
            .catch(err => ({ success: false, error: err.message }));

          if (uploadResult.success) {
            result.uploaded.push(field);
          } else {
            result.errors.push({ field, error: uploadResult.error || 'Unknown error' });
          }
        }
        continue;
      }

      const diff = comparison.differences.find(d => d.field === field);
      if (!diff || !diff.canUpload) continue;

      const uploadResult = await this.uploadField(page, fsId, field, diff.localValue)
        .catch(err => ({ success: false, error: err.message }));

      if (uploadResult.success) {
        result.uploaded.push(field);
      } else {
        result.errors.push({ field, error: uploadResult.error || 'Unknown error' });
      }
    }

    result.success = result.errors.length === 0 && result.uploaded.length > 0;
    return result;
  },

  /**
   * Upload a single field to FamilySearch
   */
  async uploadField(
    page: Page,
    fsId: string,
    field: string,
    value: string | string[] | null
  ): Promise<{ success: boolean; error?: string }> {
    if (value === null) {
      return { success: false, error: 'Cannot upload null value' };
    }

    // Handle different field types
    switch (field) {
      case 'name':
        return this.uploadName(page, fsId, value as string);

      case 'birthDate':
      case 'birthPlace':
      case 'deathDate':
      case 'deathPlace':
        return this.uploadVitalEvent(page, fsId, field, value as string);

      case 'alternateNames':
        return this.uploadAlternateNames(page, fsId, value as string[]);

      case 'photo':
        return this.uploadPhoto(page, fsId, value as string);

      default:
        return { success: false, error: `Unknown field: ${field}` };
    }
  },

  /**
   * Detect FamilySearch login page and auto-login via Google OAuth.
   * Returns true if login was triggered, false if already logged in.
   */
  async handleLoginIfNeeded(page: Page): Promise<boolean> {
    const url = page.url();
    const isLoginPage = url.includes('ident.familysearch.org') ||
      url.includes('/identity/login') ||
      url.includes('/signin') ||
      url.includes('/auth/');

    if (!isLoginPage) return false;

    logger.auth('upload', 'Login page detected, clicking Continue with Google...');

    // Click "Continue with Google" button
    const googleButton = await page.$('#provider-link-google').catch(() => null);
    if (!googleButton) {
      logger.error('upload', 'Could not find Google login button');
      return false;
    }

    await googleButton.click();

    // Wait for Google OAuth flow to complete and redirect back to FamilySearch
    // Google may auto-login if session is active, or show account picker
    await page.waitForURL(url => url.toString().includes('familysearch.org/tree/'), { timeout: 30000 })
      .catch(() => null);

    // Extra wait for page to settle after redirect
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    if (finalUrl.includes('ident.familysearch.org') || finalUrl.includes('/identity/login')) {
      logger.error('upload', 'Still on login page after Google OAuth attempt');
      return false;
    }

    logger.ok('upload', 'Successfully logged in via Google');
    return true;
  },

  /**
   * Upload photo to FamilySearch
   * Uses the "Update portrait" button on the person details page
   */
  async uploadPhoto(page: Page, fsId: string, photoPath: string): Promise<{ success: boolean; error?: string }> {
    // Navigate to person details page
    const detailsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;
    await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Handle login if redirected
    const loggedIn = await this.handleLoginIfNeeded(page);
    if (loggedIn) {
      await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    const currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch.org') || currentUrl.includes('/signin') || currentUrl.includes('/identity/login')) {
      return { success: false, error: 'Not logged in to FamilySearch' };
    }

    // Step 1: Click the portrait/avatar area to open the "Add Portrait" dialog
    // Look for the portrait button or the avatar placeholder
    const portraitButton = await page.$(
      '[data-testid="update-portrait-button"], ' +
      'button[aria-label*="Update portrait"], ' +
      'button[aria-label*="portrait"], ' +
      'button[aria-label*="Add portrait"], ' +
      '.noPortraitContainerCss_nges2cu'
    );

    if (!portraitButton) {
      return { success: false, error: 'Could not find portrait button on page' };
    }

    logger.browser('upload', 'Clicking portrait button...');
    await portraitButton.click();
    await page.waitForTimeout(2000);

    // Step 2: Click the "Upload Photo" tab in the dialog
    const uploadTab = await page.$('div[role="tab"]:has-text("Upload Photo")');
    if (!uploadTab) {
      return { success: false, error: 'Could not find "Upload Photo" tab in portrait dialog' };
    }

    logger.browser('upload', 'Clicking "Upload Photo" tab...');
    await uploadTab.click();
    await page.waitForTimeout(1000);

    // Step 3: Set the file on the hidden file input
    const fileInput = await page.$('[data-testid="portraitUploadInput"], input[type="file"]');
    if (!fileInput) {
      return { success: false, error: 'Could not find file input for photo upload' };
    }

    logger.photo('upload', `Setting file input: ${photoPath}`);
    await fileInput.setInputFiles(photoPath);
    await page.waitForTimeout(3000);

    // Step 4: If crop/confirm dialog appears, zoom out as far as allowed before saving
    await page.waitForSelector('button[aria-label="Zoom Out"]', { timeout: 3000 }).catch(() => null);
    for (let i = 0; i < 12; i++) {
      const zoomOutButton = await page.$('button[aria-label="Zoom Out"]');
      if (!zoomOutButton) break;
      const ariaDisabled = await zoomOutButton.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') break;
      await zoomOutButton.click();
      await page.waitForTimeout(150);
    }

    // Step 5: After file is selected, FamilySearch may show a crop/confirm dialog
    // Look for Save/Done/Upload/Attach button
    const saveButton = await page.$(
      'button:has-text("Save"), ' +
      'button:has-text("Done"), ' +
      'button:has-text("Upload"), ' +
      'button:has-text("Attach"), ' +
      '[data-testid="save-button"], ' +
      '[data-testid="upload-button"]'
    );

    if (saveButton) {
      logger.browser('upload', 'Clicking save/confirm button...');
      await saveButton.click();
      await page.waitForTimeout(3000);
    }

    // Step 6: Check for success - the dialog should close or show success
    // Also check for any "Set as Portrait" button that may appear after upload
    const setPortraitButton = await page.$('button:has-text("Set as Portrait"), button:has-text("Set Portrait")');
    if (setPortraitButton) {
      logger.browser('upload', 'Clicking "Set as Portrait" button...');
      await setPortraitButton.click();
      await page.waitForTimeout(2000);
    }

    // Check for error messages
    const errorMessage = await page.$('.error-message, [role="alert"]:not(:empty)');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      if (errorText && !errorText.toLowerCase().includes('success')) {
        return { success: false, error: errorText };
      }
    }

    logger.ok('upload', 'Photo uploaded successfully');
    return { success: true };
  },

  /**
   * Upload display name to FamilySearch
   */
  async uploadName(page: Page, fsId: string, name: string): Promise<{ success: boolean; error?: string }> {
    // Navigate to name edit page
    const nameUrl = `https://www.familysearch.org/tree/person/vitals/${fsId}`;
    await page.goto(nameUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Click edit button for name
    const editButton = await page.$('[data-test="name-edit-button"], [data-testid="edit-name-button"], button:has-text("Edit"):near(h1)');
    if (!editButton) {
      // Try clicking on the name section to open edit mode
      const nameSection = await page.$('[data-test="NAME"], .name-section');
      if (nameSection) {
        await nameSection.click();
        await page.waitForTimeout(1000);
      } else {
        return { success: false, error: 'Could not find name edit button' };
      }
    } else {
      await editButton.click();
      await page.waitForTimeout(1000);
    }

    // Find and fill the name input
    const nameInput = await page.$('input[name="name"], input[data-test="full-name-input"], #fullName');
    if (!nameInput) {
      return { success: false, error: 'Could not find name input field' };
    }

    await nameInput.fill(name);
    await page.waitForTimeout(500);

    // Click save button
    const saveButton = await page.$('button[type="submit"]:has-text("Save"), button:has-text("Save")');
    if (!saveButton) {
      return { success: false, error: 'Could not find save button' };
    }

    await saveButton.click();
    await page.waitForTimeout(2000);

    // Check for success (no error messages visible)
    const errorMessage = await page.$('.error-message, [role="alert"]');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      return { success: false, error: errorText || 'Save failed' };
    }

    return { success: true };
  },

  /**
   * Upload vital event (birth/death date/place) to FamilySearch
   *
   * Handles two scenarios:
   * 1. Event already exists (conclusionDisplay:BIRTH/DEATH) - click to edit
   * 2. Event doesn't exist - click "Add Birth"/"Add Death" button to add new
   */
  async uploadVitalEvent(
    page: Page,
    fsId: string,
    field: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    const eventType = field.includes('birth') ? 'BIRTH' : 'DEATH';
    const eventTypeLower = eventType.toLowerCase();
    const eventLabel = eventType.charAt(0) + eventType.slice(1).toLowerCase(); // "Birth" or "Death"
    const fieldType = field.includes('Date') ? 'date' : 'place';

    // Navigate to vitals page
    const vitalsUrl = `https://www.familysearch.org/tree/person/vitals/${fsId}`;
    await page.goto(vitalsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // First, check if event data already exists (conclusionDisplay element)
    const existingEventSection = await page.$(`[data-testid="conclusionDisplay:${eventType}"]`);

    if (existingEventSection) {
      // Event exists - click to edit
      logger.browser('upload', `Found existing ${eventLabel} data, clicking to edit...`);
      await existingEventSection.click();
      await page.waitForTimeout(1500);
    } else {
      // Event doesn't exist - need to find and click the "Add Birth"/"Add Death" button
      // FamilySearch shows: <strong>Birth</strong><br><button aria-label="Add Birth" data-testid="conclusion:add:button">
      logger.browser('upload', `No existing ${eventLabel} data, looking for Add button...`);

      // Look for the "Add Birth" or "Add Death" button by aria-label
      const addButton = await page.$(`button[aria-label="Add ${eventLabel}"]`);
      if (!addButton) {
        // Fallback: look for conclusion:add:button near the Birth/Death heading
        // This is trickier since multiple sections use the same data-testid
        return { success: false, error: `Could not find ${eventLabel} section or Add ${eventLabel} button. The Vitals section may have a different layout.` };
      }

      logger.browser('upload', `Clicking "Add ${eventLabel}" button...`);
      await addButton.click();
      await page.waitForTimeout(1500);
    }

    // Wait for the edit dialog/form to appear
    // FamilySearch opens a dialog for editing vital events
    await page.waitForSelector('[role="dialog"], .dialogContainerCss, form', { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);

    // Find the appropriate input field
    // For date: look for date input in the dialog
    // For place: look for place/location input
    let input = null;

    if (fieldType === 'date') {
      // Date input selectors (in order of preference)
      input = await page.$(
        '[role="dialog"] input[data-testid*="date" i], ' +
        '[role="dialog"] input[name*="date" i], ' +
        '[role="dialog"] input[placeholder*="date" i], ' +
        '[role="dialog"] input[aria-label*="date" i], ' +
        'input[data-testid*="date" i], ' +
        'input[name*="date" i]'
      );
    } else {
      // Place input selectors
      input = await page.$(
        '[role="dialog"] input[data-testid*="place" i], ' +
        '[role="dialog"] input[name*="place" i], ' +
        '[role="dialog"] input[placeholder*="place" i], ' +
        '[role="dialog"] input[aria-label*="place" i], ' +
        '[role="dialog"] input[data-testid*="location" i], ' +
        'input[data-testid*="place" i], ' +
        'input[name*="place" i]'
      );
    }

    if (!input) {
      return { success: false, error: `Could not find ${eventLabel} ${fieldType} input field in the edit dialog` };
    }

    logger.browser('upload', `Filling ${eventLabel} ${fieldType}: "${value}"`);
    await input.fill(value);
    await page.waitForTimeout(500);

    // Click save button (usually in the dialog)
    const saveButton = await page.$(
      '[role="dialog"] button:has-text("Save"), ' +
      '[role="dialog"] button[type="submit"], ' +
      'button[data-testid="save-button"], ' +
      'button:has-text("Save")'
    );
    if (!saveButton) {
      return { success: false, error: 'Could not find Save button in the edit dialog' };
    }

    logger.browser('upload', 'Clicking Save button...');
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Check for error messages (ignore alert role inside dialogs)
    const errorMessage = await page.$('.error-message, [role="alert"]:not([role="dialog"] *)');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      if (errorText && !errorText.toLowerCase().includes('success')) {
        return { success: false, error: errorText || 'Save failed' };
      }
    }

    logger.ok('upload', `${eventLabel} ${fieldType} saved successfully`);
    return { success: true };
  },

  /**
   * Upload alternate names to FamilySearch
   */
  async uploadAlternateNames(
    page: Page,
    fsId: string,
    names: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const errors: string[] = [];

    // Navigate to person details page
    const detailsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;
    await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    for (const name of names) {
      // Click "Add Alternate Name" button - use data-testid which is most reliable
      const addButton = await page.$('[data-testid="add-alternate-name"], button:has-text("Add Alternate Name"), [data-test="add-alternate-name"]');

      if (!addButton) {
        // Try to find the names section and look for an add button there
        const namesSection = await page.$('[data-testid="alternate-names-section"], [data-test="OTHER_NAMES"], .other-names-section');
        if (namesSection) {
          const addInSection = await namesSection.$('button:has-text("Add"), [data-testid="add-alternate-name"]');
          if (addInSection) {
            await addInSection.click();
          } else {
            errors.push(`Could not find add button for name: ${name}`);
            continue;
          }
        } else {
          errors.push(`Could not find alternate names section for: ${name}`);
          continue;
        }
      } else {
        await addButton.click();
      }

      await page.waitForTimeout(1000);

      // Select "Alternate Name" from dropdown if present
      const typeDropdown = await page.$('select[name="nameType"], [data-testid="name-type-select"], [data-test="name-type-select"]');
      if (typeDropdown) {
        await typeDropdown.selectOption({ label: 'Also Known As' });
        await page.waitForTimeout(500);
      }

      // Fill in the name - look for input in a modal/dialog that just appeared
      const nameInput = await page.$('input[name="alternateName"], input[data-testid="alternate-name-input"], input[data-test="name-input"], input[placeholder*="name" i], dialog input[type="text"], [role="dialog"] input[type="text"]');
      if (!nameInput) {
        errors.push(`Could not find input field for name: ${name}`);
        continue;
      }

      await nameInput.fill(name);
      await page.waitForTimeout(500);

      // Save - look in dialog first
      const saveButton = await page.$('dialog button:has-text("Save"), [role="dialog"] button:has-text("Save"), button[type="submit"]:has-text("Save"), button:has-text("Save")');
      if (!saveButton) {
        errors.push(`Could not find save button for name: ${name}`);
        continue;
      }

      await saveButton.click();
      await page.waitForTimeout(2000);

      const errorMessage = await page.$('.error-message, [role="alert"]:not([role="dialog"])');
      if (errorMessage) {
        const errorText = await errorMessage.textContent();
        if (errorText && !errorText.includes('success')) {
          errors.push(`Failed to save "${name}": ${errorText}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  },
};
