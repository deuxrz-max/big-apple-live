import { test, expect } from '@playwright/test';

test('phone gift bag has recipient, honest empty state and no sending', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.method()); });
  await page.goto('/tests/browser/harness.html?view=gifts');
  await page.getByTestId('button-open-gift-bag').click();
  await expect(page.getByTestId('gift-bag-title')).toHaveText('Gift bag for Test Recipient');
  await expect(page.getByTestId('gift-bag-title')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByTestId('gift-bag-empty')).toBeVisible();
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await expect(page.getByText('Gift sending is not yet available.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  await expect(page.getByTestId('button-open-gift-bag')).toBeFocused();
  expect(writes).toEqual([]);
});

test('real component reads saved inventory, selection cannot transfer or buy', async ({ page }) => {
  await page.route('**/api/social/me', r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      wallet: { balance: 1234 }, inventory: ['rose', 'badge', 'unknown'],
      products: [{ id: 'badge', name: 'Badge', description: 'Cosmetic', cost: 20 }],
      gifts: [{ id: 'rose', name: 'Rose', cost: 10 }, { id: 'unowned', name: 'Unowned', cost: 50 }],
    }),
  }));
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.method()); });
  await page.goto('/tests/browser/harness.html?view=gifts');
  await page.getByTestId('button-open-gift-bag').click();
  await page.getByTestId('gift-item-rose').click();
  await expect(page.getByTestId('gift-bag-selection')).toContainText('Rose for Test Recipient');
  await expect(page.getByTestId('gift-item-unowned')).toHaveCount(0);
  await expect(page.getByTestId('gift-item-badge')).toHaveCount(0);
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await expect(page.getByTestId('gift-bag')).not.toContainText('10 credits');
  expect(writes).toEqual([]);
});

test('room name menu connects Gift, Message and supported public-message Report', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/account/rooms/*/messages**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'friend-message', roomId: 'promo-regression-room', authorId: 'friend-id',
      username: 'friend', kind: 'text', text: 'Hello from a fixture member.', createdAt: new Date().toISOString() }]),
  }));
  await page.goto('/tests/browser/harness.html');
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  for (const action of ['Gift', 'Message', 'Report', 'Block'])
    await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Gift', exact: true }).click();
  await expect(page.getByTestId('gift-bag-title')).toHaveText('Gift bag for friend');
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await page.getByTestId('gift-bag-close').click();
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
  await expect(page.getByText('Report friend', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/messages\/friend$/);
});
