import { test, expect } from '@playwright/test';

test('phone coin store shows exact bundles and review never grants coins or charges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveText('1,234 coins');
  for (const [credits, price] of [[500, '$4.99'], [1000, '$8.99'], [2500, '$17.99']] as const) {
    const card = page.getByTestId(`card-bundle-${credits}`);
    await expect(card).toContainText(price);
    await card.click();
    await expect(page.getByTestId('text-review-price')).toHaveText(`${price} USD`);
    await expect(page.getByTestId('text-review-credits')).toHaveText(`${credits.toLocaleString()} coins`);
    await expect(page.getByTestId('text-checkout-unavailable')).toContainText('Checkout unavailable');
    await expect(page.getByTestId('button-pay-disabled')).toBeDisabled();
    await expect(page.getByTestId('text-review-balance')).toHaveText('1,234 coins');
    await page.getByTestId('button-change-bundle').click();
  }
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('text-credits-balance')).toHaveText('1,234 coins');
});

test('wallet read errors show retry, not an invented balance', async ({ page }) => {
  await page.route('**/api/social/me', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Wallet unavailable"}' }));
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
});

test('phone Store shows the wallet balance as coins and keeps top-ups coming soon', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html?view=store');
  await expect(page.getByText('COINS', { exact: true })).toBeVisible();
  await expect(page.getByText('1,234', { exact: true })).toBeVisible();
  await expect(page.getByTestId('text-store-balance').locator('svg').first()).toBeVisible();
  const addCoins = page.getByTestId('button-store-add-credits');
  await expect(addCoins).toHaveAttribute('aria-label', 'Add coins, coming soon');
  await addCoins.click();
  await expect(page.getByTestId('status-store-coming-soon')).toContainText('Buying coins is coming soon.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Store explains insufficient coin balance and offers the coming-soon top-up', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/social/me', route => route.fulfill({ json: {
    profile: { badges: [] },
    wallet: { balance: 10, unlimited: false, earned: 0, received: 0, sent: 0, dailyReward: 0, canClaimDaily: false },
    inventory: [], products: [],
    gifts: [{ id: 'heart', name: 'Heart', cost: 50, availableForPurchase: true }],
    giftQuantities: {},
  } }));
  await page.goto('/tests/browser/harness.html?view=store');
  await page.getByTestId('tab-store-gifts').click();
  await page.getByTestId('button-open-gifts-heart').click();
  await expect(page.getByTestId('dialog-store-sheet')).toContainText('50 coins');
  await expect(page.getByTestId('dialog-store-sheet')).toContainText('Not enough coins.');
  const addCoins = page.getByTestId('dialog-store-sheet').getByRole('button', { name: /Add coins/i });
  await expect(addCoins).toBeVisible();
  await addCoins.click();
  await expect(page.getByTestId('status-store-coming-soon')).toContainText('Buying coins is coming soon.');
});
