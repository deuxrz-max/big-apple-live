import { test, expect } from "@playwright/test";

for (const width of [320, 390]) {
  test(`pink card details escape the tile frame at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    const card = await request.get("http://127.0.0.1:80/api/rewards/pink-card/media/card");
    expect(card.ok()).toBeTruthy();
    const cardBytes = await card.body();
    await page.route("**/api/rewards/pink-card/media/card", route => route.fulfill({ contentType: "image/png", body: cardBytes }));
    await page.route("**/api/rewards/pink-card", route => route.fulfill({ json: { cycle: "2026-10-26", serverTime: new Date().toISOString(), winner: null } }));
    await page.route("**/api/social/pink-card/entry", route => route.fulfill({ json: { entered: true, optedOut: false } }));
    await page.goto("/tests/browser/harness.html?view=room-channels");
    await expect(page.getByTestId("tile-pink-card")).toBeVisible();
    await page.getByTestId("button-pink-card-details").click();
    const sheet = page.getByTestId("sheet-pink-card");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Pink Card draw", { exact: true })).toBeVisible();
    await expect(sheet.getByText(/Entries reset at 3 AM Eastern/)).toBeVisible();
    await expect(page.getByTestId("status-pink-card-entry")).toHaveText("Entered this draw");
    const frame = await sheet.boundingBox();
    expect(frame!.x).toBeGreaterThanOrEqual(0);
    expect(frame!.x + frame!.width).toBeLessThanOrEqual(width);
    expect(frame!.y).toBeGreaterThanOrEqual(0);
    expect(frame!.y + frame!.height).toBeLessThan(844 - 80);
    expect(await sheet.evaluate(el => el.parentElement === document.body)).toBe(true);
    await page.getByTestId("button-pink-card-close").click();
    await expect(sheet).toHaveCount(0);
  });
}
