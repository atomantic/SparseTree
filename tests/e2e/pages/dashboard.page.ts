/**
 * Dashboard Page Object Model
 * Represents the main dashboard with database list
 */

import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly databaseList: Locator;
  readonly databaseCards: Locator;
  readonly emptyState: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.databaseList = page.locator('[data-testid="database-list"]');
    this.databaseCards = page.locator('[data-testid="database-card"]');
    this.emptyState = page.locator('[data-testid="empty-state"]');
    this.searchInput = page.locator('[data-testid="database-search"]');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async getDatabaseCount(): Promise<number> {
    return await this.databaseCards.count();
  }

  async clickDatabase(name: string) {
    const card = this.databaseCards.filter({ hasText: name }).first();
    await card.click();
  }

  async searchDatabases(query: string) {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300); // Debounce
  }

  async getDatabaseNames(): Promise<string[]> {
    const cards = await this.databaseCards.all();
    return Promise.all(
      cards.map(async (card) => {
        const nameEl = card.locator('[data-testid="database-name"]');
        return (await nameEl.textContent())?.trim() || '';
      })
    );
  }
}
