import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ createPage: vi.fn(), navigateTo: vi.fn(), close: vi.fn(async () => undefined), download: vi.fn() }));
vi.mock('../../../server/src/services/browser.service', () => ({
  browserService: { isConnected: () => true, createPage: mocks.createPage, navigateTo: mocks.navigateTo },
  isFamilySearchAuthUrl: () => false,
}));
vi.mock('../../../server/src/services/id-mapping.service', () => ({ idMappingService: { resolveId: () => 'canonical', getExternalId: () => 'KWCJ-QVS' } }));
vi.mock('../../../server/src/services/familysearch-redirect.service.js', () => ({ checkForRedirect: vi.fn() }));
vi.mock('../../../server/src/utils/downloadImage.js', () => ({ downloadImage: mocks.download }));
vi.mock('../../../server/src/lib/logger.js', () => ({ logger: { browser: vi.fn(), data: vi.fn(), warn: vi.fn() } }));
const { scraperService } = await import('../../../server/src/services/scraper.service');

describe('browser scraper cancellation', () => {
  it('interrupts owned page navigation and closes it once without using a shared page', async () => {
    const controller = new AbortController();
    let rejectNavigation: (error: Error) => void = () => undefined;
    const goto = vi.fn(() => new Promise((_resolve, reject) => { rejectNavigation = reject; }));
    mocks.close.mockImplementationOnce(async () => { rejectNavigation(new Error('page closed')); });
    mocks.createPage.mockResolvedValueOnce({ goto, close: mocks.close });
    const pending = scraperService.scrapePerson('KWCJ-QVS', undefined, controller.signal);
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toThrow('page closed');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('does no browser work when already cancelled', async () => {
    vi.clearAllMocks();
    const controller = new AbortController();
    controller.abort();
    await expect(scraperService.scrapePerson('KWCJ-QVS', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.createPage).not.toHaveBeenCalled();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
