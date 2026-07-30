import { expect, test } from '@playwright/test';

test('admin rejects a wrong password then creates a candidate with an authenticated session', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /restricted intake/i })).toBeVisible();
  await page.getByLabel('Admin password').fill('wrong');
  await page.getByRole('button', { name: 'Authenticate' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid credentials');
  await page.getByLabel('Admin password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Authenticate' }).click();
  await expect(page.getByRole('heading', { name: 'Candidate intake' })).toBeVisible();

  await page.getByLabel('Source URL').fill('https://news.example/e2e-source');
  await page.getByLabel('Publisher').fill('E2E Newsroom');
  await page.getByLabel('Source title').fill('Synthetic browser candidate report');
  await page.getByLabel('Publication date').fill('2026-07-30');
  await page.getByLabel('City').fill('Example City');
  await page.getByLabel('County').fill('Example County');
  await page.getByLabel('State', { exact: true }).fill('EX');
  await page.getByLabel('Agency or entity').fill('Example Agency');
  await page.getByLabel('Neutral summary').fill('This is a synthetic browser candidate used only to verify the protected intake flow.');
  await page.getByLabel('Key claims').fill('The synthetic source reported a browser-only test claim.');
  await page.getByLabel('Reviewer notes').fill('E2E synthetic fixture.');
  await page.getByLabel('Incident types').selectOption('other');
  await page.getByRole('button', { name: 'Save candidate for review' }).click();
  await expect(page.getByRole('status')).toContainText('Candidate saved');
});
