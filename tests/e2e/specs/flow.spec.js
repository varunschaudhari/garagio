import { test, expect } from '@playwright/test';
import { login, DEMO } from './helpers.js';

test('owner approves a new job at the counter; the bill can be made straight away', async ({ page, request }) => {
  const auth = await (await request.post('/api/auth/login', { data: { username: 'admin', password: DEMO } })).json();
  const headers = { Authorization: `Bearer ${auth.token}`, 'X-Auth-Token': auth.token };
  const job = (await (await request.post('/api/jobs', {
    headers,
    data: { customer: { name: 'Counter Approve', phone: '9700011122' }, vehicle: { reg_no: 'MH19CA1122' }, complaint: 'Service' },
  })).json()).item;

  await login(page, 'admin');
  await page.goto(`/#/jobs/${job.id}`);
  await expect(page.getByRole('button', { name: 'Create bill' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve job' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Approve job' }).click();
  await expect(page.locator('.toast')).toContainText('Job approved');
  await expect(page.locator('h1')).toContainText('Approved');
  await expect(page.getByRole('button', { name: 'Approve job' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create bill' })).toBeVisible();
});
