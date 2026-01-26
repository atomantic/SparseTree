import { Page } from 'playwright';
import type { ProviderTreeInfo, ScrapedPersonData } from '@fsf/shared';
import type { ProviderScraper, LoginSelectors } from './base.scraper.js';
import { PROVIDER_DEFAULTS, performLoginWithSelectors, scrapeAncestorsBFS, isPlaceholderImage } from './base.scraper.js';

const PROVIDER_INFO = PROVIDER_DEFAULTS.familysearch;

const LOGIN_SELECTORS: LoginSelectors = {
  usernameInput: '#userName, input[name="userName"]',
  passwordInput: '#password, input[name="password"]',
  submitButton: 'button[type="submit"]',
  successIndicator: '[data-testid="user-menu"], .user-menu, #user-menu',
  errorIndicator: '.error-message, .alert-error, [data-testid="error-message"]'
};

/**
 * FamilySearch browser-based scraper
 */
export const familySearchScraper: ProviderScraper = {
  provider: 'familysearch',
  displayName: PROVIDER_INFO.displayName,
  loginUrl: PROVIDER_INFO.loginUrl,
  treeUrlPattern: PROVIDER_INFO.treeUrlPattern,
  loginSelectors: LOGIN_SELECTORS,

  async checkLoginStatus(page: Page): Promise<boolean> {
    const url = page.url();

    // If we're on a FamilySearch page, check for login indicators
    if (url.includes('familysearch.org')) {
      // Check if redirected to signin
      if (url.includes('/signin') || url.includes('/auth/')) {
        return false;
      }

      // Check for user menu or logged-in indicator
      const userMenu = await page.$('[data-testid="user-menu"], .user-menu, #user-menu').catch(() => null);
      if (userMenu) return true;

      // Check for sign-in button (indicates NOT logged in)
      const signInBtn = await page.$('[data-testid="sign-in-button"], .sign-in-link, a[href*="/signin"]').catch(() => null);
      return !signInBtn;
    }

    // Navigate to FamilySearch to check
    await page.goto('https://www.familysearch.org/tree/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    return !page.url().includes('/signin') && !page.url().includes('/auth/');
  },

  async getLoggedInUser(page: Page): Promise<{ name?: string; userId?: string } | null> {
    const isLoggedIn = await this.checkLoginStatus(page);
    if (!isLoggedIn) return null;

    // Extract user name from user menu on current page (don't navigate away)
    const name = await page.$eval(
      '[data-testid="user-menu"] span, .user-menu .user-name, #user-name, [data-testid="header-user-name"]',
      el => el.textContent?.trim()
    ).catch(() => undefined);

    return { name };
  },

  async listTrees(_page: Page): Promise<ProviderTreeInfo[]> {
    // FamilySearch has a single shared tree, not multiple trees
    return [{
      provider: 'familysearch',
      treeId: 'shared',
      treeName: 'FamilySearch Shared Tree',
      personCount: undefined,
      rootPersonId: undefined
    }];
  },

  async scrapePersonById(page: Page, externalId: string): Promise<ScrapedPersonData> {
    const url = `https://www.familysearch.org/tree/person/details/${externalId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check for login redirect
    if (page.url().includes('/signin')) {
      throw new Error('Not authenticated - please log in to FamilySearch');
    }

    return extractPersonData(page, externalId);
  },

  async *scrapeAncestors(
    page: Page,
    rootId: string,
    maxGenerations = 10
  ): AsyncGenerator<ScrapedPersonData, void, undefined> {
    yield* scrapeAncestorsBFS(page, rootId, (p, id) => this.scrapePersonById(p, id), {
      maxGenerations,
      ...PROVIDER_INFO.rateLimitDefaults,
    });
  },

  getPersonUrl(externalId: string): string {
    return `https://www.familysearch.org/tree/person/details/${externalId}`;
  },

  getPersonEditUrl(externalId: string): string {
    return `https://www.familysearch.org/tree/person/details/${externalId}`;
  },

  async performLogin(page: Page, username: string, password: string): Promise<boolean> {
    return performLoginWithSelectors(page, this.loginUrl, LOGIN_SELECTORS, (p) => this.checkLoginStatus(p), username, password);
  }
};

/**
 * Extract person data from a FamilySearch person details page
 */
async function extractPersonData(page: Page, personId: string): Promise<ScrapedPersonData> {
  const data: ScrapedPersonData = {
    externalId: personId,
    provider: 'familysearch',
    name: '',
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString()
  };

  // Extract photo URL
  data.photoUrl = await extractPhotoUrl(page);

  // Get full name
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
        data.name = text.trim();
        break;
      }
    }
  }

  // Get vital information
  const birthDate = await extractText(page, '[data-testid="birth-date"], .birth-date, .vital-birth .date');
  const birthPlace = await extractText(page, '[data-testid="birth-place"], .birth-place, .vital-birth .place');
  const deathDate = await extractText(page, '[data-testid="death-date"], .death-date, .vital-death .date');
  const deathPlace = await extractText(page, '[data-testid="death-place"], .death-place, .vital-death .place');

  if (birthDate || birthPlace) {
    data.birth = { date: birthDate, place: birthPlace };
  }
  if (deathDate || deathPlace) {
    data.death = { date: deathDate, place: deathPlace };
  }

  // Get gender
  const genderEl = await page.$('[data-testid="sex-value"], .sex-value, .gender').catch(() => null);
  if (genderEl) {
    const genderText = (await genderEl.textContent().catch(() => ''))?.toLowerCase();
    if (genderText?.includes('male') && !genderText?.includes('female')) {
      data.gender = 'male';
    } else if (genderText?.includes('female')) {
      data.gender = 'female';
    } else {
      data.gender = 'unknown';
    }
  }

  // Get parent IDs and names from family members section
  const parentIds = await extractParentIds(page, personId);
  data.fatherExternalId = parentIds.fatherId;
  data.motherExternalId = parentIds.motherId;

  // Extract parent names from DOM
  const parentNames = await extractParentNames(page);
  data.fatherName = parentNames.fatherName;
  data.motherName = parentNames.motherName;

  // Extract children count
  data.childrenCount = await extractChildrenCount(page);

  return data;
}

