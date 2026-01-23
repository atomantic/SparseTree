import { Router, Request, Response } from 'express';
import type { BuiltInProvider, UserProviderConfig, ProviderCredentials } from '@fsf/shared';
import { providerService } from '../services/provider.service';
import { browserService } from '../services/browser.service';
import { credentialsService } from '../services/credentials.service';

const router = Router();

/**
 * List all providers with their configs and session status
 */
router.get('/', async (_req: Request, res: Response) => {
  const registry = providerService.getAllConfigs();
  const providerInfo = providerService.listProviderInfo();

  res.json({
    success: true,
    data: {
      providers: providerInfo,
      registry,
      browserConnected: browserService.isConnected()
    }
  });
});

/**
 * Get single provider config and info
 */
router.get('/:provider', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  const config = providerService.getConfig(provider);
  const info = providerService.getProviderInfo(provider);

  if (!config) {
    res.status(404).json({ success: false, error: `Provider ${provider} not found` });
    return;
  }

  res.json({
    success: true,
    data: { config, info }
  });
});

/**
 * Update provider configuration
 */
router.put('/:provider', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const updates = req.body as Partial<UserProviderConfig>;

  const existing = providerService.getConfig(provider);
  if (!existing) {
    res.status(404).json({ success: false, error: `Provider ${provider} not found` });
    return;
  }

  const updated: UserProviderConfig = {
    ...existing,
    ...updates,
    provider // Ensure provider can't be changed
  };

  const saved = providerService.saveConfig(updated);
  res.json({ success: true, data: saved });
});

/**
 * Toggle provider enabled/disabled
 */
router.post('/:provider/toggle', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { enabled } = req.body as { enabled: boolean };

  const updated = providerService.toggleProvider(provider, enabled);
  res.json({ success: true, data: updated });
});

/**
 * Toggle browser scrape enabled/disabled
 */
router.post('/:provider/toggle-browser-scrape', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { enabled } = req.body as { enabled: boolean };

  const updated = providerService.toggleBrowserScrape(provider, enabled);
  res.json({ success: true, data: updated });
});

/**
 * Confirm browser login status for a provider
 */
router.post('/:provider/confirm-browser-login', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { loggedIn } = req.body as { loggedIn: boolean };

  const updated = providerService.confirmBrowserLogin(provider, loggedIn);
  res.json({ success: true, data: updated });
});

/**
 * Check browser login session for provider
 */
router.post('/:provider/check-session', async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  const status = await providerService.checkSession(provider)
    .catch(err => ({
      provider,
      enabled: false,
      loggedIn: false,
      lastChecked: new Date().toISOString(),
      error: err.message
    }));

  res.json({ success: true, data: status });
});

/**
 * Check sessions for all enabled providers
 */
router.post('/check-all-sessions', async (_req: Request, res: Response) => {
  const statuses = await providerService.checkAllSessions();
  res.json({ success: true, data: statuses });
});

/**
 * Open login page in browser
 */
