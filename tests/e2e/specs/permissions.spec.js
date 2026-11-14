import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test('mechanic sees stock and rack but no cost, and no admin menus (Marathi UI)', async ({ page }) => {
  await login(page, 'ramesh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
  await expect(page.locator('.nav')).not.toContainText('सेटिंग्ज');
  await page.goto('/#/parts?q=SP-CPR7EA9');
  await page.getByText('SP-CPR7EA9').first().click();
  await expect(page.locator('h1')).toHaveText('स्पार्क प्लग');
  await expect(page.locator('.kpi-label', { hasText: 'जागा' })).toBeVisible();
  await expect(page.getByText('सरासरी खर्च')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'बदला' })).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.locator('.empty')).toContainText('तुम्हाला याची परवानगी नाही.');
});
