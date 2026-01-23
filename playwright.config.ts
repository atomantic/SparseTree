import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 * For scraper tests, use playwright.scraper.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: './client/public/playwright-report', open: 'never' }],
    ['list'],
  ],
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:6373',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'e2e-tests',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],

  // Web server for E2E tests
  webServer: {
    command: 'npm start',
    url: 'http://localhost:6373',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