/**
 * Extract photo URL from person page
 */
async function extractPhotoUrl(page: Page): Promise<string | undefined> {
  // Try multiple selectors for profile photo
  const photoSelectors = [
    '[data-testid="update-portrait-button"]',
    '[data-testid="person-portrait"] img',
    '.person-portrait img',
    '.portrait-container img',
    '.fs-person-portrait img',
    '[data-testid="artifact-image"]',
    '.artifact-image img'
  ];

  for (const selector of photoSelectors) {
    // Special handling for update-portrait-button
    if (selector === '[data-testid="update-portrait-button"]') {
      const src = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="update-portrait-button"]');
        if (!btn) return null;
        const container = btn.parentElement;
        if (!container) return null;
        const img = container.querySelector('img[class*="imageCss"]');
        return img?.getAttribute('src') || null;
      }).catch(() => null);

      if (src && !isPlaceholderImage(src)) {
        return src.startsWith('//') ? `https:${src}` : src;
      }
      continue;
    }

    const photoImg = await page.$(selector).catch(() => null);
    if (photoImg) {
      const src = await photoImg.getAttribute('src').catch(() => null);
      if (src && !isPlaceholderImage(src)) {
        return src.startsWith('//') ? `https:${src}` : src;
      }
    }
  }

  // Final attempt: search in DOM context
  const src = await page.evaluate(() => {
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
    return src.startsWith('//') ? `https:${src}` : src;
  }

  return undefined;
}

/**
 * Extract parent IDs from the family section
 */
