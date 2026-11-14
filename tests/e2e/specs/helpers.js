import { expect } from '@playwright/test';

export const DEMO = 'garage123';

/** Log in through the UI (global setup clears the first-login password change for all but "desk"). */
export async function login(page, username, lang = 'en') {
  await page.goto('/');
  await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('gm.lang', l); }, lang);
  await page.goto('/#/');
  await page.locator('#lg-user').fill(username);
  await page.locator('#lg-pass').fill(DEMO);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('.app')).toBeVisible();
}
