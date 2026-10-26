import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, context: string, multi = false, expanded = false, bag = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/social/me', route => route.fulfill({ json: {
    profile: { username: 'fixture', displayName: 'Fixture', photoUrl: null },
    wallet: { balance: 5000 }, inventory: bag ? ['heart'] : [], products: [], giftQuantities: bag ? { heart: 2 } : {},
    giftBagLots: bag ? [
      { giftId: 'heart', quantity: 1, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
      { giftId: 'heart', quantity: 1, expiresAt: null },
    ] : [],
    gifts: [
      { id: 'heart', name: 'Heart', cost: 10 },
      { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
      { id: 'studio-fixture', name: 'Custom fixture', cost: 20 },
      ...(expanded ? Array.from({ length: 13 }, (_, i) => ({
        id: `custom-${i}`, name: `Custom ${i + 1}`, cost: i + 1,
      })) : []),
    ],
  } }));
  await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: [] } }));
  await page.goto(`/tests/browser/harness.html?view=gift-send&context=${context}${multi ? '&multi=1' : ''}`);
  await page.getByRole('button', { name: 'Send a gift', exact: true }).click();
}

test('My Bag lists held quantities and expiry, and sends a stored gift without a second charge', async ({ page }) => {
  let sent: Record<string, unknown> | undefined;
  await page.clock.install({ time: new Date() });
  await page.route('**/api/social/gifts', route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { balance: 5000, sent: 10 } });
  });
  await setup(page, 'room', false, false, true);
  const panel = page.getByTestId('gift-bag');
  const categoryLabels = await panel.locator('.gift-panel-category').allTextContents();
  expect(categoryLabels[0]).toContain('My Bag');
  await panel.getByRole('button', { name: /My Bag/ }).click();
  const stored = panel.getByTestId('gift-bag-item-heart');
  await expect(stored).toContainText('In bag · 2');
  await expect(stored).toContainText('Expires in 5d');
  await expect(stored).toContainText('No expiry');
  await stored.click();
  await expect(panel.locator('.gift-panel-total')).toContainText('0 coins to charge');
  await page.clock.fastForward(5 * 24 * 60 * 60 * 1000 + 60_000);
  await expect(stored).toContainText('In bag · 1');
  await expect(stored).toContainText('No expiry');
  await panel.getByTestId('gift-bag-send').click();
  await expect(panel).toHaveCount(0);
  expect(sent).toMatchObject({ giftId: 'heart', quantity: 1, useGiftBagOnly: true });
});

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
      await page.getByTestId(`gift-catalog-${giftId}`).click();
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
    await page.getByTestId('gift-catalog-heart').click();
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
  await page.getByTestId('gift-catalog-heart').click();
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByRole('alert')).toContainText('1 of 2 recipients sent');
  await expect(page.getByTestId('gift-bag')).toBeVisible();
  fail = false;
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  expect(requests.map(r => r.recipient)).toEqual(['test-recipient', 'second-recipient', 'second-recipient']);
  expect(requests[1]!.idempotencyKey).toBe(requests[2]!.idempotencyKey);
});

for (const width of [320, 390, 430]) {
  test(`gift panel reference layout at ${width}px: four columns, vertical scroll, quantities and recharge`, async ({ page }) => {
    await setup(page, 'room', false, true);
    await page.setViewportSize({ width, height: 844 });
    const panel = page.getByTestId('gift-bag');
    await expect(panel).toBeVisible();
    const grid = panel.locator('.gift-panel-grid').first();
    await expect(grid.locator('[data-testid^="gift-catalog-"]')).toHaveCount(16);
    const boxes = await grid.locator('[data-testid^="gift-catalog-"]').evaluateAll(els =>
      els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
    expect(new Set(boxes.slice(0, 4).map(b => Math.round(b.y))).size).toBe(1);
    expect(boxes[4]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes.every(b => b.x >= 0 && b.right <= width)).toBe(true);
    const scrolling = await panel.locator('.gift-panel-scroll').evaluate(el => ({
      vertical: el.scrollHeight > el.clientHeight, horizontal: el.scrollWidth > el.clientWidth,
    }));
    expect(scrolling).toEqual({ vertical: true, horizontal: false });
    await page.getByTestId('gift-catalog-heart').click();
    for (const q of [1, 10, 66, 99]) {
      const choice = panel.getByRole('button', { name: `x${q}`, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('.gift-panel-total')).toContainText(`${q * 10}`);
    }
    const rect = await panel.boundingBox();
    expect(rect!.height).toBeLessThan(844 * .64);
    await expect(panel.getByRole('link', { name: /buy coins/i })).toHaveAttribute('href', /community\/coins/);
    if (width === 390) {
      await page.screenshot({ path: '../../generated-artifacts/gift-panel-reference-390.png' });
    }
  });
}

test('quantity sends preserve multiplied cost and selected recipient', async ({ page }) => {
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/social/gifts', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { balance: 4010, sent: 990 } });
  });
  await setup(page, 'room');
  await page.getByTestId('gift-catalog-heart').click();
  await page.getByRole('button', { name: 'x99', exact: true }).click();
  await expect(page.locator('.gift-panel-total')).toContainText('990');
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  expect(body).toMatchObject({ giftId: 'heart', quantity: 99, recipient: 'test-recipient' });
});
