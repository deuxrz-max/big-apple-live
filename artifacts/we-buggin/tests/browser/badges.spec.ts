import { test, expect } from '@playwright/test';
import { PRODUCTS } from '../../../api-server/src/lib/social/catalog';

test('Marathon listing explains earning, shows placeholder, expiry and insufficient-credit link', async ({ page }) => {
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
  await expect(badge.getByText('Artwork pending', { exact: true })).toBeVisible();
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
