import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

let jobUrl = '';

test('front desk opens a job card from a phone lookup and gets the estimate approved on a call', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/jobs/new');
  await page.locator('#lookup').fill('9000000003');
  await page.getByRole('button', { name: /MH09GH3456/ }).click();
  await page.locator('[name=odometer]').fill('64100');
  await page.locator('[data-chip="general_service"]').click();
  await page.locator('[name=mechanic_id]').selectOption({ label: 'Ramesh (Mechanic)' });
  await page.getByRole('button', { name: 'Open job card' }).click();
  await expect(page.locator('.toast')).toContainText('Job card JC-');
  await expect(page.locator('h1')).toContainText('MH09GH3456');
  await expect(page.locator('h1')).toContainText('Pending');
  jobUrl = page.url();

  // Next service due: the usual gap from Settings until the front desk changes it.
  await expect(page.locator('#next-service')).toContainText('67100 km, whichever comes first');
  await page.locator('[data-act="next-service"]').click();
  await page.locator('.drawer [name=next_service_km]').fill('66000');
  await page.locator('.drawer').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast', { hasText: 'Next service saved' })).toBeVisible();
  await expect(page.locator('#next-service')).toContainText('66000 km, whichever comes first');

  // Estimate: labour from the rate list + one part from the catalogue
  await page.getByRole('button', { name: 'Prepare estimate' }).click();
  const d = page.locator('.drawer');
  await d.locator('#est-labour').selectOption({ index: 1 });
  await d.locator('#est-part').fill('BS-SPL');
  await expect(d.locator('.combo-item').first()).toBeVisible();
  await d.locator('#est-part').press('Enter');
  await expect(d.locator('[data-line]')).toHaveCount(2);
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('section[aria-labelledby="h-est"]')).toContainText('EST-');

  await page.getByRole('button', { name: 'Approved on call' }).click();
  await page.locator('#prompt-in').fill('Customer agreed on the phone');
  await page.locator('.modal').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('h1')).toContainText('Approved');
});

test('mechanic starts work and requests a part in Marathi', async ({ page }) => {
  await login(page, 'ramesh');
  await page.goto('/#/jobs');
  await page.getByText('MH09GH3456').first().click();
  await page.getByRole('button', { name: 'काम सुरू करा' }).click();
  await expect(page.locator('h1')).toContainText('काम चालू');
  await page.getByRole('button', { name: 'पार्ट्स मागा' }).click();
  await page.locator('#rq-part').fill('SP-CPR');
  await expect(page.locator('.combo-item').first()).toBeVisible();
  await page.locator('#rq-part').press('Enter');
  await expect(page.locator('#rq-lines [data-line]')).toHaveCount(1);
  await page.locator('.drawer').getByRole('button', { name: 'मागणी पाठवा' }).click();
  await expect(page.locator('.toast')).toContainText('मागणी पाठवली');
  await expect(page.locator('section[aria-labelledby="h-parts"]')).toContainText('मागितले');
});

test('inventory manager issues the part from the queue; it lands on the job', async ({ page }) => {
  await login(page, 'stock');
  await page.goto('/#/requests');
  const card = page.locator('section.card', { hasText: 'MH09GH3456' });
  await expect(card).toContainText('Spark plug');
  await card.getByRole('button', { name: /^Issue/ }).first().click();
  await expect(page.locator('.toast')).toContainText('Issued');
  await page.goto(jobUrl.replace(/^.*#/, '/#'));
  await expect(page.locator('section[aria-labelledby="h-parts"]')).toContainText('SP-CPR7EA9');
});

test('job board shows the bike in the right column', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/#/jobs?view=board');
  const col = page.locator('.kanban-col', { hasText: 'In progress' });
  await expect(col).toContainText('MH09GH3456');
  // Bikes in the shop in two parts: work still going on, and work done.
  await page.locator('[data-stage="processing"]').click();
  await expect(page.locator('.kanban-col', { hasText: 'In progress' })).toContainText('MH09GH3456');
  await expect(page.locator('.kanban-col', { hasText: 'Ready' })).toHaveCount(0);
  await page.locator('[data-stage="completed"]').click();
  await expect(page.locator('#jobs-body')).not.toContainText('MH09GH3456');
  await expect(page).toHaveURL(/stage=completed/);
});

test('front desk bills the job, takes payment in full and delivers the bike', async ({ page }) => {
  await login(page, 'admin');
  await page.goto(jobUrl.replace(/^.*#/, '/#'));
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await expect(page.locator('h1')).toContainText('Ready');
  await page.getByRole('button', { name: 'Create bill' }).click();
  await expect(page.locator('h1')).toContainText('Draft');
  await page.getByRole('button', { name: 'Paid in full' }).click();
  await page.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(page.locator('.toast', { hasText: /Bill INV\/\d\d-\d\d\/\d{5} saved/ })).toBeVisible();
  await expect(page.locator('h1')).toContainText('Paid');
  await page.getByRole('button', { name: 'Deliver bike' }).click();
  await expect(page.locator('.toast', { hasText: 'Bike delivered' })).toBeVisible();
});
