import { test, expect } from '@playwright/test';
import { DEMO } from './helpers.js';

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/');
  await page.locator('#lg-user').fill('admin');
  await page.locator('#lg-pass').fill('wrong-password');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('#login-error')).toBeVisible();
});

test('first login forces a new password, then opens the dashboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('#lg-user').fill('desk');
  await page.locator('#lg-pass').fill(DEMO);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('[name=current_password]')).toBeVisible();
  await page.locator('[name=current_password]').fill(DEMO);
  await page.locator('[name=new_password]').fill('Desk@2026x');
  await page.locator('[name=confirm_password]').fill('Desk@2026x');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('#page-title')).toHaveText('Dashboard');
});
