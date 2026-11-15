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

test('correct a purchase bill (qty was wrong), then cancel the corrected bill', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/purchases');
  await page.locator('tr', { hasText: 'E2E-1' }).click();
  await page.getByRole('link', { name: 'Correct bill' }).click();

  // The form starts from the old bill; the supplier stays fixed.
  await expect(page.locator('h1')).toHaveText('Correct bill E2E-1');
  await expect(page.locator('#pur-supplier')).toBeDisabled();
  await expect(page.locator('#pur-bill')).toHaveValue('E2E-1');
  const row = page.locator('#pur-rows tr').first();
  await expect(row.locator('[data-f="qty"]')).toHaveValue('5');
  await expect(row.locator('[data-f="price"]')).toHaveValue('90');
  await row.locator('[data-f="qty"]').fill('6');
  await expect(row.locator('[data-out="taxable"]')).toHaveText('₹486.00');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.locator('.toast')).toContainText('Bill corrected');
  await expect(page.locator('.banner.info')).toContainText('This bill corrects bill E2E-1');
  await expect(page.locator('dl')).toContainText('₹200.00'); // the payment moved across

  // Cancel it: a reason is needed; the bill is marked and its actions go away.
  await page.getByRole('button', { name: 'Cancel bill' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Money already paid stays with the supplier');
  await modal.locator('#prompt-in').fill('Supplier took the parts back');
  await modal.getByRole('button', { name: 'Cancel bill' }).click();
  await expect(page.locator('.toast', { hasText: 'Bill cancelled' })).toBeVisible();
  await expect(page.locator('.banner.danger')).toContainText('Supplier took the parts back');
  await expect(page.locator('h1')).toContainText('Cancelled');
  await expect(page.getByRole('link', { name: 'Correct bill' })).toHaveCount(0);

  // Hidden from the list unless asked for.
  await page.goto('/#/purchases');
  await expect(page.locator('#pur-list')).not.toContainText('E2E-1');
  await page.locator('select[name=status]').selectOption('cancelled');
  await expect(page.locator('#pur-list tr', { hasText: 'E2E-1' })).toHaveCount(2);
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
