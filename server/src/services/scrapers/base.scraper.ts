import { Page } from 'playwright';
import type { BuiltInProvider, ProviderTreeInfo, ScrapedPersonData } from '@fsf/shared';

/**
 * Login form selectors for auto-login
 */
export interface LoginSelectors {
  /** Selector for email/username input */
  usernameInput: string;
  /** Selector for password input */
  passwordInput: string;
  /** Selector for submit button */
  submitButton: string;
  /** Selector that indicates successful login (visible when logged in) */
  successIndicator: string;
  /** Optional selector that indicates login error */
  errorIndicator?: string;
}

/**
 * Base interface for all provider scrapers.
 * Each provider scraper implements browser-based data extraction.
 */
export interface ProviderScraper {
  /** Provider identifier */
  readonly provider: BuiltInProvider;

  /** Human-readable provider name */
  readonly displayName: string;

  /** URL to provider login page */
  readonly loginUrl: string;

  /** URL pattern for tree pages (with placeholders) */
  readonly treeUrlPattern: string;

  /** Login form selectors for auto-login */
  readonly loginSelectors: LoginSelectors;

  /**
   * Check if user is logged in to this provider
   */
  checkLoginStatus(page: Page): Promise<boolean>;

  /**
   * Get logged-in user information
   */
  getLoggedInUser(page: Page): Promise<{ name?: string; userId?: string } | null>;

  /**
   * List available trees for the user (if provider supports multiple trees)
   */
  listTrees(page: Page): Promise<ProviderTreeInfo[]>;

  /**
   * Scrape a single person by their external ID
   */
  scrapePersonById(page: Page, externalId: string): Promise<ScrapedPersonData>;

  /**
   * Scrape ancestors starting from a root person
   * Returns an async generator for progress reporting
   */
  scrapeAncestors(
    page: Page,
    rootId: string,
    maxGenerations?: number
  ): AsyncGenerator<ScrapedPersonData, void, undefined>;

  /**
   * Extract parent external IDs and names from a person's provider page.
   * Used by parent discovery to link local parents to provider records.
   */
  extractParentIds?(page: Page, externalId: string): Promise<{
    fatherId?: string;
    motherId?: string;
    fatherName?: string;
    motherName?: string;
  }>;

  /**
   * Build URL to view a person on this provider
   */
  getPersonUrl(externalId: string): string;

  /**
   * Build URL to edit a person on this provider
   */
  getPersonEditUrl(externalId: string): string;

  /**
   * Perform login with credentials
   * Returns true if login succeeded, false otherwise
   */
  performLogin(page: Page, username: string, password: string): Promise<boolean>;
}

/**
 * Progress callback for scraping operations
 */
export interface ScrapeProgress {
  phase: 'connecting' | 'navigating' | 'scraping' | 'downloading' | 'complete' | 'error';
  message: string;
  personId?: string;
  data?: ScrapedPersonData;
  error?: string;
  generation?: number;
  progress?: {
    current: number;
    total?: number;
  };
}

export type ProgressCallback = (progress: ScrapeProgress) => void;

/**
 * Provider metadata for UI display
 */
export interface ProviderInfo {
  provider: BuiltInProvider;
  displayName: string;
  loginUrl: string;
  treeUrlPattern: string;
  logoUrl?: string;
  supportsMultipleTrees: boolean;
  rateLimitDefaults: {
    minDelayMs: number;
    maxDelayMs: number;
  };
}

/**
 * Default rate limits by provider
 */
/**
 * Check if a URL is a placeholder image
 */
export function isPlaceholderImage(src: string): boolean {
  return src.includes('default') || src.includes('silhouette') || src.includes('placeholder');
}

/**
 * Shared login implementation for all provider scrapers.
 * Each provider calls this with its own selectors and checkLoginStatus function.
 */
