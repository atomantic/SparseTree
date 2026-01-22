/**
 * Search Page Object Model
 * Represents the search interface with filters
 */

import { Page, Locator } from '@playwright/test';

export class SearchPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly locationFilter: Locator;
  readonly occupationFilter: Locator;
  readonly birthYearFrom: Locator;
  readonly birthYearTo: Locator;
  readonly resultsList: Locator;
  readonly resultCards: Locator;
  readonly resultCount: Locator;
  readonly noResults: Locator;
  readonly pagination: Locator;
  readonly nextPageButton: Locator;
  readonly prevPageButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('[data-testid="search-input"]');
    this.searchButton = page.locator('[data-testid="search-button"]');
    this.locationFilter = page.locator('[data-testid="location-filter"]');
    this.occupationFilter = page.locator('[data-testid="occupation-filter"]');
    this.birthYearFrom = page.locator('[data-testid="birth-year-from"]');
    this.birthYearTo = page.locator('[data-testid="birth-year-to"]');
    this.resultsList = page.locator('[data-testid="search-results"]');
    this.resultCards = page.locator('[data-testid="search-result-card"]');
    this.resultCount = page.locator('[data-testid="result-count"]');
    this.noResults = page.locator('[data-testid="no-results"]');
    this.pagination = page.locator('[data-testid="pagination"]');
    this.nextPageButton = page.locator('[data-testid="next-page"]');
    this.prevPageButton = page.locator('[data-testid="prev-page"]');
  }

  async goto(dbId: string) {
    await this.page.goto(`/database/${dbId}/search`);
    await this.page.waitForLoadState('networkidle');
  }

  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async searchWithFilters(options: {
    query?: string;
    location?: string;
    occupation?: string;
    birthYearFrom?: number;
    birthYearTo?: number;
  }) {
    if (options.query) {
      await this.searchInput.fill(options.query);
    }
    if (options.location) {
      await this.locationFilter.fill(options.location);
    }
    if (options.occupation) {
      await this.occupationFilter.fill(options.occupation);
    }
    if (options.birthYearFrom) {
      await this.birthYearFrom.fill(options.birthYearFrom.toString());
    }
    if (options.birthYearTo) {
      await this.birthYearTo.fill(options.birthYearTo.toString());
    }

    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getResultCount(): Promise<number> {
    return await this.resultCards.count();
  }

  async getTotalResultCount(): Promise<number> {
    const text = await this.resultCount.textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getResultNames(): Promise<string[]> {
    const cards = await this.resultCards.all();
    return Promise.all(
      cards.map(async (card) => {
        const nameEl = card.locator('[data-testid="result-name"]');
        return (await nameEl.textContent())?.trim() || '';
      })
    );
  }

  async clickResult(index: number = 0) {
    await this.resultCards.nth(index).click();
    await this.page.waitForLoadState('networkidle');
  }

  async hasResults(): Promise<boolean> {
    return (await this.resultCards.count()) > 0;
  }

  async hasNoResults(): Promise<boolean> {
    return await this.noResults.isVisible();
  }

  async goToNextPage() {
    await this.nextPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async goToPrevPage() {
    await this.prevPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getCurrentPage(): Promise<number> {
    const currentPage = this.page.locator('[data-testid="current-page"]');
    const text = await currentPage.textContent();
    return parseInt(text || '1', 10);
  }
}
