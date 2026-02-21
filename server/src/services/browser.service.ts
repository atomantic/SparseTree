import { chromium, Browser, Page, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { browserSseManager } from '../utils/browserSseManager';
import { logger } from '../lib/logger.js';
import { DATA_DIR } from '../utils/paths.js';

const BROWSER_CONFIG_FILE = path.join(DATA_DIR, 'browser-config.json');

export interface BrowserConfig {
  cdpPort: number;
  autoConnect: boolean;
}

function loadBrowserConfig(): BrowserConfig {
  if (fs.existsSync(BROWSER_CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(BROWSER_CONFIG_FILE, 'utf-8'));
  }
  return { cdpPort: 9920, autoConnect: true };
}

function saveBrowserConfig(config: BrowserConfig): void {
  fs.writeFileSync(BROWSER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

let browserConfig = loadBrowserConfig();

function getCdpPort(): number {
  return browserConfig.cdpPort;
}

function getCdpUrlInternal(): string {
  return `http://localhost:${getCdpPort()}`;
}

let connectedBrowser: Browser | null = null;
let workerPage: Page | null = null;

/**
 * Check if a URL is a FamilySearch login/auth page.
 * Covers: /signin, /auth/, ident.familysearch.org/identity/login
 */
export function isFamilySearchAuthUrl(url: string): boolean {
  return url.includes('/signin') || url.includes('/auth/') || url.includes('ident.familysearch.org');
}

export interface BrowserStatus {
  connected: boolean;
  cdpUrl: string;
  cdpPort: number;
  pageCount: number;
  pages: Array<{ url: string; title: string }>;
  familySearchLoggedIn: boolean;
  browserProcessRunning: boolean;
  autoConnect: boolean;
}

async function checkBrowserProcessRunning(): Promise<boolean> {
  const cdpUrl = getCdpUrlInternal();
  const response = await fetch(`${cdpUrl}/json/version`).catch(() => null);
  return response?.ok ?? false;
}

// Broadcast status to all SSE clients
async function broadcastStatusUpdate(): Promise<void> {
  if (!browserSseManager.hasClients()) return;
  const status = await browserService.getStatus().catch(() => null);
  if (status) {
    browserSseManager.broadcastStatus(status);
  }
}

export const browserService = {
  async connect(cdpUrl?: string): Promise<Browser> {
    const url = cdpUrl || getCdpUrlInternal();
    if (connectedBrowser?.isConnected()) {
      return connectedBrowser;
    }

    connectedBrowser = await chromium.connectOverCDP(url);
    broadcastStatusUpdate();
    return connectedBrowser;
  },

  async disconnect(): Promise<void> {
    if (connectedBrowser) {
      await connectedBrowser.close();
      connectedBrowser = null;
      workerPage = null;
      broadcastStatusUpdate();
    }
  },

  isConnected(): boolean {
    return connectedBrowser?.isConnected() ?? false;
  },

  /**
   * Verify the browser connection is truly active and reconnect if stale.
   * This checks both the Playwright object state AND the actual browser process.
   * Returns true if connected (or successfully reconnected), false otherwise.
   */
  async verifyAndReconnect(): Promise<boolean> {
    const processRunning = await checkBrowserProcessRunning();

    if (!processRunning) {
      // Browser process not running - clear stale connection
      if (connectedBrowser) {
        connectedBrowser = null;
        workerPage = null;
      }
      return false;
    }

    // Process is running, check if our connection is valid
    if (connectedBrowser?.isConnected()) {
      return true;
    }

    // Process running but we're not connected - reconnect
    logger.browser('browser', 'Stale connection detected, reconnecting...');
    connectedBrowser = null;
    workerPage = null;

    const connected = await this.connect().catch(err => {
      logger.warn('browser', `Reconnect failed: ${err.message}`);
      return null;
    });

    return connected?.isConnected() ?? false;
  },

  async getStatus(): Promise<BrowserStatus> {
    const cdpUrl = getCdpUrlInternal();
    const cdpPort = getCdpPort();
    const browserProcessRunning = await checkBrowserProcessRunning();

    if (!connectedBrowser?.isConnected()) {
      return {
        connected: false,
        cdpUrl,
        cdpPort,
        pageCount: 0,
        pages: [],
        familySearchLoggedIn: false,
        browserProcessRunning,
        autoConnect: browserConfig.autoConnect
      };
    }

    const contexts = connectedBrowser.contexts();
    const allPages: Page[] = [];
    for (const ctx of contexts) {
      allPages.push(...ctx.pages());
    }

    const pages = await Promise.all(
      allPages.map(async (page) => ({
        url: page.url(),
        title: await page.title().catch(() => '')
      }))
    );

    // Check if any FamilySearch page is logged in
    const familySearchLoggedIn = pages.some(
      p => p.url.includes('familysearch.org') && !isFamilySearchAuthUrl(p.url)
    );

    return {
      connected: true,
      cdpUrl,
      cdpPort,
      pageCount: pages.length,
      pages,
      familySearchLoggedIn,
      browserProcessRunning,
      autoConnect: browserConfig.autoConnect
    };
  },

  async getOrCreateContext(): Promise<BrowserContext> {
    if (!connectedBrowser?.isConnected()) {
      throw new Error('Browser not connected');
    }

    const contexts = connectedBrowser.contexts();
    if (contexts.length > 0) {
      return contexts[0];
    }

    return connectedBrowser.newContext();
  },

  async findFamilySearchPage(): Promise<Page | null> {
    if (!connectedBrowser?.isConnected()) {
      return null;
    }

    const contexts = connectedBrowser.contexts();
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        const url = page.url();
        if (url.includes('familysearch.org') && !isFamilySearchAuthUrl(url)) {
          return page;
        }
      }
    }

    return null;
  },

  async createPage(url?: string): Promise<Page> {
    const context = await this.getOrCreateContext();
    const page = await context.newPage();

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    return page;
  },

  /**
   * Get or create a persistent worker page for automation operations.
   * Reuses the same tab across calls instead of creating/closing tabs.
   * If a URL is provided, navigates the worker page to it.
   */
  async getWorkerPage(url?: string): Promise<Page> {
    if (workerPage && !workerPage.isClosed()) {
      if (url) {
        await workerPage.goto(url, { waitUntil: 'domcontentloaded' });
      }
      return workerPage;
    }

    const context = await this.getOrCreateContext();
    workerPage = await context.newPage();

    if (url) {
      await workerPage.goto(url, { waitUntil: 'domcontentloaded' });
    }

    return workerPage;
  },

  async navigateTo(url: string): Promise<Page> {
    let page = await this.findFamilySearchPage();

    if (!page) {
      page = await this.createPage(url);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    // Navigation may change FamilySearch login status
    if (url.includes('familysearch.org')) {
      broadcastStatusUpdate();
    }

    return page;
  },

  getCdpUrl(): string {
    return getCdpUrlInternal();
  },

  getCdpPort(): number {
    return getCdpPort();
  },

  getConfig(): BrowserConfig {
    return { ...browserConfig };
  },

  updateConfig(updates: Partial<BrowserConfig>): BrowserConfig {
    browserConfig = { ...browserConfig, ...updates };
    saveBrowserConfig(browserConfig);
    return browserConfig;
  },

  async launchBrowser(): Promise<{ success: boolean; message: string }> {
    const scriptPath = path.resolve(import.meta.dirname, '../../../.browser/start.sh');

    if (!fs.existsSync(scriptPath)) {
      return { success: false, message: 'Browser start script not found at .browser/start.sh' };
    }

    const isRunning = await checkBrowserProcessRunning();
    if (isRunning) {
      return { success: false, message: 'Browser already running' };
    }

    // Spawn browser process detached
    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CDP_PORT: String(getCdpPort()) }
    });
    child.unref();

    // Wait a moment for browser to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    const nowRunning = await checkBrowserProcessRunning();
    broadcastStatusUpdate();
    return {
      success: nowRunning,
      message: nowRunning ? 'Browser launched successfully' : 'Browser may still be starting...'
    };
  },

  async checkBrowserRunning(): Promise<boolean> {
    return checkBrowserProcessRunning();
  },

  async autoConnectIfEnabled(): Promise<void> {
    if (!browserConfig.autoConnect) {
      logger.skip('browser', 'Auto-connect disabled in config');
      return;
    }

    if (connectedBrowser?.isConnected()) {
      logger.skip('browser', 'Already connected');
      return;
    }

    // Wait briefly for browser process to be ready (handles concurrent startup)
    const maxAttempts = 5;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isRunning = await checkBrowserProcessRunning();

      if (isRunning) {
        logger.browser('browser', 'Auto-connecting to CDP...');
        await this.connect().catch(err => {
          logger.warn('browser', `Auto-connect attempt ${attempt} failed: ${err.message}`);
        });

        if (connectedBrowser?.isConnected()) {
          logger.ok('browser', 'Auto-connect successful');
          return;
        }
      }

      if (attempt < maxAttempts) {
        logger.browser('browser', `Browser not ready, retrying (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    logger.warn('browser', 'Auto-connect: browser process not available after retries');
  },

  async getFamilySearchToken(): Promise<{ token: string | null; cookies: Array<{ name: string; value: string }> }> {
    if (!connectedBrowser?.isConnected()) {
      return { token: null, cookies: [] };
    }

    const contexts = connectedBrowser.contexts();
    const allCookies: Array<{ name: string; value: string; domain: string }> = [];

    for (const ctx of contexts) {
      const cookies = await ctx.cookies(['https://www.familysearch.org', 'https://ident.familysearch.org']);
      allCookies.push(...cookies);
    }

    // FamilySearch authentication tokens:
    // - 'fssessionid': Primary session cookie used by FamilySearch for API authentication
    // - 'FS_AUTH_TOKEN': Legacy auth token format (fallback)
    // - 'Authorization': Bearer token if stored in cookies (rare)
    // Priority: fssessionid > FS_AUTH_TOKEN > Authorization
    // We return the first match found to ensure consistent auth.
    const authCookieNames = ['fssessionid', 'FS_AUTH_TOKEN', 'Authorization'];

    let token: string | null = null;

    for (const cookieName of authCookieNames) {
      const cookie = allCookies.find(c => c.name === cookieName);
      if (cookie) {
        token = cookie.value;
        logger.auth('browser', `Found FamilySearch auth token in cookie: ${cookieName}`);
        break;
      }
    }

    if (!token) {
      logger.warn('browser', `No FamilySearch auth token found. Checked cookies: ${authCookieNames.join(', ')}`);
    }

    // Filter to only return relevant auth cookies
    const relevantCookies = allCookies
      .filter(c => c.domain.includes('familysearch'))
      .map(c => ({ name: c.name, value: c.value }));

    return { token, cookies: relevantCookies };
  }
};