export async function performLoginWithSelectors(
  page: Page,
  loginUrl: string,
  selectors: LoginSelectors,
  checkLoginStatus: (page: Page) => Promise<boolean>,
  username: string,
  password: string
): Promise<boolean> {
  // Navigate to login page
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Check if already logged in
  const alreadyLoggedIn = await checkLoginStatus(page);
  if (alreadyLoggedIn) {
    return true;
  }

  // Fill in username
  const usernameInput = await page.$(selectors.usernameInput);
  if (!usernameInput) {
    return false;
  }
  await usernameInput.fill(username);

  // Fill in password
  const passwordInput = await page.$(selectors.passwordInput);
  if (!passwordInput) {
    return false;
  }
  await passwordInput.fill(password);

  // Click submit
  const submitButton = await page.$(selectors.submitButton);
  if (!submitButton) {
    return false;
  }
  await submitButton.click();

  // Poll for login completion instead of fixed 5s wait
  // Google OAuth and form login both redirect on success, so check frequently
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);

    // Check for error indicator (fail fast)
    if (selectors.errorIndicator) {
      const errorEl = await page.$(selectors.errorIndicator);
      if (errorEl) {
        const isVisible = await errorEl.isVisible().catch(() => false);
        if (isVisible) return false;
      }
    }

    // Check if login succeeded
    const loggedIn = await checkLoginStatus(page).catch(() => false);
    if (loggedIn) return true;
  }

  // Final check after timeout
  return checkLoginStatus(page);
}

/**
 * Shared BFS ancestor scraping for providers that navigate page-by-page.
 * FamilySearch, Ancestry, and WikiTree all use identical BFS loops.
 * 23andMe is different (bulk state extraction) and doesn't use this.
 */
export async function* scrapeAncestorsBFS(
  page: Page,
  rootId: string,
  scrapePersonById: (page: Page, id: string) => Promise<ScrapedPersonData>,
  options?: { maxGenerations?: number; minDelayMs?: number; maxDelayMs?: number }
): AsyncGenerator<ScrapedPersonData, void, undefined> {
  const maxGenerations = options?.maxGenerations ?? 10;
  const minDelay = options?.minDelayMs ?? 500;
  const maxDelay = options?.maxDelayMs ?? 1500;

  const visited = new Set<string>();
  const queue: Array<{ id: string; generation: number }> = [{ id: rootId, generation: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.id) || current.generation > maxGenerations) {
      continue;
    }

    visited.add(current.id);

    const personData = await scrapePersonById(page, current.id);
    yield personData;

    // Add parents to queue
    if (personData.fatherExternalId && !visited.has(personData.fatherExternalId)) {
      queue.push({ id: personData.fatherExternalId, generation: current.generation + 1 });
    }
    if (personData.motherExternalId && !visited.has(personData.motherExternalId)) {
      queue.push({ id: personData.motherExternalId, generation: current.generation + 1 });
    }

    // Random delay for rate limiting
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    await page.waitForTimeout(delay);
  }
}

export const PROVIDER_DEFAULTS: Record<BuiltInProvider, ProviderInfo> = {
  familysearch: {
    provider: 'familysearch',
    displayName: 'FamilySearch',
    loginUrl: 'https://www.familysearch.org/auth/familysearch/login',
    treeUrlPattern: 'https://www.familysearch.org/tree/pedigree/landscape/{id}',
    supportsMultipleTrees: false,
    rateLimitDefaults: { minDelayMs: 500, maxDelayMs: 1500 }
  },
  ancestry: {
    provider: 'ancestry',
    displayName: 'Ancestry',
    loginUrl: 'https://www.ancestry.com/account/signin',
    treeUrlPattern: 'https://www.ancestry.com/family-tree/tree/{treeId}/family',
    supportsMultipleTrees: true,
    rateLimitDefaults: { minDelayMs: 1000, maxDelayMs: 3000 }
  },
  '23andme': {
    provider: '23andme',
    displayName: '23andMe',
    loginUrl: 'https://you.23andme.com/',
    treeUrlPattern: 'https://you.23andme.com/family/tree/',
    supportsMultipleTrees: false,
    rateLimitDefaults: { minDelayMs: 1000, maxDelayMs: 3000 }
  },
  wikitree: {
    provider: 'wikitree',
    displayName: 'WikiTree',
    loginUrl: 'https://www.wikitree.com/wiki/Special:Userlogin',
    treeUrlPattern: 'https://www.wikitree.com/wiki/{id}',
    supportsMultipleTrees: false,
    rateLimitDefaults: { minDelayMs: 500, maxDelayMs: 1500 }
  }
};
