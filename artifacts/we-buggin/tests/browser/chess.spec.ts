import { test, expect } from '@playwright/test';

const open = async (page: import('@playwright/test').Page, width: number, query = '') => {
  await page.setViewportSize({ width, height: 760 });
  await page.request.get(`/__fixture/reset${query}`);
  await page.goto('/tests/browser/chess-harness.html');
};

for (const width of [320, 390]) {
  test(`board and two player rows fit at ${width}px; tap, targets, promotion, result`, async ({ page }) => {
    await open(page, width);
    const board = page.getByTestId('chess-board');
    await expect(board).toBeVisible();
    await expect(page.getByTestId('chess-player-w')).toContainText('Mireille Ashdown');
    await expect(page.getByTestId('chess-player-b')).toContainText('Tobias Venn');
    const [top, mid, bottom] = await Promise.all([
      page.getByTestId('chess-player-w').boundingBox(), page.locator('.chess-frame').boundingBox(), page.getByTestId('chess-player-b').boundingBox(),
    ]);
    expect(top!.y + top!.height).toBeLessThanOrEqual(mid!.y);
    expect(mid!.y + mid!.height).toBeLessThanOrEqual(bottom!.y);
    expect(Math.abs(top!.y + top!.height - mid!.y)).toBeLessThan(1);
    expect(Math.abs(mid!.y + mid!.height - bottom!.y)).toBeLessThan(1);
    expect(top!.y).toBe(0);
    expect(top!.width).toBe(width);
    expect(bottom!.width).toBe(width);
    expect(top!.height).toBeGreaterThan(150);
    expect(mid!.width).toBeGreaterThan(width - 60);
    expect(Math.abs(mid!.width - mid!.height)).toBeLessThan(2);
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(760);
    for (const box of [top, mid, bottom]) expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(width);
    // White pieces at the top: first cell is h1.
    await expect(board.locator('[role=gridcell]').first()).toHaveAttribute('data-square', 'h1');
    await expect(page.getByTestId('button-chess-mic')).toBeVisible();
    await expect(page.getByTestId('button-chess-leave')).toBeVisible();
    const photo = page.getByTestId('chess-player-w').locator('.chess-photo-slide img').first();
    await expect(photo).toBeVisible();
    const picture = await photo.evaluate(el => {
      const image = el as HTMLImageElement;
      return { fit: getComputedStyle(image).objectFit, radius: getComputedStyle(image.parentElement!).borderRadius,
        width: image.width, height: image.height, loaded: image.naturalHeight > image.naturalWidth };
    });
    expect(picture.fit).toBe('contain'); expect(picture.radius).toBe('0px'); expect(picture.loaded).toBe(true);
    expect(picture.width).toBeGreaterThan(width - 6);
    expect(picture.height).toBeGreaterThan(150);
    await expect(page.getByTestId('badge-gifting-level-96')).toBeVisible();
    await expect(page.getByTestId('badge-gifting-level-31')).toBeVisible();
    const tiles = await board.locator('[role=gridcell]').evaluateAll(els => els.map(el => {
      const box = el.getBoundingClientRect();
      return { radius: getComputedStyle(el).borderRadius, square: Math.abs(box.width - box.height) < 1 };
    }));
    expect(tiles.every(t => t.radius === '0px' && t.square)).toBe(true);

    // Non-movable square selects nothing.
    await board.locator('[data-square=a8]').click();
    await expect(board.locator('[aria-selected=true]')).toHaveCount(0);
    // King: square gold outline and square move markers, with global finish loaded.
    await board.locator('[data-square=e1]').click();
    const king = board.locator('[data-square=e1]');
    await expect(king).toHaveAttribute('aria-selected', 'true');
    const ring = await king.evaluate(el => { const s = getComputedStyle(el, '::before'); return { r: s.borderRadius, w: s.borderTopWidth }; });
    expect(ring.r).toBe('0px'); expect(ring.w).toBe('3px');
    await expect(board.locator('.is-target')).toHaveCount(5);
    await page.screenshot({ path: `test-results/chess-${width}-selected.png` });

    // Pawn promotion sheet.
    await board.locator('[data-square=e7]').click();
    await board.locator('[data-square=e8]').click();
    const sheet = page.getByTestId('chess-promotion');
    await expect(sheet.getByRole('button')).toHaveCount(4);
    const posted = page.waitForRequest(r => r.url().endsWith('/actions') && r.method() === 'POST');
    await sheet.getByRole('button', { name: 'Promote to n' }).click();
    expect((await posted).postDataJSON()).toEqual({ action: 'move', from: 'e7', to: 'e8', promotion: 'n', revision: 3 });
    await expect(page.getByTestId('chess-result-text')).toHaveText('White wins by checkmate.');
    await expect(page.getByTestId('chess-result')).toContainText('You won');
    await page.screenshot({ path: `test-results/chess-${width}-result.png` });
    await page.getByTestId('button-chess-rematch').click();
    await expect(page.getByTestId('button-chess-rematch')).toContainText('Waiting for opponent');
  });
}

