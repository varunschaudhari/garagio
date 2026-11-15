import { test, expect } from '@playwright/test';
import { login, DEMO } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('owner unticks a permission on Users; that person loses the menu and the page', async ({ page, request }) => {
  await login(page, 'admin');
  await page.goto('/#/users');
  await page.locator('tr', { hasText: '@stock' }).getByRole('button', { name: 'Edit' }).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toContainText('What this person can do');
  const box = drawer.getByLabel('Purchase bills, suppliers and supplier payments');
  await expect(box).toBeChecked();
  await box.uncheck();
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  await expect(page.locator('tr', { hasText: '@stock' })).toContainText('Custom access');

  await login(page, 'stock');
  await expect(page.locator('.sidebar')).not.toContainText('Purchases');
  await expect(page.locator('.sidebar')).toContainText('Parts');
  await page.goto('/#/purchases');
  await expect(page.locator('#content')).toContainText('You do not have permission');

  // Put it back (through the API) so other specs keep the default.
  const auth = await (await request.post('/api/auth/login', { data: { username: 'admin', password: DEMO } })).json();
  const users = (await (await request.get('/api/users', { headers: { Authorization: `Bearer ${auth.token}` } })).json()).items;
  const stock = users.find((u) => u.username === 'stock');
  const res = await request.put(`/api/users/${stock.id}`, { headers: { Authorization: `Bearer ${auth.token}` }, data: { permissions: { purchases: true } } });
  expect(res.ok()).toBeTruthy();
});
