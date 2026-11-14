import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test('360px phone: bottom bar, cards instead of table, no sideways scroll', async ({ page }) => {
  await login(page, 'admin');
  await expect(page.locator('.bottombar')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.goto('/#/parts');
  await expect(page.getByText('SP-CPR7EA9').first()).toBeVisible();
  await expect(page.locator('.table thead')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goto('/#/stock-count');
  await expect(page.locator('.count-row').nth(1)).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
