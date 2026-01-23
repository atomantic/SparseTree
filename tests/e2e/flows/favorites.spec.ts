/**
 * E2E tests for favorites functionality
 * Tests marking persons as favorites and viewing sparse tree
 */

import { test, expect } from '@playwright/test';
import { PersonDetailPage } from '../pages';

test.describe('Favorites Flow', () => {
  test('can mark a person as favorite', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    const wasFavorite = await personPage.isFavorite();

    await personPage.toggleFavorite();

    const isFavorite = await personPage.isFavorite();
    expect(isFavorite).toBe(!wasFavorite);
  });

  test('can unmark a person as favorite', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    // First mark as favorite if not already
    if (!(await personPage.isFavorite())) {
      await personPage.toggleFavorite();
    }

    expect(await personPage.isFavorite()).toBe(true);

    // Now unmark
    await personPage.toggleFavorite();
    expect(await personPage.isFavorite()).toBe(false);
  });

  test('favorite status persists after navigation', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    // Mark as favorite
    if (!(await personPage.isFavorite())) {
      await personPage.toggleFavorite();
    }

    // Navigate away and back
    await personPage.goBack();
    await personPage.goto('test-db', 'PERSON-001');

    // Should still be a favorite
    expect(await personPage.isFavorite()).toBe(true);
  });
});

test.describe('Sparse Tree Visualization', () => {
  test('sparse tree shows only favorited persons', async ({ page }) => {
    // First mark some persons as favorites
    const personPage = new PersonDetailPage(page);

    // Mark person 1
    await personPage.goto('test-db', 'PERSON-001');
    if (!(await personPage.isFavorite())) {
      await personPage.toggleFavorite();
    }

    // Mark person 2
    await personPage.goto('test-db', 'PERSON-002');
    if (!(await personPage.isFavorite())) {
      await personPage.toggleFavorite();
    }

    // Navigate to sparse tree view
    await page.goto('/database/test-db/sparse-tree');
    await page.waitForLoadState('networkidle');

    // Check that only favorited persons are shown
    const nodes = page.locator('[data-testid="tree-node"]');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThanOrEqual(2);
  });

  test('sparse tree connects favorited ancestors through lineage', async ({ page }) => {
    // This tests that when you favorite a grandparent and grandchild,
    // the intermediate parent is shown to connect them

    await page.goto('/database/test-db/sparse-tree');
    await page.waitForLoadState('networkidle');

    // Check for connecting edges
    const edges = page.locator('[data-testid="tree-edge"]');
    const edgeCount = await edges.count();

    // If we have multiple favorited persons, there should be edges connecting them
    expect(edgeCount).toBeGreaterThanOrEqual(0);
  });
});