router.post('/:provider/login', async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  const result = await providerService.openLoginPage(provider)
    .catch(err => ({ error: err.message }));

  if ('error' in result) {
    res.status(500).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Open login page with Google SSO (FamilySearch only)
 */
router.post('/:provider/login-google', async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  if (provider !== 'familysearch') {
    res.status(400).json({ success: false, error: 'Google SSO is only available for FamilySearch' });
    return;
  }

  const result = await providerService.openGoogleLoginPage(provider)
    .catch(err => ({ error: err.message }));

  if ('error' in result) {
    res.status(500).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * List available trees for provider
 */
router.get('/:provider/trees', async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  const trees = await providerService.discoverTrees(provider)
    .catch(() => []);

  res.json({ success: true, data: trees });
});

/**
 * Set default tree for provider
 */
router.post('/:provider/default-tree', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { treeId } = req.body as { treeId?: string };

  const updated = providerService.setDefaultTree(provider, treeId);
  res.json({ success: true, data: updated });
});

/**
 * Update rate limits
 */
router.put('/:provider/rate-limit', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { minDelayMs, maxDelayMs } = req.body as { minDelayMs: number; maxDelayMs: number };

  if (!minDelayMs || !maxDelayMs || minDelayMs < 0 || maxDelayMs < minDelayMs) {
    res.status(400).json({ success: false, error: 'Invalid rate limit values' });
    return;
  }

  const updated = providerService.updateRateLimits(provider, minDelayMs, maxDelayMs);
  res.json({ success: true, data: updated });
});

/**
 * Scrape a single person (returns scraped data)
 */
router.post('/:provider/scrape/:personId', async (req: Request, res: Response) => {
  const { provider, personId } = req.params as { provider: BuiltInProvider; personId: string };

  const scraper = providerService.getScraper(provider);

  if (!browserService.isConnected()) {
    await browserService.connect().catch(() => null);
  }

  if (!browserService.isConnected()) {
    res.status(503).json({ success: false, error: 'Browser not connected' });
    return;
  }

  const page = await browserService.createPage();
  const data = await scraper.scrapePersonById(page, personId)
    .catch(err => ({ error: err.message }));

  await page.close().catch(() => {});

  if ('error' in data) {
    res.status(500).json({ success: false, error: data.error });
    return;
  }

  res.json({ success: true, data });
});

/**
 * SSE endpoint for scraping with progress
 */
router.get('/:provider/scrape/:personId', async (req: Request, res: Response) => {
  const { provider, personId } = req.params as { provider: BuiltInProvider; personId: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('started', { provider, personId });

  const scraper = providerService.getScraper(provider);

  if (!browserService.isConnected()) {
    await browserService.connect().catch(() => null);
  }

  if (!browserService.isConnected()) {
    sendEvent('error', { message: 'Browser not connected' });
    res.end();
    return;
  }

  const page = await browserService.createPage();

  sendEvent('progress', { phase: 'navigating', message: 'Loading page...' });

  const data = await scraper.scrapePersonById(page, personId)
    .catch(err => ({ error: err.message }));

  await page.close().catch(() => {});

  if ('error' in data) {
    sendEvent('error', { message: data.error });
  } else {
    sendEvent('complete', data);
  }

  res.end();
});

/**
 * Save credentials for a provider
 */
router.post('/:provider/credentials', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { email, username, password } = req.body as ProviderCredentials;

  if (!password) {
    res.status(400).json({ success: false, error: 'Password is required' });
    return;
  }

  credentialsService.saveCredentials(provider, { email, username, password });

  // Update provider config to indicate credentials exist
  const config = providerService.getConfig(provider);
  config.hasCredentials = true;
  providerService.saveConfig(config);

  res.json({
    success: true,
    data: credentialsService.getCredentialsStatus(provider, config.autoLoginEnabled ?? false)
  });
});

/**
 * Get credentials status for a provider (no password returned)
 */
router.get('/:provider/credentials', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const config = providerService.getConfig(provider);

  res.json({
    success: true,
    data: credentialsService.getCredentialsStatus(provider, config.autoLoginEnabled ?? false)
  });
});

/**
 * Delete credentials for a provider
 */
router.delete('/:provider/credentials', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  credentialsService.deleteCredentials(provider);

  // Update provider config
  const config = providerService.getConfig(provider);
  config.hasCredentials = false;
  config.autoLoginEnabled = false;
  providerService.saveConfig(config);

  res.json({ success: true, data: { deleted: true } });
});

/**
 * Toggle auto-login for a provider
 */
router.post('/:provider/toggle-auto-login', (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };
  const { enabled } = req.body as { enabled: boolean };

  // Check if credentials exist
  if (enabled && !credentialsService.hasCredentials(provider)) {
    res.status(400).json({ success: false, error: 'Cannot enable auto-login without credentials' });
    return;
  }

  const config = providerService.getConfig(provider);
  config.autoLoginEnabled = enabled;
  const saved = providerService.saveConfig(config);

  res.json({ success: true, data: saved });
});

/**
 * Trigger manual auto-login attempt
 */
router.post('/:provider/auto-login', async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: BuiltInProvider };

  // Check if credentials exist
  const credentials = credentialsService.getCredentials(provider);
  if (!credentials || !credentials.password) {
    res.status(400).json({ success: false, error: 'No credentials stored for this provider' });
    return;
  }

  const scraper = providerService.getScraper(provider);

  if (!browserService.isConnected()) {
    await browserService.connect().catch(() => null);
  }

  if (!browserService.isConnected()) {
    res.status(503).json({ success: false, error: 'Browser not connected' });
    return;
  }

  const page = await browserService.createPage();

  const username = credentials.email || credentials.username || '';
  const success = await scraper.performLogin(page, username, credentials.password)
    .catch(() => false);

  // Don't close the page - user may need to complete 2FA or verify something

  if (success) {
    // Update logged-in status
    providerService.confirmBrowserLogin(provider, true);
    res.json({ success: true, data: { loggedIn: true } });
  } else {
    res.json({ success: false, error: 'Login failed - check credentials or complete any verification steps in the browser' });
  }
});

export const providerRouter = router;
