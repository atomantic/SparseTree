import { chromium, Browser, Page, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { browserSseManager } from '../utils/browserSseManager';
import { logger } from '../lib/logger.js';
import { DATA_DIR } from '../utils/paths.js';
import { isAllowedNavigationUrl } from '../utils/validation.js';

const BROWSER_CONFIG_FILE = path.join(DATA_DIR, 'browser-config.json');

export interface BrowserConfig {
  // Port of the browser SparseTree launches itself (the fallback browser).
  cdpPort: number;
  // CDP ports of externally-managed browsers to reuse instead of launching our
  // own (e.g. PortOS's shared Chrome on 5556). Probed in order.
  sharedCdpPorts: number[];
  // When true, an available shared browser is preferred over launching our own.
  preferSharedBrowser: boolean;
  autoConnect: boolean;
}

const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  cdpPort: 9920,
  sharedCdpPorts: [5556],
  preferSharedBrowser: true,
  autoConnect: true
};

function loadBrowserConfig(): BrowserConfig {
  if (fs.existsSync(BROWSER_CONFIG_FILE)) {
    // Merge over defaults so configs written before shared-browser support
    // pick up the new fields instead of leaving them undefined.
    const stored = JSON.parse(fs.readFileSync(BROWSER_CONFIG_FILE, 'utf-8'));
    return { ...DEFAULT_BROWSER_CONFIG, ...stored };
  }
  return { ...DEFAULT_BROWSER_CONFIG };
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

const cdpUrlForPort = (port: number): string => `http://localhost:${port}`;

/**
 * CDP ports to try, in priority order. Shared (externally-managed) browsers
 * come first when preferSharedBrowser is set, so we reuse e.g. PortOS's Chrome
 * before falling back to launching our own.
 */
function candidateCdpPorts(): number[] {
  const own = browserConfig.cdpPort;
  const shared = (browserConfig.sharedCdpPorts ?? []).filter(p => p !== own);
  const ordered = browserConfig.preferSharedBrowser ? [...shared, own] : [own, ...shared];
  return [...new Set(ordered)];
}

/** Returns true if a CDP browser is reachable on the given port. */
async function probeCdpPort(port: number): Promise<boolean> {
  const response = await fetch(`${cdpUrlForPort(port)}/json/version`).catch(() => null);
  return response?.ok ?? false;
}

export interface ActiveCdp {
  port: number;
  url: string;
  shared: boolean;
}

/** First reachable CDP endpoint among the candidate ports, or null if none. */
async function resolveActiveCdp(): Promise<ActiveCdp | null> {
  for (const port of candidateCdpPorts()) {
    if (await probeCdpPort(port)) {
      return { port, url: cdpUrlForPort(port), shared: port !== browserConfig.cdpPort };
    }
  }
  return null;
}

let connectedBrowser: Browser | null = null;
let workerPage: Page | null = null;
// The endpoint we are actually connected to (may be a shared browser, not our own).
let activeCdp: ActiveCdp | null = null;

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
  // Where the reachable/connected browser lives: a reused external browser
  // ('shared'), the one we launch ourselves ('own'), or none reachable.
  browserSource: 'shared' | 'own' | 'none';
}

async function checkBrowserProcessRunning(): Promise<boolean> {
  return (await resolveActiveCdp()) !== null;
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
    if (connectedBrowser?.isConnected()) {
      return connectedBrowser;
    }

    // Explicit URL wins; otherwise reuse a reachable shared browser if there is
    // one, falling back to our own endpoint so the error is meaningful when
    // nothing is running.
    let target: ActiveCdp;
    if (cdpUrl) {
      target = { url: cdpUrl, port: getCdpPort(), shared: cdpUrl !== getCdpUrlInternal() };
    } else {
      target = (await resolveActiveCdp()) ?? { url: getCdpUrlInternal(), port: getCdpPort(), shared: false };
    }

    connectedBrowser = await chromium.connectOverCDP(target.url);
    activeCdp = target;
    logger.ok('browser', `Connected to ${target.shared ? 'shared' : 'own'} CDP browser at ${target.url}`);
    await broadcastStatusUpdate();
    return connectedBrowser;
  },

  async disconnect(): Promise<void> {
    if (connectedBrowser) {
      // For a CDP connection, close() only detaches the client — it never kills
      // the remote Chrome — so a reused shared browser (e.g. PortOS's) keeps
      // running for whatever else is using it.
      await connectedBrowser.close();
      connectedBrowser = null;
      workerPage = null;
      activeCdp = null;
      await broadcastStatusUpdate();
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
        activeCdp = null;
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
    // Prefer the endpoint we're connected to; otherwise probe for a reachable
    // one so the UI shows where a browser *would* connect (shared or own).
    const endpoint = activeCdp ?? (await resolveActiveCdp());
    const cdpUrl = endpoint?.url ?? getCdpUrlInternal();
    const cdpPort = endpoint?.port ?? getCdpPort();
    const browserProcessRunning = endpoint !== null;
    const browserSource: BrowserStatus['browserSource'] =
      !browserProcessRunning ? 'none' : endpoint!.shared ? 'shared' : 'own';

    if (!connectedBrowser?.isConnected()) {
      return {
        connected: false,
        cdpUrl,
        cdpPort,
        pageCount: 0,
        pages: [],
        familySearchLoggedIn: false,
        browserProcessRunning,
        autoConnect: browserConfig.autoConnect,
        browserSource
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
      autoConnect: browserConfig.autoConnect,
      browserSource
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
    // SSRF guard: only the request-supplied URL is allowlisted here. We
    // deliberately do NOT intercept subsequent redirect hops — an allowlisted
    // genealogy site legitimately redirects off-domain during auth (e.g.
    // FamilySearch -> Google SSO at accounts.google.com), and chasing redirects
    // either breaks that flow or hides the final URL from page.url()-based login
    // detection. The residual open-redirect-SSRF surface is acceptable for a
    // single-user, private-network (Tailscale) deployment.
    if (!isAllowedNavigationUrl(url)) {
      throw new Error(`Navigation blocked: "${url}" is not an allowed genealogy domain`);
    }

    let page = await this.findFamilySearchPage();

    if (!page) {
      page = await this.createPage(url);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    // Navigation may change FamilySearch login status
    if (url.includes('familysearch.org')) {
      await broadcastStatusUpdate();
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
    // If any browser is already reachable (a shared one like PortOS, or our own
    // from a previous launch), reuse it instead of starting a second Chrome.
    const existing = await resolveActiveCdp();
    if (existing) {
      await this.connect().catch(() => undefined);
      return {
        success: true,
        message: existing.shared
          ? `Reusing shared browser on CDP port ${existing.port}`
          : 'Browser already running'
      };
    }

    const scriptPath = path.resolve(import.meta.dirname, '../../../.browser/start.sh');

    if (!fs.existsSync(scriptPath)) {
      return { success: false, message: 'Browser start script not found at .browser/start.sh' };
    }

    // Spawn our own browser process detached
    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CDP_PORT: String(getCdpPort()) }
    });
    child.unref();

    // Wait a moment for browser to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    const nowRunning = await checkBrowserProcessRunning();
    await broadcastStatusUpdate();
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
