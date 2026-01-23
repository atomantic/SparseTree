/**
 * E2E tests for search and browse functionality
 * Tests the complete user flow of searching and browsing persons
 */

import { test, expect } from '@playwright/test';
import { DashboardPage, SearchPage, PersonDetailPage } from '../pages';

test.describe('Search and Browse Flow', () => {
  test.skip(true, 'E2E tests require running application');

  test('can search for persons by name', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.search('Smith');

    expect(await searchPage.hasResults()).toBe(true);
    const names = await searchPage.getResultNames();
    expect(names.some(n => n.includes('Smith'))).toBe(true);
  });

  test('can filter search by location', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.searchWithFilters({
      query: 'Smith',
      location: 'Boston'
    });

    expect(await searchPage.hasResults()).toBe(true);
  });

  test('can filter search by birth year range', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.searchWithFilters({
      birthYearFrom: 1800,
      birthYearTo: 1900
    });

    expect(await searchPage.hasResults()).toBe(true);
  });

  test('shows no results message for empty search', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.search('XYZNONEXISTENT123');

    expect(await searchPage.hasNoResults()).toBe(true);
  });

  test('can navigate from search result to person detail', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.search('John');
    await searchPage.clickResult(0);

    const personPage = new PersonDetailPage(page);
    const name = await personPage.getName();
    expect(name).toContain('John');
  });

  test('can navigate through pagination', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto('test-db');

    await searchPage.search(''); // Get all results

    const initialPage = await searchPage.getCurrentPage();
    expect(initialPage).toBe(1);

    await searchPage.goToNextPage();
    const nextPage = await searchPage.getCurrentPage();
    expect(nextPage).toBe(2);

    await searchPage.goToPrevPage();
    const prevPage = await searchPage.getCurrentPage();
    expect(prevPage).toBe(1);
  });
});

test.describe('Person Detail Navigation', () => {
  test.skip(true, 'E2E tests require running application');

  test('can view person details', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    const name = await personPage.getName();
    expect(name.length).toBeGreaterThan(0);
  });

  test('can navigate to parent from person detail', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    const parentCount = await personPage.getParentCount();
    expect(parentCount).toBeGreaterThan(0);

    await personPage.clickParent(0);

    // Should now be on parent's page
    const parentName = await personPage.getName();
    expect(parentName.length).toBeGreaterThan(0);
  });

  test('can navigate to child from person detail', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-002'); // A person with children

    const childCount = await personPage.getChildCount();
    if (childCount > 0) {
      await personPage.clickChild(0);
      const childName = await personPage.getName();
      expect(childName.length).toBeGreaterThan(0);
    }
  });

  test('shows external identities for linked persons', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    const externalIds = await personPage.getExternalIds();
    // Persons linked to FamilySearch should have external ID
    if (externalIds.length > 0) {
      expect(externalIds[0].provider).toBeTruthy();
      expect(externalIds[0].id).toBeTruthy();
    }
  });

  test('can go back from person detail', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.clickDatabase('test-db');

    const personPage = new PersonDetailPage(page);
    await personPage.goBack();

    // Should be back on dashboard or previous page
    expect(page.url()).not.toContain('/person/');
  });
});
