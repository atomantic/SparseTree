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
    // If the person is marked as living on FS, there's no death date to compare
    const fsDeathDate = fsData.living ? undefined : fsData.deathDate;

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
        // Build API URL for the photo
        if (check.suffix === '-ancestry') {
          localPhotoUrl = `/api/augment/${canonical}/ancestry-photo`;
        } else if (check.suffix === '-wikitree') {
          localPhotoUrl = `/api/augment/${canonical}/wikitree-photo`;
        } else if (check.suffix === '-wiki') {
          localPhotoUrl = `/api/augment/${canonical}/wiki-photo`;
        } else {
          localPhotoUrl = `/api/browser/photos/${canonical}`;
        }
        break;
      }
    }

    // Check if FamilySearch has a photo (from scraped data)
    const fsPhotoPath = join(photosDir, `${canonical}.jpg`);
    const fsPngPath = join(photosDir, `${canonical}.png`);
    const fsHasPhoto = existsSync(fsPhotoPath) || existsSync(fsPngPath);

    // Photo differs if we have a local photo from a different source than FS
    // (i.e., ancestry/wikitree/wiki photo exists but FS photo might be different)
    const photoDiffers = localPhotoPath !== null && (
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

    if (localData.deathDate !== fsDeathDate) {
      differences.push({
        field: 'deathDate',
        label: 'Death Date',
        localValue: localData.deathDate || null,
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

    // Check if logged in
    if (page.url().includes('/signin')) {
      result.errors.push({ field: '*', error: 'Not logged in to FamilySearch' });
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
   * Upload photo to FamilySearch
   * Uses the "Update portrait" button on the person details page
   */
  async uploadPhoto(page: Page, fsId: string, photoPath: string): Promise<{ success: boolean; error?: string }> {
    // Navigate to person details page
    const detailsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;
    await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check if logged in
    if (page.url().includes('/signin')) {
      return { success: false, error: 'Not logged in to FamilySearch' };
    }

    // Find the "Update portrait" button
    // data-testid="update-portrait-button" or the button with aria-label containing "Update portrait"
    const portraitButton = await page.$('[data-testid="update-portrait-button"], button[aria-label*="Update portrait"], button[aria-label*="portrait"]');

    if (!portraitButton) {
      return { success: false, error: 'Could not find portrait update button' };
    }

    // Click the portrait button to open the upload dialog
    await portraitButton.click();
    await page.waitForTimeout(1500);

    // Look for file input - FamilySearch typically uses a hidden file input
    // The input may be created dynamically after clicking the button
    const fileInput = await page.$('input[type="file"]');

    if (!fileInput) {
      // Try waiting a bit more for the input to appear
      await page.waitForTimeout(1000);
      const fileInputRetry = await page.$('input[type="file"]');
      if (!fileInputRetry) {
        return { success: false, error: 'Could not find file input for photo upload' };
      }
      // Upload the file
      await fileInputRetry.setInputFiles(photoPath);
    } else {
      // Upload the file
      await fileInput.setInputFiles(photoPath);
    }

    await page.waitForTimeout(2000);

    // Look for a "Save" or "Upload" or "Done" button in the dialog
    const saveButton = await page.$('button:has-text("Save"), button:has-text("Upload"), button:has-text("Done"), button:has-text("Attach"), [data-testid="save-button"], [data-testid="upload-button"]');

    if (saveButton) {
      await saveButton.click();
      await page.waitForTimeout(3000);
    }

    // Check for any error messages
    const errorMessage = await page.$('.error-message, [role="alert"]:not(:empty)');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      if (errorText && !errorText.toLowerCase().includes('success')) {
        return { success: false, error: errorText };
      }
    }

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
   */
  async uploadVitalEvent(
    page: Page,
    fsId: string,
    field: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    const eventType = field.includes('birth') ? 'BIRTH' : 'DEATH';
    const fieldType = field.includes('Date') ? 'date' : 'place';

    // Navigate to vitals page
    const vitalsUrl = `https://www.familysearch.org/tree/person/vitals/${fsId}`;
    await page.goto(vitalsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Find the event section
    const eventSection = await page.$(`[data-test="${eventType}"], .${eventType.toLowerCase()}-section`);
    if (!eventSection) {
      return { success: false, error: `Could not find ${eventType} section` };
    }

    // Click edit button
    const editButton = await eventSection.$('button:has-text("Edit"), [data-test="edit-button"]');
    if (!editButton) {
      // Try clicking on the section itself
      await eventSection.click();
      await page.waitForTimeout(1000);
    } else {
      await editButton.click();
      await page.waitForTimeout(1000);
    }

    // Find the appropriate input
    const inputSelector = fieldType === 'date'
      ? `input[name="${eventType.toLowerCase()}Date"], input[data-test="${eventType.toLowerCase()}-date"], .date-input`
      : `input[name="${eventType.toLowerCase()}Place"], input[data-test="${eventType.toLowerCase()}-place"], .place-input`;

    const input = await page.$(inputSelector);
    if (!input) {
      return { success: false, error: `Could not find ${eventType} ${fieldType} input` };
    }

    await input.fill(value);
    await page.waitForTimeout(500);

    // Click save
    const saveButton = await page.$('button[type="submit"]:has-text("Save"), button:has-text("Save")');
    if (!saveButton) {
      return { success: false, error: 'Could not find save button' };
    }

    await saveButton.click();
    await page.waitForTimeout(2000);

    const errorMessage = await page.$('.error-message, [role="alert"]');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      return { success: false, error: errorText || 'Save failed' };
    }

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
