import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const expectNoSeriousViolations = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
};

test('public ledger supports keyboard entry, minimum link targets, and automated accessibility checks', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to incident records' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const undersized = await page.locator('.site-header nav a, .source-record > a:first-child, .archive-link').evaluateAll((links) => links.filter((link) => {
    const box = link.getBoundingClientRect();
    return box.height < 44;
  }).map((link) => link.textContent));
  expect(undersized).toEqual([]);
  await expectNoSeriousViolations(page);
});

test('authenticated intake passes automated accessibility and mobile reflow checks', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Admin password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Authenticate' }).click();
  await expect(page.getByRole('heading', { name: 'Candidate intake' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expectNoSeriousViolations(page);
});
