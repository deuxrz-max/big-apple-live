import { test, expect } from '@playwright/test';
import { PRODUCTS } from '../../../api-server/src/lib/social/catalog';

test('Badge artwork loads and Marathon explains earning, expiry and insufficient-credit link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let balance = 199;
  await page.route('**/api/social/me', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    profile: { username: 'fixture' }, wallet: { balance, earned: 0, received: 0, sent: 0, dailyReward: 25, canClaimDaily: false },
    inventory: ['marathon-master'], products: PRODUCTS, gifts: [], countries: [], loginStreak: 7,
    badgeExpirations: { 'marathon-master': new Date(Date.now() + 2 * 86400000).toISOString() },
  }) }));
  await page.route('**/api/social/wallet/transactions', r => r.fulfill({ contentType: 'application/json', body: '{"transactions":[]}' }));
  await page.goto('/tests/browser/harness.html?view=badges');
  const badge = page.getByTestId('card-product-marathon-master');
  await expect(badge.getByText('Marathon Master', { exact: true })).toBeVisible();
  for (const name of ['Peak Presenter', 'Marathon Master', 'Night Owl']) {
    const art = page.getByRole('img', { name: `${name} badge`, exact: true });
    await expect(art).toBeVisible();
    await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(512);
  }
  await expect(page.getByText('Artwork pending', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/badge-store-phone.png', fullPage: true });
  await expect(badge.getByText('How to Earn', { exact: true })).toBeVisible();
  await expect(badge).toContainText('Log in 7 days in a row to earn it free for 1 week, or buy it for 200 credits for 3 days.');
  await expect(page.getByTestId('marathon-time')).toContainText('remaining');
  await expect(page.getByTestId('button-buy-marathon-master')).toBeDisabled();
  await expect(badge.getByRole('link', { name: 'Buy credits', exact: true })).toHaveAttribute('href', '/community/credits');
  await expect(page.getByTestId('card-product-beam-champion')).toHaveCount(0);
  await expect(page.getByTestId('card-product-good-neighbor')).toContainText('Peak Presenter');
  balance = 200;
  await page.reload();
  await expect(page.getByTestId('button-buy-marathon-master')).toHaveText('Buy for 200 credits');
  await expect(page.getByTestId('button-buy-marathon-master')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Night Owl updates one listing with timed rules, renewal and legacy permanence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let balance = 999;
  let permanent = false;
  await page.route('**/api/social/me', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    profile: { username: 'fixture' }, wallet: { balance, earned: 0, received: 0, sent: 0, dailyReward: 25, canClaimDaily: false },
    inventory: ['night-owl'], products: PRODUCTS, gifts: [], countries: [], loginStreak: 30,
    badgeExpirations: permanent ? {} : { 'night-owl': new Date(Date.now() + 30 * 86400000).toISOString() },
  }) }));
  await page.route('**/api/social/wallet/transactions', r => r.fulfill({ contentType: 'application/json', body: '{"transactions":[]}' }));
  await page.goto('/tests/browser/harness.html?view=badges');
  const badge = page.getByTestId('card-product-night-owl');
  await expect(badge).toHaveCount(1);
  await expect(badge.getByText('Night Owl', { exact: true })).toBeVisible();
  await expect(badge.getByRole('img', { name: 'Night Owl badge', exact: true })).toBeVisible();
  await expect(badge).toContainText('Log in 30 days in a row to earn it free for 30 days, or buy it for 1000 credits for 3 days.');
  await expect(page.getByTestId('night-owl-time')).toContainText('remaining');
  await expect(page.getByTestId('button-buy-night-owl')).toBeDisabled();
  await expect(badge.getByRole('link', { name: 'Buy credits', exact: true })).toHaveAttribute('href', '/community/credits');
  balance = 1000;
  await page.reload();
  await expect(page.getByTestId('button-buy-night-owl')).toHaveText('Buy for 1000 credits');
  await expect(page.getByTestId('button-buy-night-owl')).toBeEnabled();
  await expect(badge).toContainText('Buying adds 3 days to any time remaining');
  permanent = true;
  await page.reload();
  await expect(page.getByTestId('button-buy-night-owl')).toHaveText('Owned permanently');
  await expect(page.getByTestId('button-buy-night-owl')).toBeDisabled();
  await expect(page.getByTestId('night-owl-time')).toHaveCount(0);
  await expect(badge).toContainText('No renewal needed.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
