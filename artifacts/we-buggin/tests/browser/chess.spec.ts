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
    const [top, mid, bottom] = await Promise.all(['chess-player-w', 'chess-board', 'chess-player-b'].map(id => page.getByTestId(id).boundingBox()));
    expect(top!.y + top!.height).toBeLessThanOrEqual(mid!.y);
    expect(mid!.y + mid!.height).toBeLessThanOrEqual(bottom!.y);
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
    const photo = page.getByTestId('chess-player-w').getByRole('img');
    await expect(photo).toBeVisible();
    const picture = await photo.evaluate(el => {
      const image = el as HTMLImageElement;
      return { fit: getComputedStyle(image).objectFit, radius: getComputedStyle(image.parentElement!).borderRadius,
        width: image.width, height: image.height, loaded: image.naturalHeight > image.naturalWidth };
    });
    expect(picture).toEqual({ fit: 'contain', radius: '0px', width: 70, height: 70, loaded: true });
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

test('empty opponent uses a solid square frame; shared frames are rectangular', async ({ page }) => {
  await open(page, 320, '?waiting=1');
  const empty = page.locator('.chess-player-empty');
  await expect(empty).toBeVisible();
  expect(await empty.evaluate(el => {
    const s = getComputedStyle(el);
    return { width: s.width, height: s.height, radius: s.borderRadius, border: s.borderTopStyle };
  })).toEqual({ width: '72px', height: '72px', radius: '0px', border: 'solid' });
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
