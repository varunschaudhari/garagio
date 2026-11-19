import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.beforeEach(async ({ page }) => login(page, 'admin'));

test('search by Marathi name and open the part ledger', async ({ page }) => {
  await page.goto('/#/parts');
  await page.getByRole('searchbox').fill('स्पार्क');
  await page.getByText('SP-CPR7EA9').first().click();
  await expect(page.locator('h1')).toHaveText('Spark plug');
  await expect(page.getByText('Ledger matches stock')).toBeVisible();
  await expect(page.locator('#ledger').getByText('Opening', { exact: true })).toBeVisible();
});

test('create a part with Marathi name and opening stock, then adjust it', async ({ page }) => {
  await page.goto('/#/parts');
  await page.getByRole('button', { name: 'New part' }).click();
  const d = page.locator('.drawer');
  await d.locator('[name=part_no]').fill('E2E-LEVER');
  await d.locator('[name=name_en]').fill('Clutch lever');
  await d.locator('[name=name_mr]').fill('क्लच लिव्हर');
  await d.locator('[name=location_id]').selectOption({ label: 'Counter' });
  await d.locator('[name=rack]').fill('a4');
  await d.locator('[name=selling_price]').fill('120');
  await d.locator('[name=opening_stock]').fill('6');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('h1')).toHaveText('Clutch lever');
  await expect(page.locator('.kpi').first()).toContainText('6');

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.locator('.drawer [name=qty]').fill('-2');
  await page.locator('.drawer [name=reason]').fill('Damaged in transit');
  await page.locator('.drawer').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Stock adjusted');
  await expect(page.locator('#ledger').getByText('Adjustment', { exact: true })).toBeVisible();
  await expect(page.locator('.kpi').first()).toContainText('4');
});

test('stock count posts the difference', async ({ page }) => {
  await page.goto('/#/stock-count');
  await page.locator('[data-loc]').filter({ hasText: 'Counter' }).click();
  const row = page.locator('.count-row', { hasText: 'SP-CPR7EA9' });
  await row.locator('input').fill('38');
  await expect(page.locator('#sc-summary')).toContainText('1 parts differ');
  await page.locator('#sc-post').click();
  await page.locator('.modal').getByRole('button', { name: 'Post count' }).click();
  await expect(page.locator('.toast')).toContainText('Stock count posted: 1 parts changed');
  await expect(page.locator('#sc-history')).toContainText('SC-');
});

test('owner edits shop settings', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator('[name=shop_phone]').fill('02312345678');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
});

test('download the sample Excel and import it back: the shop\'s headings are understood', async ({ page }) => {
  await page.goto('/#/parts');
  await page.getByRole('button', { name: 'Import' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Part Name and MRP are enough');
  const [download] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: 'Download sample Excel' }).click()]);
  expect(download.suggestedFilename()).toBe('parts-import-sample.xlsx');
  await modal.locator('#imp-file').setInputFiles(await download.path());
  await expect(modal.locator('#imp-count')).toContainText('3 rows found in');
  await modal.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(modal.locator('#imp-result')).toContainText('2 created, 1 updated');
  await expect(modal.locator('#imp-result')).toContainText('1 new parts got an automatic part number');
  await modal.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('searchbox').fill('Brake lines');
  await expect(page.getByText('Brake lines').first()).toBeVisible();
});
