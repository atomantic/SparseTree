import fs from 'fs';
import path from 'path';
import type {
  BuiltInProvider,
  ProviderRegistry,
  UserProviderConfig,
  ProviderSessionStatus,
  ProviderTreeInfo,
  EnsureAuthResult
} from '@fsf/shared';
import { browserService, isFamilySearchAuthUrl } from './browser.service.js';
import { credentialsService } from './credentials.service.js';
import { getScraper, getProviderInfo, listProviders, PROVIDER_DEFAULTS } from './scrapers/index.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'provider-config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Create default configuration for all providers
 */
function createDefaultRegistry(): ProviderRegistry {
  const providers: Record<BuiltInProvider, UserProviderConfig> = {} as Record<BuiltInProvider, UserProviderConfig>;

  for (const provider of listProviders()) {
    const defaults = PROVIDER_DEFAULTS[provider];
    providers[provider] = {
      provider,
      enabled: provider === 'familysearch', // Enable FamilySearch by default
      defaultTreeId: undefined,
      rateLimit: defaults.rateLimitDefaults,
      browserScrapeEnabled: provider === 'familysearch', // Enable browser scrape for FamilySearch by default
      browserLoggedIn: false
    };
  }

  return {
    providers,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Load provider registry from disk
 */
function loadRegistry(): ProviderRegistry {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultRegistry = createDefaultRegistry();
    saveRegistry(defaultRegistry);
    return defaultRegistry;
  }

  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as ProviderRegistry;

  // Ensure all providers exist (migration for new providers)
  let needsSave = false;
  for (const provider of listProviders()) {
    if (!data.providers[provider]) {
      const defaults = PROVIDER_DEFAULTS[provider];
      data.providers[provider] = {
        provider,
        enabled: false,
        defaultTreeId: undefined,
        rateLimit: defaults.rateLimitDefaults,
        browserScrapeEnabled: false,
        browserLoggedIn: false
      };
      needsSave = true;
    } else {
      // Migrate existing configs to have browser scrape fields
      const config = data.providers[provider];
      if (config.browserScrapeEnabled === undefined) {
        config.browserScrapeEnabled = config.enabled; // Match existing enabled state
        config.browserLoggedIn = false;
        needsSave = true;
      }
    }
  }

  if (needsSave) {
    saveRegistry(data);
  }

  return data;
}

/**
 * Save provider registry to disk
 */
function saveRegistry(registry: ProviderRegistry): void {
  registry.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Provider service for managing built-in provider configurations and sessions
 */
export const providerService = {
  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return CONFIG_FILE;
  },

  /**
   * Get all provider configurations
   */
  getAllConfigs(): ProviderRegistry {
    return loadRegistry();
  },

  /**
   * Get configuration for a specific provider
   */
  getConfig(provider: BuiltInProvider): UserProviderConfig {
    const registry = loadRegistry();
    return registry.providers[provider];
  },

  /**
   * Save/update configuration for a provider
   */
  saveConfig(config: UserProviderConfig): UserProviderConfig {
    const registry = loadRegistry();
    registry.providers[config.provider] = config;
    saveRegistry(registry);
    return config;
  },

  /**
   * Toggle provider enabled state
   */
  toggleProvider(provider: BuiltInProvider, enabled: boolean): UserProviderConfig {
    const config = this.getConfig(provider);
    config.enabled = enabled;
    return this.saveConfig(config);
  },

  /**
   * Toggle browser scrape enabled state
   */
  toggleBrowserScrape(provider: BuiltInProvider, enabled: boolean): UserProviderConfig {
    const config = this.getConfig(provider);
    config.browserScrapeEnabled = enabled;
    // If disabling, also clear the logged in flag
    if (!enabled) {
      config.browserLoggedIn = false;
      config.browserLastLogin = undefined;
    }
    return this.saveConfig(config);
  },

  /**
   * Confirm browser login status
   */
  confirmBrowserLogin(provider: BuiltInProvider, loggedIn: boolean): UserProviderConfig {
    const config = this.getConfig(provider);
    config.browserLoggedIn = loggedIn;
    config.browserLastLogin = loggedIn ? new Date().toISOString() : undefined;
    return this.saveConfig(config);
  },

  /**
   * Update rate limits for a provider
   */
  updateRateLimits(
    provider: BuiltInProvider,
    minDelayMs: number,
    maxDelayMs: number
  ): UserProviderConfig {
    const config = this.getConfig(provider);
    config.rateLimit = { minDelayMs, maxDelayMs };
    return this.saveConfig(config);
  },

  /**
   * Set default tree ID for a provider
   */
  setDefaultTree(provider: BuiltInProvider, treeId: string | undefined): UserProviderConfig {
    const config = this.getConfig(provider);
    config.defaultTreeId = treeId;
    return this.saveConfig(config);
  },

  /**
   * Check browser login status for a provider
   */
  async checkSession(provider: BuiltInProvider): Promise<ProviderSessionStatus> {
    const config = this.getConfig(provider);
    const scraper = getScraper(provider);

    const status: ProviderSessionStatus = {
      provider,
      enabled: config.enabled,
      loggedIn: false,
      lastChecked: new Date().toISOString()
    };

    // Ensure browser is connected
    if (!browserService.isConnected()) {
      await browserService.connect().catch(() => null);
    }

    if (!browserService.isConnected()) {
      return status;
    }

    const page = await browserService.getWorkerPage();

    status.loggedIn = await scraper.checkLoginStatus(page).catch(() => false);

    if (status.loggedIn) {
      const userInfo = await scraper.getLoggedInUser(page).catch(() => null);
      status.userName = userInfo?.name;
    }

    return status;
  },

  /**
   * Ensure the user is authenticated with a provider.
   * Checks browser connection, session status, and attempts auto-login if needed.
   */
  async ensureAuthenticated(provider: BuiltInProvider): Promise<EnsureAuthResult> {
    // 1. Check/connect browser
    if (!browserService.isConnected()) {
      await browserService.connect().catch(() => null);
    }
    if (!browserService.isConnected()) {
      return { authenticated: false, error: 'Browser not connected. Connect the browser via Settings > Browser.' };
    }

    // 2. Check current session using worker page
    const page = await browserService.getWorkerPage();
    const scraper = getScraper(provider);
    const loggedIn = await scraper.checkLoginStatus(page).catch(() => false);

    if (loggedIn) {
      return { authenticated: true, alreadyLoggedIn: true };
    }

    // 3. Determine login method
    const loginMethod = credentialsService.getAutoLoginMethod(provider) || 'credentials';

    // 4. Google SSO - click "Sign in with Google" on login page, then wait for OAuth
    if (loginMethod === 'google') {
      logger.start('auth', `Attempting Google SSO auto-login for ${provider}`);

      // Worker page should already be on ident.familysearch.org from checkLoginStatus.
      // If not, navigate to the login page.
      if (!isFamilySearchAuthUrl(page.url())) {
        await page.goto('https://www.familysearch.org/tree/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      }

      // Wait for login page DOM to render
      await page.waitForTimeout(2000);

      // Click the "Sign in with Google" button
      const clicked = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, a, [role="button"], [role="link"]');
        for (const el of elements) {
          const text = el.textContent?.toLowerCase() || '';
          if (text.includes('google')) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (!clicked) {
        logger.warn('auth', `Could not find Google login button on ${page.url()}`);
        return { authenticated: false, method: 'google', error: 'Could not find Google login button. Complete login manually in the browser via Settings > Providers.' };
      }

      logger.data('auth', 'Clicked Google login button, waiting for OAuth redirects...');

      // Wait for Google OAuth redirects to settle (Google consent → FamilySearch callback → /tree)
      const deadline = Date.now() + 25000;
      let ssoSuccess = false;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        const currentUrl = page.url();
        // Landed on FamilySearch (not auth) → success
        if (currentUrl.includes('familysearch.org') && !isFamilySearchAuthUrl(currentUrl)) {
          ssoSuccess = true;
          break;
        }
        // Still on Google or ident pages → keep waiting
      }

      if (ssoSuccess) {
        this.confirmBrowserLogin(provider, true);
        logger.done('auth', `Google SSO auto-login to ${provider} succeeded`);
        return { authenticated: true, method: 'google' };
      }

      logger.warn('auth', `Google SSO auto-login to ${provider} did not complete - manual login may be required`);
      return { authenticated: false, method: 'google', error: 'Google SSO login did not complete. Complete login in the browser, or switch to credentials in Settings > Providers.' };
    }

    // 5. Check for stored credentials
    const credentials = credentialsService.getCredentials(provider);
    if (!credentials?.password) {
      return { authenticated: false, method: 'credentials', error: 'No credentials stored. Log in via Settings > Providers.' };
    }

    // 6. Attempt auto-login with credentials
    logger.start('auth', `Auto-login to ${provider} with stored credentials`);
    const loginPage = await browserService.createPage();
    const username = credentials.email || credentials.username || '';
    const success = await scraper.performLogin(loginPage, username, credentials.password).catch(() => false);
    // Don't close the page - user may need to complete 2FA

    if (success) {
      this.confirmBrowserLogin(provider, true);
      logger.done('auth', `Auto-login to ${provider} succeeded`);
      return { authenticated: true, method: 'credentials' };
    }

    logger.error('auth', `Auto-login to ${provider} failed`);
    return { authenticated: false, method: 'credentials', error: 'Login failed. Check credentials or complete verification in the browser.' };
  },

  /**
   * Check session status for all enabled providers
   */
  async checkAllSessions(): Promise<Record<BuiltInProvider, ProviderSessionStatus>> {
    const registry = loadRegistry();
    const results: Record<BuiltInProvider, ProviderSessionStatus> = {} as Record<BuiltInProvider, ProviderSessionStatus>;

    for (const provider of listProviders()) {
      if (registry.providers[provider].enabled) {
        results[provider] = await this.checkSession(provider);
      } else {
        results[provider] = {
          provider,
          enabled: false,
          loggedIn: false,
          lastChecked: new Date().toISOString()
        };
      }
    }

    return results;
  },

  /**
   * Discover available trees for a provider
   */
  async discoverTrees(provider: BuiltInProvider): Promise<ProviderTreeInfo[]> {
    const scraper = getScraper(provider);

    if (!browserService.isConnected()) {
      await browserService.connect();
    }

    const page = await browserService.getWorkerPage();
    const trees = await scraper.listTrees(page).catch(() => []);

    return trees;
  },

  /**
   * Open login page for a provider in the browser
   */
  async openLoginPage(provider: BuiltInProvider): Promise<{ url: string }> {
    const info = getProviderInfo(provider);

    if (!browserService.isConnected()) {
      await browserService.connect();
    }

    await browserService.createPage(info.loginUrl);

    return { url: info.loginUrl };
  },

  /**
   * Open login page with Google SSO flow (FamilySearch only)
   * This opens the FamilySearch page that redirects to Google SSO
   */
  async openGoogleLoginPage(provider: BuiltInProvider): Promise<{ url: string }> {
    if (provider !== 'familysearch') {
      throw new Error('Google SSO is only available for FamilySearch');
    }

    // FamilySearch Google SSO URL - opens FamilySearch auth which redirects to Google
    const googleSsoUrl = 'https://www.familysearch.org/auth/familysearch/login?returnUrl=/tree';

    if (!browserService.isConnected()) {
      await browserService.connect();
    }

    await browserService.createPage(googleSsoUrl);

    return { url: googleSsoUrl };
  },

  /**
   * Get scraper for a provider
   */
  getScraper(provider: BuiltInProvider) {
    return getScraper(provider);
  },

  /**
   * Get provider info/metadata
   */
  getProviderInfo(provider: BuiltInProvider) {
    return getProviderInfo(provider);
  },

  /**
   * List all provider info
   */
  listProviderInfo() {
    return listProviders().map(p => ({
      ...getProviderInfo(p),
      config: this.getConfig(p)
    }));
  }
};
