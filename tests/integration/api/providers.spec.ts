import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providerService: {
    checkSession: vi.fn(),
    discoverTrees: vi.fn(),
  },
}));

vi.mock('../../../server/src/services/provider.service.js', () => ({
  providerService: mocks.providerService,
}));

vi.mock('../../../server/src/services/browser.service.js', () => ({
  browserService: {},
}));

vi.mock('../../../server/src/services/credentials.service.js', () => ({
  credentialsService: {},
}));

const { providerRouter } = await import('../../../server/src/routes/provider.routes.js');

const app = express();
app.use(express.json());
app.use('/api/scrape-providers', providerRouter);

const failure = (operation: 'check-session' | 'discover-trees', message: string) => ({
  success: false as const,
  error: {
    code: 'PROVIDER_OPERATION_FAILED' as const,
    provider: 'familysearch' as const,
    operation,
    message,
  },
});

describe('Provider routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a successful logged-out session only when it was verified', async () => {
    mocks.providerService.checkSession.mockResolvedValue({
      success: true,
      data: {
        provider: 'familysearch',
        enabled: true,
        loggedIn: false,
        lastChecked: '2026-08-30T00:00:00.000Z',
      },
    });

    const response = await request(app)
      .post('/api/scrape-providers/familysearch/check-session')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        provider: 'familysearch',
        enabled: true,
        loggedIn: false,
        lastChecked: '2026-08-30T00:00:00.000Z',
      },
    });
  });

  it('returns a non-2xx error envelope for an operational session failure', async () => {
    mocks.providerService.checkSession.mockResolvedValue(
      failure('check-session', 'CDP refused connection')
    );

    const response = await request(app)
      .post('/api/scrape-providers/familysearch/check-session')
      .expect(503);

    expect(response.body).toEqual({
      success: false,
      error: 'CDP refused connection',
      details: {
        code: 'PROVIDER_OPERATION_FAILED',
        provider: 'familysearch',
        operation: 'check-session',
        message: 'CDP refused connection',
      },
    });
  });

  it('returns an empty tree list only when discovery succeeded', async () => {
    mocks.providerService.discoverTrees.mockResolvedValue({ success: true, data: [] });

    const response = await request(app)
      .get('/api/scrape-providers/familysearch/trees')
      .expect(200);

    expect(response.body).toEqual({ success: true, data: [] });
  });

  it('returns a non-2xx error envelope when tree discovery fails', async () => {
    mocks.providerService.discoverTrees.mockResolvedValue(
      failure('discover-trees', 'Tree scraper failed')
    );

    const response = await request(app)
      .get('/api/scrape-providers/familysearch/trees')
      .expect(503);

    expect(response.body).toEqual({
      success: false,
      error: 'Tree scraper failed',
      details: {
        code: 'PROVIDER_OPERATION_FAILED',
        provider: 'familysearch',
        operation: 'discover-trees',
        message: 'Tree scraper failed',
      },
    });
  });
});
