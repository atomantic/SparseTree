import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
    exclude: ['tests/e2e/**', 'tests/scraper/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'server/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/node_modules/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
