import { expect, test, type Locator, type Page } from '@playwright/test';
import { PersonDetailPage } from '../pages';

async function expectKeyboardModalFlow(
  page: Page,
  dialog: Locator,
  initialControl: Locator,
  trigger: Locator,
) {
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(initialControl).toBeFocused();

  const focusable = dialog.locator([
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','));
  const first = focusable.first();
  const last = focusable.last();

  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();

  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test.describe('Accessible modal workflows', () => {
  test('person link and relationship dialogs contain keyboard focus', async ({ page }) => {
    const personPage = new PersonDetailPage(page);
    await personPage.goto('test-db', 'PERSON-001');

    const linkTrigger = page.getByTitle('Link Wikipedia article').first();
    await linkTrigger.click();
    const linkDialog = page.getByRole('dialog', { name: 'Link Wikipedia Article' });
    await expectKeyboardModalFlow(
      page,
      linkDialog,
      linkDialog.getByRole('textbox', { name: 'Wikipedia Article URL' }),
      linkTrigger,
    );

    const relationshipTrigger = page.getByTitle('Add or link a spouse');
    await relationshipTrigger.click();
    const relationshipDialog = page.getByRole('dialog', { name: 'Add Relationship' });
    await expectKeyboardModalFlow(
      page,
      relationshipDialog,
      relationshipDialog.getByRole('textbox', { name: 'Search people' }),
      relationshipTrigger,
    );
  });

  test('provider credentials dialog contains keyboard focus', async ({ page }) => {
    await page.goto('/providers/genealogy');
    await page.waitForLoadState('networkidle');

    const trigger = page.getByRole('button', { name: /^(Add Credentials|Update)$/ }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('heading')).toContainText('Credentials');
    await expect(dialog.locator('input').first()).toBeFocused();

    const focusable = dialog.locator('button:not([disabled]), input:not([disabled]):not([type="hidden"])');
    const first = focusable.first();
    const last = focusable.last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
