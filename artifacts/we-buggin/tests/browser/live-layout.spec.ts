import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });

for (const [width, height] of [[320, 568], [390, 844], [430, 932]]) {
  test(`broadcaster composer, control row and feed do not overlap at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/tests/browser/harness.html?view=live-layout');
    const input = page.getByPlaceholder('Say something…');
    await expect(input).toBeVisible();
    await expect(page.getByText('A readable viewer comment')).toBeVisible();
    await expect(page.locator('.st-live-chat-line').first()).toHaveCSS('background-color', 'rgba(8, 7, 5, 0.55)');
    await expect(page.getByTestId('live-feed-join')).toContainText(/Fixture viewer\s*joined/);
    await expect(page.getByText(/sent Heart/)).toBeVisible();
    const form = await page.locator('.st-live-chat-form').boundingBox();
    const dock = await page.getByTestId('dock-live-controls').boundingBox();
    const log = await page.locator('.st-live-chat-log').boundingBox();
    expect(form!.width).toBeGreaterThan(width - 30);
    expect(form!.y + form!.height).toBeLessThanOrEqual(height);
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(form!.y);
    expect(log!.y + log!.height).toBeLessThanOrEqual(dock!.y);
    const buttons = page.getByTestId('dock-live-controls').locator('button');
    await expect(buttons).toHaveCount(5);
    const boxes = await buttons.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, radius: getComputedStyle(node).borderRadius };
    }));
    for (const box of boxes) {
      expect(Math.abs(box.width - box.height)).toBeLessThan(2);
      expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThan(2);
      expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThan(2);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(parseFloat(box.radius)).toBeLessThanOrEqual(7);
    }
    const creator = page.getByTestId('live-creator-profile');
    await expect(creator).toContainText('VAMPSQUAD');
    const nameFits = await creator.locator('strong').evaluate(node => node.scrollWidth <= node.clientWidth);
    expect(nameFits).toBe(true);
    // Tap the actual input and verify the unchanged send path.
    await input.tap();
    await input.fill('Comment from phone-sized preview');
    const sent = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/layout-fixture/chat'));
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ text: 'Comment from phone-sized preview' });
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('live-end-stream')).toBeVisible();
    await page.screenshot({ path: `test-results/live-layout-${width}.png` });
  });
}
