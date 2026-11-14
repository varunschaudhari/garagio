import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Non-destructive: the real go-live wipe is covered by the API tests (tests/cases/08_golive.php).

test('owner sees the system check and the guarded go-live form', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/settings?tab=system');
  await expect(page.getByRole('heading', { name: 'System check' })).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Database tables' })).toHaveClass(/health-ok/);
  await expect(page.locator('.list-item', { hasText: 'Demo customers / suppliers' })).toHaveClass(/health-warn/);

  const form = page.locator('form[data-golive]');
  await expect(form).toContainText('Remove only the demo ones');
  await form.getByRole('button', { name: 'Remove trial data' }).click();
  await expect(form.locator('.field.invalid')).toHaveCount(2); // RESET + password are required

  await form.getByLabel('Type RESET to confirm').fill('RESET');
  await form.getByLabel('Your password').fill('wrong-password');
  await form.getByRole('button', { name: 'Remove trial data' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Remove trial data' }).click();
  await expect(form.locator('.field.invalid')).toContainText('Wrong');
  await expect(page.locator('.list-item', { hasText: 'Demo customers / suppliers' })).toHaveClass(/health-warn/);
});

test('System tab is not reachable for the inventory manager', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/settings?tab=system');
  await expect(page.getByRole('heading', { name: 'System check' })).toHaveCount(0);
});
