import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test('counter sale by barcode, paid by UPI, bill printed', async ({ page, context }) => {
  await login(page, 'admin');
  await page.goto('/#/invoices/counter');
  await page.locator('#cs-code').fill('BS-SPL');
  await page.locator('#cs-code').press('Enter');
  await expect(page.locator('#cs-lines')).toContainText('BS-SPL');
  await expect(page.locator('#cs-totals')).toContainText('₹260.00');
  await page.locator('[data-pay="upi"]').fill('260');
  await expect(page.locator('#pay-credit')).toHaveText('₹0.00');
  await page.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(page.locator('.toast')).toContainText('Bill INV/');
  await expect(page.locator('h1')).toContainText('Paid');
  const [bill] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Print / PDF' }).click()]);
  await bill.waitForLoadState();
  await expect(bill.locator('body')).toContainText('कर बीजक');
  await expect(bill.locator('body')).toContainText('Two Hundred Sixty');
});

test('walk-in customer cannot take credit', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/invoices/counter');
  await page.locator('#cs-code').fill('GASK-SIL');
  await page.locator('#cs-code').press('Enter');
  await expect(page.locator('#cs-lines')).toContainText('GASK-SIL');
  await page.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(page.locator('.toast')).toContainText('Credit is only for customers the owner marked as trusted');
  await expect(page.locator('h1')).toContainText('Draft');
});
