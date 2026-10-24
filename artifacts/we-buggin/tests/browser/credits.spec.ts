import { test, expect } from '@playwright/test';

test('phone coin store shows exact bundles and review never grants coins or charges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveText('1,234 coins');
  const packages = [
    [199, 1, '$1.99'], [699, 13, '$6.99'], [999, 29, '$9.99'],
    [1999, 79, '$19.99'], [2999, 149, '$29.99'], [4999, 299, '$49.99'],
    [9999, 699, '$99.99'], [39999, 3199, '$399.99'], [99999, 8999, '$999.99'],
    [199999, 19999, '$1999.99'], [299999, 35999, '$2999.99'],
  ] as const;
  await expect(page.getByTestId('text-buy-name')).toHaveText('Fixture');
  await expect(page.getByTestId('text-gifter-level')).toContainText('11');
  await expect(page.getByTestId('text-gifter-xp')).toHaveText('500 / 1,000 XP to next level');
  await expect(page.getByTestId('text-payment-methods')).toContainText('Credit / debit card');
  await expect(page.getByTestId('text-bonus-proposal')).toContainText('not approved');
  for (const [base, bonus, price] of packages) {
    const card = page.getByTestId(`card-bundle-${base}`);
    await expect(card).toContainText(price);
    await expect(page.getByTestId(`text-base-${base}`)).toHaveText(`${base.toLocaleString()} base`);
    await expect(page.getByTestId(`text-bonus-${base}`)).toHaveText(`+${bonus.toLocaleString()} proposed bonus`);
    await card.click();
    await expect(page.getByTestId('text-review-price')).toHaveText(`${price} USD`);
    await expect(page.getByTestId('text-review-base')).toHaveText(base.toLocaleString());
    await expect(page.getByTestId('text-review-bonus')).toHaveText(`+${bonus.toLocaleString()}`);
    await expect(page.getByTestId('text-review-credits')).toHaveText(`${(base + bonus).toLocaleString()} coins`);
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

test('recharge has rectangular controls, no overflow and no other payment methods at phone sizes', async ({ page }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=credits');
    await expect(page.getByTestId('card-bundle-299999')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByTestId('page-buy-credits').innerText()).not.toMatch(/\bVIP\b|PayPal|Apple Pay|Google Pay|crypto|bank transfer/i);
    const radii = await page.locator('.bc-card, .bc-ph, .bc-chip').evaluateAll(elements =>
      elements.map(el => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius)));
    expect(radii.every(radius => radius <= 8)).toBe(true);
    await page.getByTestId('card-bundle-299999').click();
    await expect(page.getByTestId('button-pay-disabled')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('button-change-bundle').click();
    await page.screenshot({ path: `test-results/recharge-${width}.png`, fullPage: true });
  }
});

test('unlimited and maximum level are labelled without inventing redeemable earnings', async ({ page }) => {
  await page.route('**/api/social/me', r => r.fulfill({ json: {
    profile: { username: 'fixture', displayName: 'Fixture', photoUrl: null },
    nameColorProgress: { tierIndex: 100, lifetimeCoinsPurchased: 2995500 },
    wallet: { balance: 1234, unlimited: true, earned: 9999999, received: 9999999 },
  } }));
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveText('Unlimited test coins');
  await expect(page.getByTestId('text-gifter-xp')).toHaveText('2,995,500 XP, max level');
  await expect(page.getByTestId('progress-gifter-xp')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('page-buy-credits')).not.toContainText('9,999,999');
  await expect(page.getByTestId('text-coin-terms')).toContainText('Payouts are not enabled');
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
