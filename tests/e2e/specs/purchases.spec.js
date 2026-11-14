import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('enter a credit purchase bill with the keyboard grid, then pay part of it', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/purchases/new');

  // Supplier picker
  await page.locator('#pur-supplier').fill('Shree');
  await expect(page.locator('.combo-item').first()).toBeVisible();
  await page.locator('#pur-supplier').press('Enter');
  await expect(page.locator('#pur-bill')).toBeFocused();
  await page.locator('#pur-bill').fill('E2E-1');

  // Grid: part → qty → price → disc → GST → next line
  const row = page.locator('#pur-rows tr').first();
  await row.locator('[data-f="part"]').fill('SP-CPR');
  await expect(row.locator('.combo-item').first()).toBeVisible();
  await row.locator('[data-f="part"]').press('Enter');
  await expect(row.locator('[data-f="qty"]')).toBeFocused();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(row.locator('[data-f="price"]')).toBeFocused();
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect(row.locator('[data-f="gst"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pur-rows tr')).toHaveCount(2);
  await expect(page.locator('#pur-rows tr').nth(1).locator('[data-f="part"]')).toBeFocused();

  // 5 × 90 − 10% = 405 taxable + 18% = 477.90 → ₹478
  await expect(row.locator('[data-out="taxable"]')).toHaveText('₹405.00');
  await expect(page.locator('#pur-totals')).toContainText('₹478.00');

  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('Bill saved');
  await expect(page.locator('h1')).toContainText('E2E-1');
  await expect(page.locator('.table')).toContainText('SP-CPR7EA9');

  // Part payment from the bill
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.locator('.drawer [name=amount]')).toHaveValue('478');
  await page.locator('.drawer [name=amount]').fill('200');
  await page.locator('.drawer').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Payment recorded');
  await expect(page.locator('dl')).toContainText('₹278.00');
});

test('supplier ledger shows the bill and the payment with a running balance', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/suppliers');
  await page.getByText('Shree Auto Spares (Demo)').click();
  await expect(page.locator('h1')).toContainText('Shree Auto Spares');
  await expect(page.locator('.table')).toContainText('E2E-1');
  await expect(page.locator('.table')).toContainText('Payment');
  await expect(page.locator('.kpi-value')).toHaveText('₹278.00');
});

test('reorder list groups low-stock parts and offers WhatsApp sharing', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/reorder');
  await expect(page.getByText('No supplier yet')).toBeVisible();
  await expect(page.getByText('Chain lube spray (150 ml)')).toBeVisible();
});

test('mechanic cannot open purchases', async ({ page }) => {
  await login(page, 'ramesh');
  await page.goto('/#/purchases');
  await expect(page.locator('.empty')).toContainText('तुम्हाला याची परवानगी नाही.');
});
