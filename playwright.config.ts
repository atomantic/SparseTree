import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for scraper and E2E tests
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:6373',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'scraper-tests',
      testMatch: 'tests/scraper/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
    {
      name: 'e2e-tests',
      testMatch: 'tests/e2e/**/*.spec.ts',
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
