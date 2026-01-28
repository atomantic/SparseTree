import { Page } from 'playwright';
import type { ProviderTreeInfo, ScrapedPersonData } from '@fsf/shared';
import type { ProviderScraper, LoginSelectors } from './base.scraper.js';
import { PROVIDER_DEFAULTS, performLoginWithSelectors, scrapeAncestorsBFS } from './base.scraper.js';
import { logger } from '../../lib/logger.js';

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
    // Ancestry requires a tree ID in the URL
    const currentUrl = page.url();
    const treeMatch = currentUrl.match(/\/tree\/(\d+)/);

    if (!treeMatch) {
      logger.data('ancestry', `No tree ID in current URL, cannot extract parents for ${externalId}`);
      return {};
    }

    const treeId = treeMatch[1];
    const url = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${externalId}/facts`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    if (page.url().includes('/signin') || page.url().includes('/login')) {
      logger.data('ancestry', `Not authenticated for parent extraction`);
      return {};
    }

    return extractAncestryParents(page);
  },

  getPersonUrl(externalId: string): string {
    // Without tree ID, return a search URL
    return `https://www.ancestry.com/search/?name=${externalId}`;
  },

  getPersonEditUrl(externalId: string): string {
    return this.getPersonUrl(externalId);
  },

  async performLogin(page: Page, username: string, password: string): Promise<boolean> {
    return performLoginWithSelectors(page, this.loginUrl, LOGIN_SELECTORS, (p) => this.checkLoginStatus(p), username, password);
  }
};

/**
 * Extract person data from Ancestry person page
 * Updated for 2024/2025 Ancestry DOM structure
 */
