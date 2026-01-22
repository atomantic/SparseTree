/**
 * Person Detail Page Object Model
 * Represents the person detail view with tree visualization
 */

import { Page, Locator } from '@playwright/test';

export class PersonDetailPage {
  readonly page: Page;
  readonly personName: Locator;
  readonly personBio: Locator;
  readonly birthInfo: Locator;
  readonly deathInfo: Locator;
  readonly gender: Locator;
  readonly favoriteButton: Locator;
  readonly parentLinks: Locator;
  readonly childrenLinks: Locator;
  readonly externalIds: Locator;
  readonly treeVisualization: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.personName = page.locator('[data-testid="person-name"]');
    this.personBio = page.locator('[data-testid="person-bio"]');
    this.birthInfo = page.locator('[data-testid="birth-info"]');
    this.deathInfo = page.locator('[data-testid="death-info"]');
    this.gender = page.locator('[data-testid="person-gender"]');
    this.favoriteButton = page.locator('[data-testid="favorite-button"]');
    this.parentLinks = page.locator('[data-testid="parent-link"]');
    this.childrenLinks = page.locator('[data-testid="child-link"]');
    this.externalIds = page.locator('[data-testid="external-id"]');
    this.treeVisualization = page.locator('[data-testid="tree-visualization"]');
    this.backButton = page.locator('[data-testid="back-button"]');
  }

  async goto(dbId: string, personId: string) {
    await this.page.goto(`/database/${dbId}/person/${personId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async getName(): Promise<string> {
    return (await this.personName.textContent())?.trim() || '';
  }

  async getBirthInfo(): Promise<{ date?: string; place?: string }> {
    const birthText = await this.birthInfo.textContent();
    // Parse birth info (format depends on UI implementation)
    return {
      date: birthText?.match(/(\d{1,2}\s+\w+\s+\d{4})/)?.[1],
      place: birthText?.split('-')?.[1]?.trim()
    };
  }

  async getDeathInfo(): Promise<{ date?: string; place?: string }> {
    const deathText = await this.deathInfo.textContent();
    return {
      date: deathText?.match(/(\d{1,2}\s+\w+\s+\d{4})/)?.[1],
      place: deathText?.split('-')?.[1]?.trim()
    };
  }

  async isFavorite(): Promise<boolean> {
    const button = this.favoriteButton;
    const ariaPressed = await button.getAttribute('aria-pressed');
    return ariaPressed === 'true';
  }

  async toggleFavorite(): Promise<void> {
    await this.favoriteButton.click();
    await this.page.waitForTimeout(300);
  }

  async getParentCount(): Promise<number> {
    return await this.parentLinks.count();
  }

  async clickParent(index: number = 0): Promise<void> {
    await this.parentLinks.nth(index).click();
    await this.page.waitForLoadState('networkidle');
  }

  async getChildCount(): Promise<number> {
    return await this.childrenLinks.count();
  }

  async clickChild(index: number = 0): Promise<void> {
    await this.childrenLinks.nth(index).click();
    await this.page.waitForLoadState('networkidle');
  }

  async getExternalIds(): Promise<Array<{ provider: string; id: string }>> {
    const ids: Array<{ provider: string; id: string }> = [];
    const elements = await this.externalIds.all();

    for (const el of elements) {
      const provider = await el.getAttribute('data-provider');
      const id = await el.getAttribute('data-external-id');
      if (provider && id) {
        ids.push({ provider, id });
      }
    }

    return ids;
  }

  async goBack(): Promise<void> {
    await this.backButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}
