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

    // Non-movable square selects nothing.
    await board.locator('[data-square=a8]').click();
    await expect(board.locator('[aria-selected=true]')).toHaveCount(0);
    // King: gold ring + dots.
    await board.locator('[data-square=e1]').click();
    const king = board.locator('[data-square=e1]');
    await expect(king).toHaveAttribute('aria-selected', 'true');
    const ring = await king.evaluate(el => { const s = getComputedStyle(el, '::before'); return { r: s.borderRadius, w: s.borderTopWidth }; });
    expect(ring.r).toBe('50%'); expect(ring.w).toBe('3px');
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
