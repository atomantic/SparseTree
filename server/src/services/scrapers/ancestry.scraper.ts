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

  console.log(`[ancestry] Extracted name: "${data.name}"`);

  // Extract photo from userCard
  const photoSrc = await page.$eval(
    '.userCardImg img, #profileImage img, [data-testid="usercardimg-element"] img',
    el => el.getAttribute('src')
  ).catch(() => null);

  if (photoSrc && !photoSrc.includes('default') && !photoSrc.includes('silhouette') && !photoSrc.includes('placeholder')) {
    data.photoUrl = photoSrc;
    console.log(`[ancestry] Extracted photo: ${photoSrc.substring(0, 80)}...`);
  }

  // Extract birth/death from userCard
  // Structure: <span class="userCardEvent">Birth</span> <span class="userCardEventDetail">Unknown</span>
  // Note: We keep "Unknown" and "Living" as-is since they represent actual data states for comparison
  const vitalInfo = await page.evaluate(() => {
    const result: { birthDate?: string; deathDate?: string } = {};

    // Find all event paragraphs in the userCard
    const eventParagraphs = document.querySelectorAll('.userCardEvents p, .userCardContent p');
    for (const p of eventParagraphs) {
      const eventLabel = p.querySelector('.userCardEvent')?.textContent?.trim();
      const eventDetail = p.querySelector('.userCardEventDetail')?.textContent?.trim();

      if (eventLabel === 'Birth' && eventDetail) {
        // Store actual value including "Unknown" for comparison purposes
        // Convert "Unknown" to undefined for cleaner storage
        result.birthDate = eventDetail === 'Unknown' ? undefined : eventDetail;
      }
      if (eventLabel === 'Death' && eventDetail) {
        // Keep "Living" as it's a meaningful status
        result.deathDate = eventDetail === 'Unknown' ? undefined : eventDetail;
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
            result.birthDate = detail === 'Unknown' ? undefined : detail;
          }
        }
        if (text.includes('Death') && result.deathDate === undefined) {
          const detail = p.querySelector('span:last-child, .detail')?.textContent?.trim();
          if (detail && detail !== 'Death') {
            result.deathDate = detail === 'Unknown' ? undefined : detail;
          }
        }
      }
    }

    return result;
  }).catch(() => ({ birthDate: undefined, deathDate: undefined }));

  if (vitalInfo.birthDate) {
    data.birth = { date: vitalInfo.birthDate };
  }
  if (vitalInfo.deathDate) {
    data.death = { date: vitalInfo.deathDate };
  }

  console.log(`[ancestry] Extracted birth: ${vitalInfo.birthDate}, death: ${vitalInfo.deathDate}`);

  // Extract more details from the Timeline/Facts section
  const factDetails = await page.evaluate(() => {
    const result: { birthPlace?: string; deathPlace?: string } = {};

    // Look in the timeline list items for place information
    const listItems = document.querySelectorAll('[role="tabpanel"] li, main li');
    for (const li of listItems) {
      const text = li.textContent || '';
      // Birth place often appears as "Born in [place]" or has location info
      if (text.toLowerCase().includes('birth') || text.toLowerCase().includes('born')) {
        const placeMatch = text.match(/(?:in|at)\s+([^,]+(?:,\s*[^,]+)*)/i);
        if (placeMatch) {
          result.birthPlace = placeMatch[1].trim();
        }
      }
      if (text.toLowerCase().includes('death') || text.toLowerCase().includes('died')) {
        const placeMatch = text.match(/(?:in|at)\s+([^,]+(?:,\s*[^,]+)*)/i);
        if (placeMatch) {
          result.deathPlace = placeMatch[1].trim();
        }
      }
    }
    return result;
  }).catch(() => ({ birthPlace: undefined, deathPlace: undefined }));

  if (factDetails.birthPlace && data.birth) {
    data.birth.place = factDetails.birthPlace;
  } else if (factDetails.birthPlace) {
    data.birth = { place: factDetails.birthPlace };
  }

  if (factDetails.deathPlace && data.death) {
    data.death.place = factDetails.deathPlace;
  } else if (factDetails.deathPlace) {
    data.death = { place: factDetails.deathPlace };
  }

  // Extract parent IDs from Relationships section
  const parents = await extractAncestryParents(page);
  data.fatherExternalId = parents.fatherId;
  data.motherExternalId = parents.motherId;

  console.log(`[ancestry] Extracted parents: father=${parents.fatherId}, mother=${parents.motherId}`);

  return data;
}


/**
 * Extract parent IDs from Ancestry Relationships section
 * Updated for 2024/2025 Ancestry DOM structure
 */
async function extractAncestryParents(page: Page): Promise<{ fatherId?: string; motherId?: string }> {
  const result = await page.evaluate(() => {
    const parents: { fatherId?: string; motherId?: string } = {};

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
      // Fallback: look for links in the relationships area
      const relLinks = document.querySelectorAll('a[href*="/person/"][href*="/facts"]');
      const personLinks: { href: string; name: string }[] = [];

      for (const link of relLinks) {
        const href = link.getAttribute('href') || '';
        const name = link.textContent?.trim() || '';
        // Skip the current person and spouse
        if (href && name && !href.includes('/family-tree/person/tree/')) {
          personLinks.push({ href, name });
        }
      }

      // Try to identify parents from the first two person links in relationships
      // This is a fallback heuristic
      return parents;
    }

    // Get all person links in the parents section
    const parentLinks = parentsSection.querySelectorAll('a[href*="/person/"]');

    for (const link of parentLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/person\/(\d+)\/facts/);
      if (!match) continue;

      const personId = match[1];
      const name = link.textContent?.trim() || '';

      // Check for gender indicators in the link text or nearby elements
      // Males typically have years like "1960–" without photos showing female names
      // This is heuristic - Ancestry doesn't clearly mark gender in the family section

      // Look at the h4 inside the link for the name
      const h4 = link.querySelector('h4');
      const displayName = h4?.textContent?.trim() || name;

      // Simple heuristic: first parent is often father, second is mother
      // But we can also look for common female names or "Mrs" etc.
      if (!parents.fatherId) {
        parents.fatherId = personId;
      } else if (!parents.motherId) {
        parents.motherId = personId;
      }
    }

    return parents;
  }).catch(() => ({ fatherId: undefined, motherId: undefined }));

  return result;
}
