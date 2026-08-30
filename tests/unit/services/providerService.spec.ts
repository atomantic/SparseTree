import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browserService: {
    isConnected: vi.fn(),
    connect: vi.fn(),
    getWorkerPage: vi.fn(),
  },
  scraper: {
    checkLoginStatus: vi.fn(),
    getLoggedInUser: vi.fn(),
    listTrees: vi.fn(),
  },
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../../server/src/services/browser.service.js', () => ({
  browserService: mocks.browserService,
  isFamilySearchAuthUrl: vi.fn(),
}));

vi.mock('../../../server/src/services/credentials.service.js', () => ({
  credentialsService: {},
}));

vi.mock('../../../server/src/services/scrapers/index.js', () => ({
  getScraper: vi.fn(() => mocks.scraper),
  getProviderInfo: vi.fn(),
  listProviders: vi.fn(() => ['familysearch']),
  PROVIDER_DEFAULTS: {},
}));

vi.mock('../../../server/src/lib/logger.js', () => ({
  logger: mocks.logger,
}));

const { providerService } = await import('../../../server/src/services/provider.service.js');

describe('providerService operational failures', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    vi.spyOn(providerService, 'getConfig').mockReturnValue({
      provider: 'familysearch',
      enabled: true,
      rateLimit: { minDelayMs: 1000, maxDelayMs: 2000 },
      browserScrapeEnabled: true,
      browserLoggedIn: false,
    });
    vi.spyOn(providerService, 'getAllConfigs').mockReturnValue({
      providers: {
        familysearch: {
          provider: 'familysearch',
          enabled: true,
          rateLimit: { minDelayMs: 1000, maxDelayMs: 2000 },
          browserScrapeEnabled: true,
          browserLoggedIn: false,
        },
      },
      lastUpdated: '2026-08-30T00:00:00.000Z',
    } as ReturnType<typeof providerService.getAllConfigs>);
    mocks.browserService.isConnected.mockReturnValue(true);
    mocks.browserService.getWorkerPage.mockResolvedValue({});
    mocks.scraper.checkLoginStatus.mockResolvedValue(false);
    mocks.scraper.getLoggedInUser.mockResolvedValue(null);
    mocks.scraper.listTrees.mockResolvedValue([]);
  });

  it('returns a failure result and logs context when the CDP connection rejects', async () => {
    mocks.browserService.isConnected.mockReturnValue(false);
    mocks.browserService.connect.mockRejectedValue(new Error('CDP refused connection'));

    const result = await providerService.checkSession('familysearch');

    expect(result).toEqual({
      success: false,
      error: {
        code: 'PROVIDER_OPERATION_FAILED',
        provider: 'familysearch',
        operation: 'check-session',
        message: 'CDP refused connection',
      },
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'provider-operation',
      'provider=familysearch operation=check-session error=CDP refused connection'
    );
  });

  it('keeps a verified logged-out session as a successful negative result', async () => {
    const result = await providerService.checkSession('familysearch');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        provider: 'familysearch',
        enabled: true,
        loggedIn: false,
      });
    }
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it('returns a failure result when the provider login-status check rejects', async () => {
    mocks.scraper.checkLoginStatus.mockRejectedValue(new Error('Login markup changed'));

    const result = await providerService.checkSession('familysearch');

    expect(result).toMatchObject({
      success: false,
      error: {
        provider: 'familysearch',
        operation: 'check-session',
        message: 'Login markup changed',
      },
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'provider-operation',
      'provider=familysearch operation=check-session error=Login markup changed'
    );
  });

  it('preserves successful statuses and structured failures in aggregate checks', async () => {
    mocks.scraper.checkLoginStatus.mockRejectedValue(new Error('Login markup changed'));

    const summary = await providerService.checkAllSessions();

    expect(summary.statuses).toEqual({});
    expect(summary.failures).toEqual({
      familysearch: {
        code: 'PROVIDER_OPERATION_FAILED',
        provider: 'familysearch',
        operation: 'check-session',
        message: 'Login markup changed',
      },
    });
  });

  it('keeps a verified empty tree list as a successful negative result', async () => {
    const result = await providerService.discoverTrees('familysearch');

    expect(result).toEqual({ success: true, data: [] });
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it('returns a failure result and logs context when tree discovery rejects', async () => {
    mocks.scraper.listTrees.mockRejectedValue(new Error('Tree scraper failed'));

    const result = await providerService.discoverTrees('familysearch');

    expect(result).toEqual({
      success: false,
      error: {
        code: 'PROVIDER_OPERATION_FAILED',
        provider: 'familysearch',
        operation: 'discover-trees',
        message: 'Tree scraper failed',
      },
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'provider-operation',
      'provider=familysearch operation=discover-trees error=Tree scraper failed'
    );
  });
});