test('empty opponent fills bottom section; shared frames are rectangular', async ({ page }) => {
  await open(page, 320, '?waiting=1');
  const empty = page.getByTestId('chess-player-b');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Waiting for opponent · Share the link');
  await expect(empty.getByTestId('button-chess-invite')).toBeVisible();
  const box = (await empty.boundingBox())!;
  expect(box.width).toBe(320); expect(box.y + box.height).toBe(760);
  expect(await empty.evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
  // Real shared classes and inline avatar radius: exercise the global cascade, not just Chess CSS.
  const frames = await page.evaluate(() => {
    const classes = ['ur-slot', 'ur-person-avatar', 'st-live-avatar', 'ib-avatar', 'pf-chip', 'gift-panel-avatar',
      'st-home-go-live-button', 'app-bottom-link', 'pf-dialog', 'sc-compose', 'rounded-full', 'dw-icon-btn'];
    return classes.map(name => {
      const el = document.createElement('button');
      el.className = name; el.style.cssText = 'width:44px;height:44px;border-radius:50%';
      document.body.append(el);
      const radius = getComputedStyle(el).borderRadius;
      el.remove(); return { name, radius };
    });
  });
  expect(frames.every(f => f.radius === (f.name === 'dw-icon-btn' ? '50%' : '0px'))).toBe(true);
  await page.screenshot({ path: 'test-results/chess-waiting-square.png' });
});

test('touch swipes either photo independently and never submit a chess move', async ({ page, context }) => {
  await open(page, 390);
  const session = await context.newCDPSession(page);
  const white = page.getByTestId('chess-player-w');
  const black = page.getByTestId('chess-player-b');
  for (const section of [white, black]) {
    const box = (await section.boundingBox())!;
    const y = box.y + box.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 335, y }] });
    for (let x = 315; x >= 55; x -= 20) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(18);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(section.getByRole('tab', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-selected', 'true');
  }
  expect(await (await page.request.get('/__fixture/actions')).json()).toHaveLength(0);
  // Normal once-a-second room polling must not reset either person's local photo choice.
  await page.waitForTimeout(1200);
  await expect(white.getByRole('tab', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(black.getByRole('tab', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-selected', 'true');
  await white.getByRole('tab', { name: 'Photo 1 of 2' }).click();
  await expect(white.getByRole('tab', { name: 'Photo 1 of 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(black.getByRole('tab', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-selected', 'true');
  const board = page.getByTestId('chess-board');
  await board.locator('[data-square=e1]').click();
  await board.locator('[data-square=e2]').click();
  await expect(board.locator('[data-square=e2] svg')).toBeVisible();
  expect(await (await page.request.get('/__fixture/actions')).json()).toHaveLength(1);
  await page.screenshot({ path: 'test-results/chess-photo-carousels.png' });
});

test('short phone and Black player retain full-width board and controls on top photo', async ({ page }) => {
  await open(page, 360, '?black=1');
  await page.setViewportSize({ width: 360, height: 640 });
  const top = page.getByTestId('chess-player-w');
  const bottom = page.getByTestId('chess-player-b');
  await expect(top.getByTestId('button-chess-mic')).toBeVisible();
  await expect(top.getByTestId('button-chess-leave')).toBeVisible();
  await expect(bottom).toContainText('You');
  const frame = (await page.locator('.chess-frame').boundingBox())!;
  expect(frame.width).toBe(360);
  expect((await bottom.boundingBox())!.y + (await bottom.boundingBox())!.height).toBe(640);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(640);
  expect(await top.evaluate(el => getComputedStyle(el, '::after').boxShadow)).not.toBe('none');
});

test('double tap on a target posts one move', async ({ page }) => {
  await open(page, 390);
  const board = page.getByTestId('chess-board');
  await board.locator('[data-square=e1]').click();
  await board.locator('[data-square=e2]').dblclick();
  await expect(board.locator('[data-square=e2] svg')).toBeVisible();
  const actions = await (await page.request.get('/__fixture/actions')).json();
  expect(actions).toHaveLength(1);
});

test('join retry reruns join and query errors show a connection note', async ({ page }) => {
  await open(page, 390, '?joinFail=1');
  await expect(page.getByTestId('button-chess-retry')).toBeVisible();
  await page.getByTestId('button-chess-retry').click();
  await expect(page.getByTestId('chess-board')).toBeVisible();
  await page.request.get('/__fixture/get-fails?on=1');
  await expect(page.getByTestId('chess-connection')).toBeVisible({ timeout: 5000 });
  await page.request.get('/__fixture/get-fails?on=0');
  await expect(page.getByTestId('chess-connection')).toHaveCount(0, { timeout: 5000 });
});
