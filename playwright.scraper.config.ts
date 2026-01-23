import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for scraper tests only
 * These tests use their own mock servers, no webServer needed
 */
export default defineConfig({
  testDir: './tests/scraper',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'scraper-tests',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
  // No webServer - scraper tests use mock servers
});
