/**
 * Scraper test setup
 * Sets up mock provider servers and Playwright browser for testing
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { createMockFamilySearchServer } from '../__mocks__/providers/familysearch/server';

export interface ScraperTestContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  mockServers: {
    familysearch: ReturnType<typeof createMockFamilySearchServer>;
  };
  baseUrls: {
    familysearch: string;
  };
  cleanup: () => Promise<void>;
}

const MOCK_PORTS = {
  familysearch: 3333,
  ancestry: 3334,
  wikitree: 3335,
  '23andme': 3336
};

/**
 * Create scraper test context with browser and mock servers
 */
export async function createScraperTestContext(): Promise<ScraperTestContext> {
  // Start mock servers
  const familysearchServer = createMockFamilySearchServer(MOCK_PORTS.familysearch);
  await familysearchServer.start();

  // Pre-login the mock server for testing
  familysearchServer.state.isLoggedIn = true;
  familysearchServer.state.currentUser = 'testuser';

  // Launch browser
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    mockServers: {
      familysearch: familysearchServer
    },
    baseUrls: {
      familysearch: `http://localhost:${MOCK_PORTS.familysearch}`
    },
    cleanup: async () => {
      await page.close();
      await context.close();
      await browser.close();
      familysearchServer.stop();
    }
  };
}

/**
 * Navigate to mock FamilySearch person page
 */
export async function navigateToMockPerson(
  page: Page,
  baseUrl: string,
  personId: string
): Promise<void> {
  await page.goto(`${baseUrl}/tree/person/details/${personId}`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForTimeout(500);
}

/**
 * Navigate to mock FamilySearch login page
 */
export async function navigateToMockLogin(
  page: Page,
  baseUrl: string
): Promise<void> {
  await page.goto(`${baseUrl}/signin`, {
    waitUntil: 'domcontentloaded'
  });
}

export default {
  createScraperTestContext,
  navigateToMockPerson,
  navigateToMockLogin
};
