import { expect, test } from '@playwright/test';

test('public homepage presents the source-grounded incident ledger', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/The Abusive Surveillance State/);
  await expect(page.getByRole('heading', { name: 'The Abusive Surveillance State', level: 1 })).toBeVisible();
  const record = page.getByRole('article', { name: /Milwaukee officer sentenced after repeated personal Flock searches/i });
  await expect(record).toBeVisible();
  await expect(record.getByText(/179 times for personal reasons/i)).toBeVisible();
  await expect(record.getByRole('link', { name: /FOX6 News Milwaukee/i })).toHaveAttribute('rel', /noopener/);
  await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('public filters use URL query parameters', async ({ page }) => {
  await page.goto('/?status=verified&q=audit');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('verified');
  await expect(page.getByRole('searchbox', { name: /search incidents/i })).toHaveValue('audit');
});