async function extractAncestryPerson(page: Page, personId: string): Promise<ScrapedPersonData> {
  const data: ScrapedPersonData = {
    externalId: personId,
    provider: 'ancestry',
    name: '',
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString()
  };

  // Extract name from userCard title or h1
  data.name = await page.$eval(
    '.userCardTitle, h1.userCardTitle, [data-testid="usercardcontent-element"] h1',
    el => el.textContent?.trim() || ''
  ).catch(() => '');

  // Fallback: get any h1 on the page
  if (!data.name) {
    data.name = await page.$eval('h1', el => el.textContent?.trim() || '').catch(() => '');
  }

  logger.data('ancestry', `Extracted name: "${data.name}"`);

  // Extract photo from the PROFILE image only (not family members)
  // The profile photo is in #profileImage or within the .personCardContainer header
  // IMPORTANT: Do NOT match photos in .researchList (those are family members)
  const photoSrc = await page.evaluate(() => {
    // First try: Look for img directly inside #profileImage
    const profileImg = document.querySelector('#profileImage img');
    if (profileImg) {
      return profileImg.getAttribute('src');
    }

    // Second try: Look in personCardContainer header for the profile image
    const cardContainer = document.querySelector('.personCardContainer');
    if (cardContainer) {
      const img = cardContainer.querySelector('.userCardImg img');
      if (img) {
        return img.getAttribute('src');
      }
    }

    // Third try: Look in the page header (NOT in .researchList which contains family)
    const header = document.querySelector('header.pageHeader');
    if (header) {
      const img = header.querySelector('.userCardImg img');
      if (img) {
        return img.getAttribute('src');
      }
    }

    // No profile photo found (person may just have a placeholder icon)
    return null;
  }).catch(() => null);

  if (photoSrc && !photoSrc.includes('default') && !photoSrc.includes('silhouette') && !photoSrc.includes('placeholder')) {
    // Normalize to absolute URL
    let normalizedUrl = photoSrc;
    if (photoSrc.startsWith('//')) {
      normalizedUrl = 'https:' + photoSrc;
    } else if (photoSrc.startsWith('/')) {
      normalizedUrl = 'https://www.ancestry.com' + photoSrc;
    }
    data.photoUrl = normalizedUrl;
    logger.photo('ancestry', `Extracted profile photo: ${normalizedUrl.substring(0, 80)}...`);
  } else {
    logger.data('ancestry', `No profile photo found (person has placeholder icon)`);
  }

  // Extract birth/death from userCard
  // Structure: <span class="userCardEvent">Birth</span> <span class="userCardEventDetail">8 NOVEMBER 1878 • Howard County, Missouri, United States of America</span>
  // Note: Ancestry combines date and place with " • " separator
  const vitalInfo = await page.evaluate(() => {
    const result: { birthDate?: string; birthPlace?: string; deathDate?: string; deathPlace?: string } = {};

    // Helper to split "DATE • PLACE" format
    const splitDatePlace = (combined: string): { date?: string; place?: string } => {
      if (!combined || combined === 'Unknown') return {};
      if (combined === 'Living') return { date: 'Living' };

      // Split on bullet separator (various Unicode bullets)
      const parts = combined.split(/\s*[•·]\s*/);
      if (parts.length >= 2) {
        return {
          date: parts[0].trim() || undefined,
          place: parts.slice(1).join(', ').trim() || undefined
        };
      }
      // No separator - could be just a date or just a place
      // If it contains numbers and month names, likely a date
      const hasDatePatterns = /\d{1,4}|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec/i.test(combined);
      if (hasDatePatterns) {
        return { date: combined.trim() };
      }
      // Otherwise assume it's a place
      return { place: combined.trim() };
    };

    // Find all event paragraphs in the userCard
    const eventParagraphs = document.querySelectorAll('.userCardEvents p, .userCardContent p');
    for (const p of eventParagraphs) {
      const eventLabel = p.querySelector('.userCardEvent')?.textContent?.trim();
      const eventDetail = p.querySelector('.userCardEventDetail')?.textContent?.trim();

      if (eventLabel === 'Birth' && eventDetail) {
        const { date, place } = splitDatePlace(eventDetail);
        result.birthDate = date;
        result.birthPlace = place;
      }
      if (eventLabel === 'Death' && eventDetail) {
        const { date, place } = splitDatePlace(eventDetail);
        result.deathDate = date;
        result.deathPlace = place;
      }
    }

    // Fallback: try banner paragraphs with different structure
    if (result.birthDate === undefined && result.deathDate === undefined) {
      const paragraphs = document.querySelectorAll('header p, [role="banner"] p');
      for (const p of paragraphs) {
        const text = p.textContent || '';
        if (text.includes('Birth') && result.birthDate === undefined) {
          const detail = p.querySelector('span:last-child, .detail')?.textContent?.trim();
          if (detail && detail !== 'Birth') {
            const { date, place } = splitDatePlace(detail);
            result.birthDate = date;
            result.birthPlace = place;
          }
        }
        if (text.includes('Death') && result.deathDate === undefined) {
          const detail = p.querySelector('span:last-child, .detail')?.textContent?.trim();
          if (detail && detail !== 'Death') {
            const { date, place } = splitDatePlace(detail);
            result.deathDate = date;
            result.deathPlace = place;
          }
        }
      }
    }

    return result;
  }).catch(() => ({ birthDate: undefined, birthPlace: undefined, deathDate: undefined, deathPlace: undefined }));

  if (vitalInfo.birthDate || vitalInfo.birthPlace) {
    data.birth = { date: vitalInfo.birthDate, place: vitalInfo.birthPlace };
  }
  if (vitalInfo.deathDate || vitalInfo.deathPlace) {
    data.death = { date: vitalInfo.deathDate, place: vitalInfo.deathPlace };
  }

  logger.data('ancestry', `Extracted birth: ${vitalInfo.birthDate} @ ${vitalInfo.birthPlace}, death: ${vitalInfo.deathDate} @ ${vitalInfo.deathPlace}`);

  // Extract parent IDs and names from Relationships section
  const parents = await extractAncestryParents(page);
  data.fatherExternalId = parents.fatherId;
  data.motherExternalId = parents.motherId;
  data.fatherName = parents.fatherName;
  data.motherName = parents.motherName;

  logger.data('ancestry', `Extracted parents: father=${parents.fatherId}(${parents.fatherName}), mother=${parents.motherId}(${parents.motherName})`);

  return data;
}


/**
 * Extract parent IDs and names from Ancestry Relationships section
 * Updated for 2024/2025 Ancestry DOM structure
 */
async function extractAncestryParents(page: Page): Promise<{ fatherId?: string; motherId?: string; fatherName?: string; motherName?: string }> {
  const result = await page.evaluate(() => {
    const parents: { fatherId?: string; motherId?: string; fatherName?: string; motherName?: string } = {};

    // Find the "Parents" section heading and get the following list
    const headings = document.querySelectorAll('h3');
    let parentsSection: Element | null = null;

    for (const h of headings) {
      if (h.textContent?.includes('Parents')) {
        parentsSection = h.nextElementSibling;
        break;
      }
    }

    if (!parentsSection) {
      return parents;
    }

    // Get all person links in the parents section
    const parentLinks = parentsSection.querySelectorAll('a[href*="/person/"]');

    for (const link of parentLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/person\/(\d+)\/facts/);
      if (!match) continue;

      const personId = match[1];

      // Look at the h4 inside the link for the name
      const h4 = link.querySelector('h4');
      const displayName = h4?.textContent?.trim() || link.textContent?.trim() || '';

      // Simple heuristic: first parent is often father, second is mother
      if (!parents.fatherId) {
        parents.fatherId = personId;
        parents.fatherName = displayName;
      } else if (!parents.motherId) {
        parents.motherId = personId;
        parents.motherName = displayName;
      }
    }

    return parents;
  }).catch(() => ({ fatherId: undefined, motherId: undefined, fatherName: undefined, motherName: undefined }));

  return result;
}
