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

test('walk-in customer returns the part: money given back, credit note printed, part back in stock', async ({ page, context }) => {
  await login(page, 'admin');
  await page.goto('/#/invoices/counter');
  await page.locator('#cs-code').fill('BS-SPL');
  await page.locator('#cs-code').press('Enter');
  await expect(page.locator('#cs-lines')).toContainText('BS-SPL');
  await page.locator('[data-pay="cash"]').fill('260');
  await page.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(page.locator('h1')).toContainText('Paid');

  await page.getByRole('button', { name: 'Return items' }).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toContainText('untick it for a faulty part');
  await drawer.locator('[data-ret]').first().fill('1');
  await expect(drawer.locator('#ret-sum')).toContainText('₹260.00');
  await expect(drawer.locator('#ret-refund')).toContainText('Walk-in customer: give back ₹260.00');
  await expect(drawer.locator('[name=refund]')).toHaveValue('260');
  await drawer.locator('[name=reason]').fill('Wrong size');
  const [note] = await Promise.all([context.waitForEvent('page'), drawer.getByRole('button', { name: 'Return items' }).click()]);
  await note.waitForLoadState();
  await expect(note.locator('.r')).toContainText('CN/');
  await expect(note.locator('.r')).toContainText('Wrong size');
  await expect(page.locator('.toast', { hasText: 'Return CN/' })).toBeVisible();
  await expect(page.locator('.table')).toContainText('1 returned');
  await expect(page.locator('.card', { hasText: 'Returns' })).toContainText('₹260.00 given back');
  await expect(page.getByRole('button', { name: 'Cancel bill' })).toHaveCount(0);
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

test('owner adds an expense category in Settings; it shows up in the cash book', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/settings?tab=expense_categories');
  await expect(page.locator('.table')).toContainText('Machinery');
  await page.getByRole('button', { name: 'New expense type' }).click();
  await page.locator('.drawer [name=name_en]').fill('Cleaning');
  await page.locator('.drawer [name=name_mr]').fill('साफसफाई');
  await page.locator('.drawer').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.table')).toContainText('Cleaning');
  await page.goto('/#/cash');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.locator('.drawer [name=category_id] option', { hasText: 'Cleaning' })).toHaveCount(1);
  await page.locator('.drawer').getByRole('button', { name: 'Cancel' }).click();
});

test('cash book: add an expense, count the drawer, reopen the day', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('.sidebar').getByRole('link', { name: 'Cash book' }).click();
  await expect(page.getByRole('heading', { name: 'Cash book' })).toBeVisible();
  await page.getByRole('button', { name: 'Add expense' }).click();
  const drawer = page.locator('.drawer');
  await drawer.locator('[name=amount]').fill('120');
  await drawer.locator('[name=category_id]').selectOption({ label: 'Snacks' });
  await drawer.locator('[name=note]').fill('Vada pav');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Expense saved');
  const expenses = page.locator('.card', { has: page.getByRole('heading', { name: 'Expenses', exact: true }) });
  await expect(expenses).toContainText('Snacks · Vada pav');
  await expect(expenses).toContainText('₹120.00');

  // First count: say what was in the drawer this morning; the expected cash follows it.
  await page.locator('#close-form [name=opening]').fill('2000');
  await expect(page.locator('#cash-expected')).not.toHaveText('₹0.00');
  const expected = await page.locator('#cash-expected').innerText();
  const value = Number(expected.replace(/[₹,]/g, ''));
  await page.locator('#close-form [name=counted]').fill(String(value - 10));
  await expect(page.locator('#close-diff')).toContainText('Short by ₹10.00');
  await page.getByRole('button', { name: 'Save the count' }).click();
  await expect(page.locator('.toast', { hasText: 'Cash count saved' })).toBeVisible();
  await expect(page.locator('.card', { has: page.getByRole('heading', { name: 'Count the cash' }) })).toContainText('Short by ₹10.00');
  await expect(page.locator('#cash-history')).toContainText('Short by ₹10.00');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.toast', { hasText: 'Day reopened' })).toBeVisible();
  await expect(page.locator('#close-form')).toBeVisible();
});

test('counter sale: the owner changes a part MRP right on the bill', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/invoices/counter');
  await page.locator('#cs-code').fill('GASK-SIL');
  await page.locator('#cs-code').press('Enter');
  await expect(page.locator('#cs-lines')).toContainText('GASK-SIL');
  await page.locator('[data-mrp="0"]').click();
  await page.locator('#prompt-in').fill('333');
  await page.locator('.modal').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.toast', { hasText: 'MRP changed' })).toBeVisible();
  await expect(page.locator('#cs-lines')).toContainText('₹333.00');
  await expect(page.locator('#cs-totals')).toContainText('₹333.00');
});

test('owner edits a final walk-in bill: one piece less, same bill number, money given back', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/invoices/counter');
  await page.locator('#cs-code').fill('BS-SPL');
  await page.locator('#cs-code').press('Enter');
  await expect(page.locator('#cs-lines')).toContainText('BS-SPL');
  await page.locator('[data-q="0"]').fill('2');
  await expect(page.locator('#cs-totals')).toContainText('₹520.00');
  await page.locator('[data-pay="cash"]').fill('520');
  await page.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(page.locator('h1')).toContainText('Paid');
  const billNo = (await page.locator('h1').innerText()).split(/\s+/).find((w) => /\//.test(w));

  await page.getByRole('button', { name: 'Edit bill' }).click();
  const d = page.locator('.drawer');
  await d.locator('[data-e-qty]').first().fill('1');
  await expect(d.locator('#e-sum')).toContainText('Give back: ₹260.00');
  await d.locator('#e-reason').fill('Customer took one');
  await d.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast', { hasText: 'Bill changed' })).toBeVisible();
  await expect(page.locator('#bill-edited')).toContainText('Given back ₹260.00');
  await expect(page.locator('h1')).toContainText(billNo);
});
