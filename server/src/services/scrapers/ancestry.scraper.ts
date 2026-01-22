import { Page } from 'playwright';
import type { ProviderTreeInfo, ScrapedPersonData } from '@fsf/shared';
import type { ProviderScraper, LoginSelectors } from './base.scraper.js';
import { PROVIDER_DEFAULTS } from './base.scraper.js';

const PROVIDER_INFO = PROVIDER_DEFAULTS.ancestry;

const LOGIN_SELECTORS: LoginSelectors = {
  usernameInput: '#username, input[name="username"]',
  passwordInput: '#password, input[name="password"]',
  submitButton: '#signInBtn, button[type="submit"]',
  successIndicator: '#navAccount, .userNav, [data-test="user-menu"]',
  errorIndicator: '.errorMessage, .error-message, [data-test="error-message"]'
};

/**
 * Ancestry browser-based scraper
 */
export const ancestryScraper: ProviderScraper = {
  provider: 'ancestry',
  displayName: PROVIDER_INFO.displayName,
  loginUrl: PROVIDER_INFO.loginUrl,
  treeUrlPattern: PROVIDER_INFO.treeUrlPattern,
  loginSelectors: LOGIN_SELECTORS,

  async checkLoginStatus(page: Page): Promise<boolean> {
    const url = page.url();

    // Check if on Ancestry
    if (url.includes('ancestry.com')) {
      // Check for signin redirect
      if (url.includes('/account/signin') || url.includes('/login')) {
        return false;
      }

      // Check for user menu
      const userMenu = await page.$('#navAccount, .userNav, [data-test="user-menu"]').catch(() => null);
      if (userMenu) return true;

      // Check for sign-in link
      const signInLink = await page.$('a[href*="/signin"], a[href*="signin"]').catch(() => null);
      return !signInLink;
    }

    // Navigate to Ancestry to check
    await page.goto('https://www.ancestry.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const userMenu = await page.$('#navAccount, .userNav, [data-test="user-menu"]').catch(() => null);
    return !!userMenu;
  },

  async getLoggedInUser(page: Page): Promise<{ name?: string; userId?: string } | null> {
    const isLoggedIn = await this.checkLoginStatus(page);
    if (!isLoggedIn) return null;

    // Try to get name from user menu
    const name = await page.$eval(
      '#navAccount .displayName, .userNav .name, [data-test="user-name"]',
      el => el.textContent?.trim()
    ).catch(() => undefined);

    return { name, userId: undefined };
  },

  async listTrees(page: Page): Promise<ProviderTreeInfo[]> {
    // Navigate to tree list
    await page.goto('https://www.ancestry.com/family-tree/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Extract tree information
    const trees = await page.$$eval(
      '.treeCard, .tree-item, [data-test="tree-card"]',
      (cards) => cards.map(card => {
        const nameEl = card.querySelector('.treeName, .tree-name, h3, h4');
        const linkEl = card.querySelector('a[href*="/tree/"]');
        const countEl = card.querySelector('.personCount, .member-count');

        const href = linkEl?.getAttribute('href') || '';
        const treeIdMatch = href.match(/\/tree\/(\d+)/);

        return {
          provider: 'ancestry' as const,
          treeId: treeIdMatch?.[1] || '',
          treeName: nameEl?.textContent?.trim() || 'Unnamed Tree',
          personCount: parseInt(countEl?.textContent?.replace(/\D/g, '') || '0', 10) || undefined,
          rootPersonId: undefined
        };
      })
    ).catch(() => []);

    return trees.filter(t => t.treeId);
  },

  async scrapePersonById(page: Page, externalId: string): Promise<ScrapedPersonData> {
    // Ancestry person URLs include tree ID
    // Format: https://www.ancestry.com/family-tree/person/tree/{treeId}/person/{personId}/facts
    // We need the full URL or parse from context
    const currentUrl = page.url();
    const treeMatch = currentUrl.match(/\/tree\/(\d+)/);

    if (!treeMatch) {
      throw new Error('Tree ID required - please navigate to a tree first');
    }

    const treeId = treeMatch[1];
    const url = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${externalId}/facts`;

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check for login redirect
    if (page.url().includes('/signin') || page.url().includes('/login')) {
      throw new Error('Not authenticated - please log in to Ancestry');
    }

    return extractAncestryPerson(page, externalId);
  },

  async *scrapeAncestors(
    page: Page,
    rootId: string,
    maxGenerations = 10
  ): AsyncGenerator<ScrapedPersonData, void, undefined> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; generation: number }> = [{ id: rootId, generation: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id) || current.generation > maxGenerations) {
        continue;
      }

      visited.add(current.id);

      const personData = await this.scrapePersonById(page, current.id);
      yield personData;

      // Add parents to queue
      if (personData.fatherExternalId && !visited.has(personData.fatherExternalId)) {
        queue.push({ id: personData.fatherExternalId, generation: current.generation + 1 });
      }
      if (personData.motherExternalId && !visited.has(personData.motherExternalId)) {
        queue.push({ id: personData.motherExternalId, generation: current.generation + 1 });
      }

      // Random delay for rate limiting
      const delay = 1000 + Math.random() * 2000;
      await page.waitForTimeout(delay);
    }
  },

  getPersonUrl(externalId: string): string {
    // Without tree ID, return a search URL
    return `https://www.ancestry.com/search/?name=${externalId}`;
  },

  getPersonEditUrl(externalId: string): string {
    return this.getPersonUrl(externalId);
  },

  async performLogin(page: Page, username: string, password: string): Promise<boolean> {
    // Navigate to login page
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check if already logged in
    const alreadyLoggedIn = await this.checkLoginStatus(page);
    if (alreadyLoggedIn) {
      return true;
    }

    // Fill in username
    const usernameInput = await page.$(LOGIN_SELECTORS.usernameInput);
    if (!usernameInput) {
      return false;
    }
    await usernameInput.fill(username);

    // Fill in password
    const passwordInput = await page.$(LOGIN_SELECTORS.passwordInput);
    if (!passwordInput) {
      return false;
    }
    await passwordInput.fill(password);

    // Click submit
    const submitButton = await page.$(LOGIN_SELECTORS.submitButton);
    if (!submitButton) {
      return false;
    }
    await submitButton.click();

    // Wait for navigation or success indicator
    await page.waitForTimeout(5000);

    // Check for error
    if (LOGIN_SELECTORS.errorIndicator) {
      const errorEl = await page.$(LOGIN_SELECTORS.errorIndicator);
      if (errorEl) {
        const isVisible = await errorEl.isVisible().catch(() => false);
        if (isVisible) {
          return false;
        }
      }
    }

    // Check for success
    return await this.checkLoginStatus(page);
  }
};

/**
 * Extract person data from Ancestry person page
 */
async function extractAncestryPerson(page: Page, personId: string): Promise<ScrapedPersonData> {
  const data: ScrapedPersonData = {
    externalId: personId,
    provider: 'ancestry',
    name: '',
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString()
  };

  // Extract name
  data.name = await page.$eval(
    '.personName, .person-name, h1[data-test="person-name"]',
    el => el.textContent?.trim() || ''
  ).catch(() => '');

  // Extract photo
  const photoSrc = await page.$eval(
    '.personPhoto img, .person-photo img, [data-test="person-photo"] img',
    el => el.getAttribute('src')
  ).catch(() => null);

  if (photoSrc && !photoSrc.includes('default') && !photoSrc.includes('silhouette')) {
    data.photoUrl = photoSrc;
  }

  // Extract vital events
  const birthDate = await extractAncestryFact(page, 'birth', 'date');
  const birthPlace = await extractAncestryFact(page, 'birth', 'place');
  const deathDate = await extractAncestryFact(page, 'death', 'date');
  const deathPlace = await extractAncestryFact(page, 'death', 'place');

  if (birthDate || birthPlace) {
    data.birth = { date: birthDate, place: birthPlace };
  }
  if (deathDate || deathPlace) {
    data.death = { date: deathDate, place: deathPlace };
  }

  // Extract gender
  const genderText = await page.$eval(
    '[data-test="gender"], .gender, .sex',
    el => el.textContent?.toLowerCase() || ''
  ).catch(() => '');

  if (genderText.includes('male') && !genderText.includes('female')) {
    data.gender = 'male';
  } else if (genderText.includes('female')) {
    data.gender = 'female';
  }

  // Extract parent IDs
  const parents = await extractAncestryParents(page);
  data.fatherExternalId = parents.fatherId;
  data.motherExternalId = parents.motherId;

  return data;
}

/**
 * Extract fact value from Ancestry person page
 */
async function extractAncestryFact(page: Page, factType: string, field: 'date' | 'place'): Promise<string | undefined> {
  const selector = field === 'date'
    ? `[data-test="${factType}-date"], .${factType}Date, .${factType} .date`
    : `[data-test="${factType}-place"], .${factType}Place, .${factType} .place`;

  const value = await page.$eval(selector, el => el.textContent?.trim()).catch(() => undefined);
  return value || undefined;
}

/**
 * Extract parent IDs from Ancestry family section
 */
async function extractAncestryParents(page: Page): Promise<{ fatherId?: string; motherId?: string }> {
  const result: { fatherId?: string; motherId?: string } = {};

  // Look for parent links
  const fatherLink = await page.$eval(
    'a[data-test="father-link"], a[href*="/person/"][data-rel="father"]',
    el => el.getAttribute('href')
  ).catch(() => null);

  const motherLink = await page.$eval(
    'a[data-test="mother-link"], a[href*="/person/"][data-rel="mother"]',
    el => el.getAttribute('href')
  ).catch(() => null);

  if (fatherLink) {
    const match = fatherLink.match(/\/person\/(\d+)/);
    if (match) result.fatherId = match[1];
  }

  if (motherLink) {
    const match = motherLink.match(/\/person\/(\d+)/);
    if (match) result.motherId = match[1];
  }

  return result;
}