async function extractParentIds(
  page: Page,
  _personId: string
): Promise<{ fatherId?: string; motherId?: string }> {
  const result: { fatherId?: string; motherId?: string } = {};

  // Look for parent links on the person page
  const parentLinks = await page.$$eval(
    'a[href*="/tree/person/"][data-testid*="parent"], a[href*="/tree/person/details/"]',
    (links) => {
      return links
        .filter(link => {
          const text = link.closest('[data-testid*="father"], [data-testid*="mother"], .parent')?.getAttribute('data-testid') || '';
          return text.includes('father') || text.includes('mother');
        })
        .map(link => ({
          href: link.getAttribute('href'),
          role: link.closest('[data-testid*="father"]') ? 'father' : 'mother'
        }));
    }
  ).catch(() => []);

  for (const link of parentLinks) {
    const match = link.href?.match(/\/tree\/person\/(?:details\/)?([A-Z0-9-]+)/);
    if (match) {
      if (link.role === 'father') {
        result.fatherId = match[1];
      } else {
        result.motherId = match[1];
      }
    }
  }

  return result;
}

/**
 * Extract parent names from the family section of a person details page
 */
async function extractParentNames(page: Page): Promise<{ fatherName?: string; motherName?: string }> {
  const result: { fatherName?: string; motherName?: string } = {};

  // Try to get parent names from the family section using data-testid attributes
  const parentInfo = await page.evaluate(() => {
    const names: { father?: string; mother?: string } = {};

    // Try data-testid based selectors for father/mother
    const fatherEl = document.querySelector('[data-testid*="father"] a, [data-testid*="father"] .name, [data-testid*="father"]');
    if (fatherEl) {
      const nameEl = fatherEl.querySelector('a[href*="/tree/person/"]') || fatherEl;
      const text = nameEl.textContent?.trim();
      if (text && text.length > 1 && !text.includes('Add')) names.father = text;
    }

    const motherEl = document.querySelector('[data-testid*="mother"] a, [data-testid*="mother"] .name, [data-testid*="mother"]');
    if (motherEl) {
      const nameEl = motherEl.querySelector('a[href*="/tree/person/"]') || motherEl;
      const text = nameEl.textContent?.trim();
      if (text && text.length > 1 && !text.includes('Add')) names.mother = text;
    }

    // Fallback: look for parent section with links
    if (!names.father || !names.mother) {
      const parentLinks = document.querySelectorAll('a[href*="/tree/person/details/"]');
      parentLinks.forEach(link => {
        const container = link.closest('[data-testid]');
        const testId = container?.getAttribute('data-testid') || '';
        const text = link.textContent?.trim();
        if (!text || text.length < 2) return;
        if (testId.includes('father') && !names.father) names.father = text;
        if (testId.includes('mother') && !names.mother) names.mother = text;
      });
    }

    return names;
  }).catch((): { father?: string; mother?: string } => ({}));

  result.fatherName = parentInfo.father;
  result.motherName = parentInfo.mother;

  return result;
}

/**
 * Extract children count from the family section
 */
async function extractChildrenCount(page: Page): Promise<number | undefined> {
  const count = await page.evaluate(() => {
    // Look for children section with child links
    const childrenSection = document.querySelector('[data-testid*="children"], [data-testid*="child"]');
    if (childrenSection) {
      const childLinks = childrenSection.querySelectorAll('a[href*="/tree/person/"]');
      if (childLinks.length > 0) return childLinks.length;
    }

    // Fallback: count child elements in the family section
    const allLinks = document.querySelectorAll('a[href*="/tree/person/details/"]');
    let childCount = 0;
    allLinks.forEach(link => {
      const container = link.closest('[data-testid]');
      const testId = container?.getAttribute('data-testid') || '';
      if (testId.includes('child')) childCount++;
    });

    return childCount > 0 ? childCount : undefined;
  }).catch(() => undefined);

  return count;
}

/**
 * Extract text from first matching selector
 */
async function extractText(page: Page, selector: string): Promise<string | undefined> {
  const el = await page.$(selector).catch(() => null);
  if (el) {
    const text = await el.textContent().catch(() => null);
    return text?.trim() || undefined;
  }
  return undefined;
}

