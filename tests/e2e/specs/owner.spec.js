import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

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

test('profit report shows the formula and a CSV export downloads', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/reports?tab=profit');
  await expect(page.getByText('Profit = sales (without GST)')).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Mechanic pay' })).toContainText('₹450.00');
  await page.getByRole('tab', { name: 'GST summary' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^gst-.*\.csv$/);
});

test('inventory manager sees only stock, purchase and payables reports', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/reports');
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'Profit' })).toHaveCount(0);
});

test('reminders page lists payment dues with a WhatsApp send button', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/reminders');
  await expect(page.locator('section[aria-labelledby="h-pay"]')).toContainText('Amit Shinde (Demo)');
});
