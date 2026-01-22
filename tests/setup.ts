/**
 * Global test setup for SparseTree BDD testing suite
 */

import { beforeAll, afterAll, afterEach } from 'vitest';

// Global setup - runs once before all tests
beforeAll(async () => {
  // Initialize test environment
  process.env.NODE_ENV = 'test';
  process.env.TEST_MODE = 'true';
});

// Global teardown - runs once after all tests
afterAll(async () => {
  // Cleanup test environment
});

// Reset after each test
afterEach(async () => {
  // Reset mocks, clear test data, etc.
});
