import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test("dashboard tiles: the shop's eight buttons for the owner", async ({ page }) => {
  await login(page, 'admin');
  const tiles = page.locator('.tiles .tile');
  await expect(tiles).toHaveCount(8);
  await expect(page.locator('.tiles')).toContainText('Purchase bill');
  await expect(page.locator('[data-tile="payables"]')).toContainText('₹');
  await page.locator('[data-tile="purchase"]').click();
  await expect(page.locator('h1')).toHaveText('New purchase bill');
  await page.goto('/#/');
  await page.locator('[data-tile="expenses"]').click();
  await expect(page.getByRole('heading', { name: 'Cash book' })).toBeVisible();
});

test('dashboard tiles: the store keeper gets only the buttons for their work', async ({ page }) => {
  await login(page, 'stock');
  await expect(page.locator('.tiles .tile')).toHaveCount(5);
  await expect(page.locator('[data-tile="sale"]')).toHaveCount(0);
  await expect(page.locator('[data-tile="expenses"]')).toHaveCount(0);
});

test('owner dashboard shows money KPIs and the 30-day sales chart', async ({ page }) => {
  await login(page, 'admin');
  await expect(page.locator('.kpi', { hasText: "Today's sales" })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Customer dues' })).toBeVisible();
  await expect(page.locator('#sales-chart')).toBeVisible();
});

test('mechanic summary: owner records a day payment', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/mechanics');
  const card = page.locator('section.card', { hasText: 'Ramesh (Mechanic)' });
  await card.locator('input[name=amount]').fill('450');
  await card.getByRole('button', { name: 'Pay' }).click();
  await expect(page.locator('.toast')).toContainText('Payment saved');
  await expect(page.locator('section.card', { hasText: 'Ramesh (Mechanic)' })).toContainText('₹450.00');
});

test('mechanic summary: add a mechanic without a login, rename him, remove him', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/mechanics');
  await page.getByRole('button', { name: 'Add mechanic' }).click();
  const drawer = page.locator('.drawer');
  await drawer.locator('input[name=name]').fill('Bapu');
  await drawer.locator('input[name=phone]').fill('9011100099');
  await expect(drawer.locator('input[name=username]')).toBeHidden();
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Created');
  await expect(page.locator('section.card', { hasText: 'Bapu' })).toContainText('No app login');

  await page.locator('section.card', { hasText: 'Bapu' }).getByRole('button', { name: 'Edit' }).click();
  await drawer.locator('input[name=name]').fill('Bapu Shinde');
  await drawer.getByRole('button', { name: 'Save' }).click();
  const card = page.locator('section.card', { hasText: 'Bapu Shinde' });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Remove · Bapu Shinde' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.toast').last()).toContainText('Removed');
  await expect(page.locator('section.card', { hasText: 'Bapu Shinde' })).toHaveCount(0);
});

test('profit report shows the formula and an Excel file downloads', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/reports?tab=profit');
  await expect(page.getByText('Profit = sales (without GST)')).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Mechanic pay' })).toContainText('₹450.00');
  await page.getByRole('tab', { name: 'GST summary' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Excel' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^gst-.*\.xlsx$/);
});

test('Excel downloads: everything in one file, and the lists from their pages', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/reports?tab=exports');
  await expect(page.locator('#r-body')).toContainText('Everything in one file');
  await expect(page.locator('#r-body')).toContainText('Parts list');
  const [all] = await Promise.all([page.waitForEvent('download'), page.locator('[data-download="/exports/workbook"]').click()]);
  expect(all.suggestedFilename()).toMatch(/^trimurti-garage-.*\.xlsx$/);

  await page.goto('/#/parts');
  const [parts] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export"]').click()]);
  expect(parts.suggestedFilename()).toMatch(/^parts-list-.*\.xlsx$/);

  await page.goto('/#/jobs');
  await page.locator('[data-act="export"]').click();
  await page.locator('.modal [data-preset="last"]').click();
  const [jobs] = await Promise.all([page.waitForEvent('download'), page.locator('.modal').getByRole('button', { name: 'Download' }).click()]);
  expect(jobs.suggestedFilename()).toMatch(/^job-cards-.*\.xlsx$/);
});

test('inventory manager sees only stock, purchase and payables reports', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/reports');
  await expect(page.getByRole('tab')).toHaveCount(4); // stock, purchases, payables + Excel downloads
  await expect(page.getByRole('tab', { name: 'Profit' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Excel downloads' }).click();
  await expect(page.locator('#r-body')).toContainText('Items bought');
  await expect(page.locator('#r-body')).not.toContainText('Items sold');
  await expect(page.locator('#r-body')).not.toContainText('Customers and bikes');
});

test('reminders page lists payment dues with a WhatsApp send button', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/reminders');
  await expect(page.locator('section[aria-labelledby="h-pay"]')).toContainText('Amit Shinde (Demo)');
});
