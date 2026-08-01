import { expect, test } from '@playwright/test';

test('timeline bubbles link to the corresponding full report', async ({ page }) => {
  await page.goto('/timeline');
  const lastBubble = page.locator('.report-timeline__bubble').last();
  const reportId = (await lastBubble.getAttribute('href'))?.split('/').at(-1);
  expect(reportId).toBeTruthy();
  await lastBubble.click();
  await expect(page).toHaveURL(new RegExp(`/reports/${reportId}$`));
  await expect(page.locator(`article[id="${reportId}"]`)).toBeInViewport();
});
