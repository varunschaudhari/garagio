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
  const [bill] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'A4 bill / PDF' }).click()]);
  await bill.waitForLoadState();
  await expect(bill.locator('body')).toContainText('कर बीजक');
  await expect(bill.locator('body')).toContainText('Two Hundred Sixty');
  // Thermal receipt for the phone printer: one language (walk-in → Marathi), the shop's 80 mm paper.
  const [receipt] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Print receipt' }).click()]);
  await receipt.waitForLoadState();
  await expect(receipt.locator('.r')).toContainText('कर बीजक');
  await expect(receipt.locator('.r')).toContainText('₹260.00');
  await expect(receipt.locator('.r')).not.toContainText('Tax Invoice');
  const width = await receipt.locator('.r').evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(width)).toBe(272); // 80 mm paper → 72 mm printable ≈ 272 px
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
