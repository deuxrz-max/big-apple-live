import { test, expect } from '@playwright/test';

for (const width of [320, 390, 430]) {
  test(`room comment input has usable width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html');
    const input = page.getByTestId('input-message');
    await expect(input).toHaveAttribute('placeholder', 'Say something (1-280)');
    expect((await input.boundingBox())!.width).toBeGreaterThan(150);
    await input.fill('Hello from my phone');
    await expect(input).toHaveValue('Hello from my phone');
    await expect(page.getByTestId('button-send')).toBeEnabled();
  });
}

test('typed comments reach sender and second viewer once, and survive reload', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 390, height: 844 });
  await Promise.all([page.goto('/tests/browser/harness.html'), viewer.goto('/tests/browser/harness.html')]);
  await expect(page.getByTestId('input-message')).toBeVisible();
  await expect(viewer.getByTestId('input-message')).toBeVisible();
  const comment = `Phone comment ${Date.now()}`;
  const input = page.getByTestId('input-message');
  await input.fill(comment);
  await page.getByTestId('button-send').click();
  await expect(input).toHaveValue('');
  for (const client of [page, viewer]) {
    await expect(client.locator('.ch-msgs').getByText(comment, { exact: true })).toHaveCount(1);
  }
  await viewer.reload();
  await expect(viewer.locator('.ch-msgs').getByText(comment, { exact: true })).toHaveCount(1);
  const reply = `Reply ${Date.now()}`;
  await viewer.getByTestId('input-message').fill(reply);
  await viewer.getByTestId('input-message').press('Enter');
  await expect(page.locator('.ch-msgs').getByText(reply, { exact: true })).toHaveCount(1);
  await viewer.close();
});

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
