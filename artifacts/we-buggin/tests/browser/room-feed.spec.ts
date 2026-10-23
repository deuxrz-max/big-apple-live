import { test, expect } from '@playwright/test';

for (const width of [320, 390]) {
  test(`room feeds readable and bots inline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=room-feed');
    await expect(page.getByTestId('fixture-bot-0')).toContainText('Wolf Bot heads out on patrol.');
    for (const i of [0, 1, 2, 3]) {
      const result = await page.getByTestId(`fixture-bot-${i}`).evaluate(el => {
        const line = el.querySelector('.ur-bot-activity')!;
        const icon = line.querySelector('.bs-shield')!.getBoundingClientRect();
        const name = line.querySelector('.ch-sender')!.getBoundingClientRect();
        const action = line.lastElementChild!.getBoundingClientRect();
        return {
          first: line.firstElementChild?.classList.contains('bs-shield'),
          before: icon.x < name.x,
          inline: Math.abs(name.top - action.top) < 4,
          font: getComputedStyle(el).fontSize,
          paragraph: !!line.querySelector('p'),
        };
      });
      expect(result).toEqual({ first: true, before: true, inline: true, font: '15px', paragraph: false });
    }
    for (const level of [1, 96, 100]) {
      const shield = page.getByTestId(`badge-gifting-level-${level}`).first();
      expect((await shield.boundingBox())!.width).toBe(25);
      expect((await shield.boundingBox())!.height).toBe(27.5);
    }
    await expect(page.getByTestId('fixture-live')).toHaveCSS('font-size', '15px');
    expect((await page.getByTestId('fixture-live').locator('.gifting-shield').boundingBox())!.width).toBe(25);
    await expect(page.getByTestId('fixture-bot-4').locator('.ur-bot-tag')).toHaveText('BOT');
    await expect(page.getByTestId('fixture-bot-0').locator('.bs-shield')).toHaveCSS('width', '20px');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/room-feed-${width}.png`, fullPage: true });
  });
}
