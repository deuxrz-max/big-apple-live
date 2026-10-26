import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, context: string, multi = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/social/me', route => route.fulfill({ json: {
    profile: { username: 'fixture', displayName: 'Fixture', photoUrl: null },
    wallet: { balance: 5000 }, inventory: [], products: [], giftQuantities: {},
    gifts: [
      { id: 'heart', name: 'Heart', cost: 10 },
      { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
      { id: 'studio-fixture', name: 'Custom fixture', cost: 20 },
    ],
  } }));
  await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: [] } }));
  await page.goto(`/tests/browser/harness.html?view=gift-send&context=${context}${multi ? '&multi=1' : ''}`);
  await page.getByRole('button', { name: 'Send a gift', exact: true }).click();
}

for (const context of ['room', 'live']) {
  for (const giftId of ['heart', 'spirit-pup', 'studio-fixture']) {
    test(`${context}: ${giftId} closes only after success and can reopen`, async ({ page }) => {
      let sent: Record<string, unknown> | undefined;
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/api/social/gifts', async route => {
        sent = route.request().postDataJSON();
        if (context === 'room') expect(route.request().headers()['x-room-session']).toBe('fixture-session');
        await wait;
        await route.fulfill({ json: { balance: 4900, sent: 100 } });
      });
      await setup(page, context);
      await (giftId === 'heart'
        ? page.getByRole('button', { name: 'Select featured gift Heart', exact: true })
        : page.getByTestId(`gift-catalog-${giftId}`)).click();
      await page.getByTestId('gift-bag-send').click();
      await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
      await expect(page.getByTestId('gift-bag')).toBeVisible();
      release();
      await expect(page.getByTestId('gift-bag')).toHaveCount(0);
      expect(sent).toMatchObject({
        giftId, recipient: 'test-recipient', quantity: 1,
        ...(context === 'live' ? { streamId: 'fixture-stream' } : { roomId: 'fixture-room' }),
      });
      await page.getByRole('button', { name: 'Send a gift', exact: true }).click();
      await expect(page.getByTestId('gift-bag')).toBeVisible();
    });
  }

  test(`${context}: failed send keeps panel and error visible`, async ({ page }) => {
    await page.route('**/api/social/gifts', route => route.fulfill({
      status: 400, json: { message: 'Not enough coins' },
    }));
    await setup(page, context);
    await page.getByRole('button', { name: 'Select featured gift Heart', exact: true }).click();
    await page.getByTestId('gift-bag-send').click();
    await expect(page.getByTestId('gift-bag')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Not enough coins');
    await expect(page.getByTestId('gift-bag-send')).toBeEnabled();
  });
}

test('partial batch stays open; retry skips confirmed recipient and closes after remaining success', async ({ page }) => {
  const requests: Array<{ recipient: string; idempotencyKey: string; quantity: number }> = [];
  let fail = true;
  await page.route('**/api/social/gifts', route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill(body.recipient === 'second-recipient' && fail
      ? { status: 400, json: { message: 'Not enough coins' } }
      : { json: { balance: 4800, sent: 200 } });
  });
  await setup(page, 'room', true);
  await page.getByRole('button', { name: 'Select featured gift Heart', exact: true }).click();
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByRole('alert')).toContainText('1 of 2 recipients sent');
  await expect(page.getByTestId('gift-bag')).toBeVisible();
  fail = false;
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  expect(requests.map(r => r.recipient)).toEqual(['test-recipient', 'second-recipient', 'second-recipient']);
  expect(requests[1]!.idempotencyKey).toBe(requests[2]!.idempotencyKey);
});
