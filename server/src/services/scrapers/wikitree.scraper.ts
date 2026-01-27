import { Page } from 'playwright';
import type { ProviderTreeInfo, ScrapedPersonData } from '@fsf/shared';
import type { ProviderScraper, LoginSelectors } from './base.scraper.js';
import { PROVIDER_DEFAULTS, performLoginWithSelectors, scrapeAncestorsBFS } from './base.scraper.js';

const PROVIDER_INFO = PROVIDER_DEFAULTS.wikitree;

const LOGIN_SELECTORS: LoginSelectors = {
  usernameInput: '#wpName1, input[name="wpName"]',
  passwordInput: '#wpPassword1, input[name="wpPassword"]',
  submitButton: '#wpLoginAttempt, input[type="submit"]',
  successIndicator: '#my-wikitree, .my-wikitree, a[href*="/wiki/"][href*="User:"]',
  errorIndicator: '.error, .errorbox, .loginError'
};

/**
 * WikiTree browser-based scraper
 * WikiTree has public profiles, so many features work without login
 */
export const wikiTreeScraper: ProviderScraper = {
  provider: 'wikitree',
  displayName: PROVIDER_INFO.displayName,
  loginUrl: PROVIDER_INFO.loginUrl,
  treeUrlPattern: PROVIDER_INFO.treeUrlPattern,
  loginSelectors: LOGIN_SELECTORS,

  async checkLoginStatus(page: Page): Promise<boolean> {
    const url = page.url();

    // Check if on WikiTree
    if (url.includes('wikitree.com')) {
      // Look for login link (present when NOT logged in)
      const loginLink = await page.$('a[href*="Special:Userlogin"]').catch(() => null);
      if (loginLink) {
        const isVisible = await loginLink.isVisible().catch(() => false);
        return !isVisible;
      }

      // Look for logged-in indicators
      const userMenu = await page.$('#my-wikitree, .my-wikitree, a[href*="/wiki/"][href*="User:"]').catch(() => null);
      return !!userMenu;
    }

    // Navigate to WikiTree to check
    await page.goto('https://www.wikitree.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const loginLink = await page.$('a[href*="Special:Userlogin"]').catch(() => null);
    return !loginLink;
  },

  async getLoggedInUser(page: Page): Promise<{ name?: string; userId?: string } | null> {
    const isLoggedIn = await this.checkLoginStatus(page);
    if (!isLoggedIn) return null;

    // WikiTree shows username in the header
    const name = await page.$eval(
      '#my-wikitree a, .my-wikitree a',
      el => el.textContent?.trim()
    ).catch(() => undefined);

    // Extract WikiTree ID from link
    const userId = await page.$eval(
      '#my-wikitree a, .my-wikitree a',
      el => {
        const href = el.getAttribute('href') || '';
        const match = href.match(/\/wiki\/([^/]+)/);
        return match?.[1];
      }
    ).catch(() => undefined);

    return { name, userId };
  },

  async listTrees(_page: Page): Promise<ProviderTreeInfo[]> {
    // WikiTree is a single shared tree (like FamilySearch)
    return [{
      provider: 'wikitree',
      treeId: 'shared',
      treeName: 'WikiTree Shared Tree',
      personCount: undefined,
      rootPersonId: undefined
    }];
  },

  async scrapePersonById(page: Page, externalId: string): Promise<ScrapedPersonData> {
    // WikiTree IDs are like "Smith-12345" or "Smith-12345"
    const url = `https://www.wikitree.com/wiki/${externalId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // WikiTree profiles are public, but some content may be privacy-limited
    return extractWikiTreePerson(page, externalId);
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

  async extractParentIds(page: Page, externalId: string): Promise<{
    fatherId?: string;
    motherId?: string;
    fatherName?: string;
    motherName?: string;
  }> {
    const url = `https://www.wikitree.com/wiki/${externalId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const parents = await extractWikiTreeParents(page);
    const names = await extractWikiTreeParentNames(page);

    return {
      fatherId: parents.fatherId,
      motherId: parents.motherId,
      fatherName: names.fatherName,
      motherName: names.motherName,
    };
  },

  getPersonUrl(externalId: string): string {
    return `https://www.wikitree.com/wiki/${externalId}`;
  },

  getPersonEditUrl(externalId: string): string {
    return `https://www.wikitree.com/index.php?title=Special:EditPerson&u=${externalId}`;
  },

  async performLogin(page: Page, username: string, password: string): Promise<boolean> {
    return performLoginWithSelectors(page, this.loginUrl, LOGIN_SELECTORS, (p) => this.checkLoginStatus(p), username, password);
  }
};

/**
 * Extract person data from WikiTree profile page
 */
async function extractWikiTreePerson(page: Page, personId: string): Promise<ScrapedPersonData> {
  const data: ScrapedPersonData = {
    externalId: personId,
    provider: 'wikitree',
    name: '',
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString()
  };

  // Check for privacy message
  const isPrivate = await page.$('.PRIVACY, .private-profile').catch(() => null);
  if (isPrivate) {
    data.name = 'Private Profile';
    return data;
  }

  // Extract name - WikiTree uses specific formatting
  // The person's name is typically in h1 with class "person"
  const fullName = await page.$eval(
    'h1.person, .VITALS h1, #content h1',
    el => el.textContent?.trim() || ''
  ).catch(() => '');

  // WikiTree shows name with dates, extract just the name
  const nameMatch = fullName.match(/^([^(]+)/);
  data.name = nameMatch?.[1]?.trim() || fullName;

  // Extract photo
  const photoSrc = await page.$eval(
    '.photo-portrait img, .photo img, .VITALS img',
    el => el.getAttribute('src')
  ).catch(() => null);

  if (photoSrc && !photoSrc.includes('default') && !photoSrc.includes('silhouette')) {
    // WikiTree may use relative URLs
    data.photoUrl = photoSrc.startsWith('http') ? photoSrc : `https://www.wikitree.com${photoSrc}`;
  }

  // Extract vital dates from the VITALS section
  const vitalsText = await page.$eval(
    '.VITALS, #content .person-data',
    el => el.textContent || ''
  ).catch(() => '');

  // Parse birth info
  const birthMatch = vitalsText.match(/Born\s+([^.]+?)(?:\s+in\s+([^.]+))?(?:\.|$)/i);
  if (birthMatch) {
    data.birth = {
      date: birthMatch[1]?.trim(),
      place: birthMatch[2]?.trim()
    };
  }

  // Parse death info
  const deathMatch = vitalsText.match(/Died\s+([^.]+?)(?:\s+in\s+([^.]+))?(?:\.|$)/i);
  if (deathMatch) {
    data.death = {
      date: deathMatch[1]?.trim(),
      place: deathMatch[2]?.trim()
    };
  }

  // Alternative: Extract from structured data
  const birthDateStructured = await page.$eval(
    '[itemprop="birthDate"], .birth-date',
    el => el.textContent?.trim()
  ).catch(() => undefined);

  const birthPlaceStructured = await page.$eval(
    '[itemprop="birthPlace"], .birth-place',
    el => el.textContent?.trim()
  ).catch(() => undefined);

  const deathDateStructured = await page.$eval(
    '[itemprop="deathDate"], .death-date',
    el => el.textContent?.trim()
  ).catch(() => undefined);

  const deathPlaceStructured = await page.$eval(
    '[itemprop="deathPlace"], .death-place',
    el => el.textContent?.trim()
  ).catch(() => undefined);

  if (birthDateStructured || birthPlaceStructured) {
    data.birth = { date: birthDateStructured, place: birthPlaceStructured };
  }
  if (deathDateStructured || deathPlaceStructured) {
    data.death = { date: deathDateStructured, place: deathPlaceStructured };
  }

  // Extract gender
  const genderText = await page.$eval(
    '[itemprop="gender"], .gender',
    el => el.textContent?.toLowerCase() || ''
  ).catch(() => '');

  if (genderText) {
    data.gender = genderText.includes('male') && !genderText.includes('female')
      ? 'male'
      : genderText.includes('female')
        ? 'female'
        : 'unknown';
  }

  // Extract parent IDs from Family section
  const parents = await extractWikiTreeParents(page);
  data.fatherExternalId = parents.fatherId;
  data.motherExternalId = parents.motherId;

  return data;
}

/**
 * Extract parent names from WikiTree profile page
 */
async function extractWikiTreeParentNames(page: Page): Promise<{ fatherName?: string; motherName?: string }> {
  const result: { fatherName?: string; motherName?: string } = {};

  // Try to get father name
  const fatherName = await page.$eval(
    'a[href*="/wiki/"][title*="Father"], .father a, [data-parent="father"] a',
    el => el.textContent?.trim()
  ).catch(() => null);
  if (fatherName) result.fatherName = fatherName;

  // Try to get mother name
  const motherName = await page.$eval(
    'a[href*="/wiki/"][title*="Mother"], .mother a, [data-parent="mother"] a',
    el => el.textContent?.trim()
  ).catch(() => null);
  if (motherName) result.motherName = motherName;

  // Fallback: look in PARENTS section
  if (!result.fatherName || !result.motherName) {
    const parentNames = await page.$$eval(
      '.PARENTS a[href*="/wiki/"], .parents a[href*="/wiki/"]',
      links => links.map(l => l.textContent?.trim() || '')
    ).catch(() => []);

    // Heuristic: first parent link is father, second is mother
    if (!result.fatherName && parentNames.length > 0) result.fatherName = parentNames[0];
    if (!result.motherName && parentNames.length > 1) result.motherName = parentNames[1];
  }

  return result;
}

/**
 * Extract parent WikiTree IDs
 */
async function extractWikiTreeParents(page: Page): Promise<{ fatherId?: string; motherId?: string }> {
  const result: { fatherId?: string; motherId?: string } = {};

  // WikiTree family section has father and mother links
  const fatherLink = await page.$eval(
    'a[href*="/wiki/"][title*="Father"], .father a, [data-parent="father"] a',
    el => el.getAttribute('href')
  ).catch(() => null);

  const motherLink = await page.$eval(
    'a[href*="/wiki/"][title*="Mother"], .mother a, [data-parent="mother"] a',
    el => el.getAttribute('href')
  ).catch(() => null);

  // Alternative: Look in the family section
  const parentLinks = await page.$$eval(
    '.PARENTS a[href*="/wiki/"], .parents a[href*="/wiki/"]',
    links => links.map(l => ({
      href: l.getAttribute('href'),
      text: l.textContent?.trim()
    }))
  ).catch(() => []);

  if (fatherLink) {
    const match = fatherLink.match(/\/wiki\/([A-Za-z]+-\d+)/);
    if (match) result.fatherId = match[1];
  }

  if (motherLink) {
    const match = motherLink.match(/\/wiki\/([A-Za-z]+-\d+)/);
    if (match) result.motherId = match[1];
  }

  // Try to infer from parent links if not found yet
  if (!result.fatherId || !result.motherId) {
    for (const link of parentLinks) {
      if (!link.href) continue;
      const match = link.href.match(/\/wiki\/([A-Za-z]+-\d+)/);
      if (!match) continue;

      const wikiTreeId = match[1];

      // WikiTree profile pages often indicate gender in the link context
      // This is a fallback heuristic
      if (!result.fatherId && link.text?.toLowerCase().includes('father')) {
        result.fatherId = wikiTreeId;
      } else if (!result.motherId && link.text?.toLowerCase().includes('mother')) {
        result.motherId = wikiTreeId;
      }
    }
  }

  return result;
}
