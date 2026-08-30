import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  page: {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    close: vi.fn(),
  },
  scraper: {
    scrapePersonById: vi.fn(),
  },
  browserService: {
    isConnected: vi.fn(),
    createPage: vi.fn(),
  },
  augmentationService: {
    getAugmentation: vi.fn(),
    saveAugmentation: vi.fn(),
    addPlatform: vi.fn(),
  },
  idMappingService: {
    resolveId: vi.fn(),
    getExternalId: vi.fn(),
    registerExternalId: vi.fn(),
  },
  databaseService: {
    getPerson: vi.fn(),
  },
  logger: {
    browser: vi.fn(),
    data: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  downloadImage: vi.fn(),
  ensureDir: vi.fn(),
}));

vi.mock('fs', () => ({ default: mocks.fs }));

vi.mock('../../../server/src/services/browser.service.js', () => ({
  browserService: mocks.browserService,
}));

vi.mock('../../../server/src/services/scrapers/index.js', () => ({
  getScraper: vi.fn(() => mocks.scraper),
}));

vi.mock('../../../server/src/services/augmentation.service.js', () => ({
  augmentationService: mocks.augmentationService,
}));

vi.mock('../../../server/src/services/id-mapping.service.js', () => ({
  idMappingService: mocks.idMappingService,
}));

vi.mock('../../../server/src/services/database.service.js', () => ({
  databaseService: mocks.databaseService,
}));

vi.mock('../../../server/src/db/sqlite.service.js', () => ({
  sqliteService: {},
}));

vi.mock('../../../server/src/services/familysearch-refresh.service.js', () => ({
  familySearchRefreshService: {},
}));

vi.mock('../../../server/src/lib/familysearch/index.js', () => ({
  json2person: vi.fn(),
}));

vi.mock('../../../server/src/lib/logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('../../../server/src/services/local-override.service.js', () => ({
  localOverrideService: {},
}));

vi.mock('../../../server/src/utils/applyOverrides.js', () => ({
  applyLocalOverrides: vi.fn(),
}));

vi.mock('../../../server/src/utils/paths.js', () => ({
  PHOTOS_DIR: '/tmp/sparsetree-test-photos',
  PROVIDER_CACHE_DIR: '/tmp/sparsetree-test-provider-cache',
  ensureDir: mocks.ensureDir,
}));

vi.mock('../../../server/src/utils/downloadImage.js', () => ({
  downloadImage: mocks.downloadImage,
}));

vi.mock('../../../server/src/utils/providerCache.js', () => ({
  getPhotoSuffix: vi.fn(() => '-ancestry'),
  getCachedProviderData: vi.fn(() => null),
}));

vi.mock('../../../server/src/utils/normalizePhotoUrl.js', () => ({
  normalizePhotoUrl: vi.fn((url: string) => url),
}));

const { multiPlatformComparisonService } = await import(
  '../../../server/src/services/multi-platform-comparison.service.js'
);

const getProviderData = () =>
  multiPlatformComparisonService.getProviderData('person-1', 'ancestry', true, 'db-1');

function expectNoPartialMutation(): void {
  expect(mocks.fs.writeFileSync).not.toHaveBeenCalled();
  expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
  expect(mocks.downloadImage).not.toHaveBeenCalled();
  expect(mocks.augmentationService.saveAugmentation).not.toHaveBeenCalled();
  expect(mocks.augmentationService.addPlatform).not.toHaveBeenCalled();
  expect(mocks.idMappingService.registerExternalId).not.toHaveBeenCalled();
}

describe('multiPlatformComparisonService.getProviderData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.browserService.isConnected.mockReturnValue(true);
    mocks.browserService.createPage.mockResolvedValue(mocks.page);
    mocks.augmentationService.getAugmentation.mockReturnValue({
      personId: 'person-1',
      platforms: [
        {
          platform: 'ancestry',
          externalId: 'ancestry-1',
          url: 'https://www.ancestry.com/family-tree/person/tree/123/person/456/facts',
        },
      ],
      photos: [],
    });
    mocks.idMappingService.resolveId.mockReturnValue(null);
    mocks.page.goto.mockResolvedValue(undefined);
    mocks.page.waitForTimeout.mockResolvedValue(undefined);
    mocks.page.close.mockResolvedValue(undefined);
    mocks.scraper.scrapePersonById.mockResolvedValue({
      externalId: 'ancestry-1',
      provider: 'ancestry',
      name: 'Example Person',
      scrapedAt: '2026-08-30T00:00:00.000Z',
    });
  });

  it('closes the page and preserves the navigation error when Ancestry setup fails', async () => {
    const navigationError = new Error('navigation unavailable');
    mocks.page.goto.mockRejectedValue(navigationError);
    mocks.page.close.mockRejectedValue(new Error('browser disconnected'));

    await expect(getProviderData()).rejects.toBe(navigationError);

    expect(mocks.scraper.scrapePersonById).not.toHaveBeenCalled();
    expect(mocks.page.close).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'compare',
      'Failed to close scrape page for ancestry/ancestry-1: browser disconnected'
    );
    expectNoPartialMutation();
  });

  it('closes the page and returns null when the scraper rejects', async () => {
    mocks.scraper.scrapePersonById.mockRejectedValue(new Error('scrape failed'));

    await expect(getProviderData()).resolves.toBeNull();

    expect(mocks.page.goto).toHaveBeenCalledTimes(1);
    expect(mocks.page.waitForTimeout).toHaveBeenCalledTimes(1);
    expect(mocks.page.close).toHaveBeenCalledTimes(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'compare',
      'Failed to scrape ancestry/ancestry-1: scrape failed'
    );
    expectNoPartialMutation();
  });
});
