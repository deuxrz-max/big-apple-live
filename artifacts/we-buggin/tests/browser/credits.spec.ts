import { test, expect } from '@playwright/test';

test('phone store shows exact bundles and review never grants credits or charges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveText('1,234');
  for (const [credits, price] of [[500, '$4.99'], [1000, '$8.99'], [2500, '$17.99']] as const) {
    const card = page.getByTestId(`card-bundle-${credits}`);
    await expect(card).toContainText(price);
    await card.click();
    await expect(page.getByTestId('text-review-price')).toHaveText(`${price} USD`);
    await expect(page.getByTestId('text-review-credits')).toHaveText(credits.toLocaleString());
    await expect(page.getByTestId('text-checkout-unavailable')).toContainText('Checkout unavailable');
    await expect(page.getByTestId('button-pay-disabled')).toBeDisabled();
    await expect(page.getByTestId('text-review-balance')).toHaveText('1,234 credits');
    await page.getByTestId('button-change-bundle').click();
  }
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('text-credits-balance')).toHaveText('1,234');
});

test('wallet read errors show retry, not an invented balance', async ({ page }) => {
  await page.route('**/api/social/me', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Wallet unavailable"}' }));
  await page.goto('/tests/browser/harness.html?view=credits');
  await expect(page.getByTestId('text-credits-balance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
});
