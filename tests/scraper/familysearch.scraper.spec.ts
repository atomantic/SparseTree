/**
 * FamilySearch scraper tests against mock server
 */

import { test, expect } from '@playwright/test';
import { createMockFamilySearchServer, type MockPerson } from '../__mocks__/providers/familysearch/server';

const MOCK_PORT = 3333;
let mockServer: ReturnType<typeof createMockFamilySearchServer>;

test.beforeAll(async () => {
  mockServer = createMockFamilySearchServer(MOCK_PORT);
  await mockServer.start();
  // Pre-authenticate
  mockServer.state.isLoggedIn = true;
  mockServer.state.currentUser = 'testuser';
});

test.afterAll(() => {
  mockServer.stop();
});

test.describe('FamilySearch Scraper', () => {
  const baseUrl = `http://localhost:${MOCK_PORT}`;

  test.describe('Person Detail Page', () => {
    test('extracts person name from page', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const nameElement = await page.locator('[data-testid="person-name"]');
      const name = await nameElement.textContent();

      expect(name?.trim()).toBe('John Smith');
    });

    test('extracts birth date and place', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const birthDate = await page.locator('[data-testid="birth-date"]').textContent();
      const birthPlace = await page.locator('[data-testid="birth-place"]').textContent();

      expect(birthDate?.trim()).toBe('1 January 1850');
      expect(birthPlace?.trim()).toBe('Boston, Massachusetts, United States');
    });

    test('extracts death date and place', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const deathDate = await page.locator('[data-testid="death-date"]').textContent();
      const deathPlace = await page.locator('[data-testid="death-place"]').textContent();

      expect(deathDate?.trim()).toBe('15 December 1920');
      expect(deathPlace?.trim()).toBe('New York, New York, United States');
    });

    test('extracts gender', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const gender = await page.locator('[data-testid="sex-value"]').textContent();

      expect(gender?.trim().toLowerCase()).toBe('male');
    });

    test('extracts portrait photo URL', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const portraitImg = await page.locator('[data-testid="person-portrait"] img');
      const src = await portraitImg.getAttribute('src');

      expect(src).toContain('portrait-test-001');
    });

    test('extracts father link and ID', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const fatherLink = await page.locator('[data-testid="father-card"] a');
      const href = await fatherLink.getAttribute('href');
      const name = await fatherLink.textContent();

      expect(href).toContain('TEST-002');
      expect(name?.trim()).toBe('James Smith');
    });

    test('extracts mother link and ID', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const motherLink = await page.locator('[data-testid="mother-card"] a');
      const href = await motherLink.getAttribute('href');
      const name = await motherLink.textContent();

      expect(href).toContain('TEST-003');
      expect(name?.trim()).toBe('Mary Johnson');
    });

    test('shows children section when person has children', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const childCards = await page.locator('[data-testid="child-card"]').all();
      expect(childCards.length).toBe(2);

      const firstChildName = await childCards[0].locator('a').textContent();
      expect(firstChildName?.trim()).toBe('Robert Smith');
    });

    test('handles person without parents gracefully', async ({ page }) => {
      // Add a person without parents
      mockServer.addPerson({
        id: 'ORPHAN-001',
        name: 'Orphan Person',
        gender: 'Male',
        birthDate: '1900',
        birthPlace: 'Unknown'
      });

      await page.goto(`${baseUrl}/tree/person/details/ORPHAN-001`);

      const name = await page.locator('[data-testid="person-name"]').textContent();
      expect(name?.trim()).toBe('Orphan Person');

      // Should not have parent cards
      const fatherCard = await page.locator('[data-testid="father-card"]').count();
      const motherCard = await page.locator('[data-testid="mother-card"]').count();

      expect(fatherCard).toBe(0);
      expect(motherCard).toBe(0);
    });

    test('returns 404 for non-existent person', async ({ page }) => {
      const response = await page.goto(`${baseUrl}/tree/person/details/NONEXISTENT`);

      expect(response?.status()).toBe(404);
    });
  });

  test.describe('Login Flow', () => {
    test('redirects to login when not authenticated', async ({ page }) => {
      // Log out first
      mockServer.state.isLoggedIn = false;
      mockServer.state.currentUser = null;

      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      // Should redirect to signin
      expect(page.url()).toContain('/signin');

      // Re-authenticate for other tests
      mockServer.state.isLoggedIn = true;
      mockServer.state.currentUser = 'testuser';
    });

    test('login page has required form fields', async ({ page }) => {
      await page.goto(`${baseUrl}/signin`);

      const usernameInput = await page.locator('#userName');
      const passwordInput = await page.locator('#password');
      const submitButton = await page.locator('button[type="submit"]');

      expect(await usernameInput.isVisible()).toBe(true);
      expect(await passwordInput.isVisible()).toBe(true);
      expect(await submitButton.isVisible()).toBe(true);
    });

    test('shows user menu when logged in', async ({ page }) => {
      mockServer.state.isLoggedIn = true;
      mockServer.state.currentUser = 'testuser';

      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const userMenu = await page.locator('[data-testid="user-menu"]');
      expect(await userMenu.isVisible()).toBe(true);

      const userName = await page.locator('[data-testid="header-user-name"]').textContent();
      expect(userName).toBe('testuser');
    });
  });

  test.describe('Data Extraction Utilities', () => {
    test('can extract embedded JSON data', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      const jsonData = await page.evaluate(() => {
        const script = document.getElementById('person-data');
        return script ? JSON.parse(script.textContent || '{}') : null;
      });

      expect(jsonData).not.toBeNull();
      expect(jsonData.id).toBe('TEST-001');
      expect(jsonData.name).toBe('John Smith');
    });

    test('extracts all required selectors', async ({ page }) => {
      await page.goto(`${baseUrl}/tree/person/details/TEST-001`);

      // Verify all the selectors from selectors.json work
      const selectors = {
        personName: '[data-testid="person-name"]',
        birthDate: '[data-testid="birth-date"]',
        birthPlace: '[data-testid="birth-place"]',
        deathDate: '[data-testid="death-date"]',
        deathPlace: '[data-testid="death-place"]',
        gender: '[data-testid="sex-value"]',
        userMenu: '[data-testid="user-menu"]'
      };

      for (const [name, selector] of Object.entries(selectors)) {
        const element = await page.locator(selector);
        const isVisible = await element.isVisible().catch(() => false);
        expect(isVisible, `Selector "${name}" (${selector}) should be visible`).toBe(true);
      }
    });
  });
});
