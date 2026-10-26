import { expect, test } from '@playwright/test';

const TIERS: Array<[number, string, string]> = [
  [1, 'bronze', 'Bronze'], [10, 'bronze', 'Bronze'], [11, 'silver', 'Silver'], [30, 'silver', 'Silver'],
  [31, 'gold', 'Gold'], [60, 'gold', 'Gold'], [61, 'platinum', 'Platinum'], [90, 'platinum', 'Platinum'],
  [91, 'deux-wild', 'Deux Wild'], [100, 'deux-wild', 'Deux Wild'],
];

test('numbered gifting shields precede readable usernames at mobile size', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html?view=gifting-levels');
  await expect(page.getByTestId('gifting-level-0').locator('.gifting-shield')).toHaveCount(0);
  for (const [level, key, name] of TIERS) {
    const row = page.getByTestId(`gifting-level-${level}`);
    const shield = row.getByRole('img', { name: `${name} gifting level ${level}` });
    await expect(shield).toBeVisible();
    await expect(shield).toHaveAttribute('data-gifting-tier', key);
    await expect(shield.locator('text')).toHaveText(String(level));
    const order = await row.locator('.shiny-name-label').evaluate(el => [...el.children].map(c => c.className));
    expect(order[0]).toContain('gifting-shield');
  }
  // Bronze has no name color perk; Silver+ does when no purchased color is set.
  await expect(page.getByTestId('gifting-level-10').locator('.shiny-name--gifting-perk')).toHaveCount(0);
  await expect(page.getByTestId('gifting-level-11').locator('.shiny-name--gifting-perk')).toHaveCount(1);
  // A legacy purchased color is preserved over the tier perk.
  const kept = page.getByTestId('gifting-preserves-username').locator('.shiny-name');
  await expect(kept).toHaveAttribute('data-tier', '2');
  await expect(kept).not.toHaveClass(/shiny-name--gifting-perk/);
  await page.screenshot({ path: info.outputPath('gifting-levels-mobile.png') });
});

test('Silver+ frames animate in their tier color and stay rectangular on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html?view=gifting-levels');
  for (const level of [0, 1, 10]) {
    await expect(page.getByTestId(`frame-level-${level}`)).not.toHaveAttribute('data-gifting-frame');
  }
  for (const [level, key, color] of [
    [11, 'silver', 'rgb(216, 223, 232)'],
    [31, 'gold', 'rgb(231, 188, 88)'],
    [61, 'platinum', 'rgb(217, 242, 255)'],
    [91, 'deux-wild', 'rgb(57, 255, 20)'],
  ] as const) {
    const frame = page.getByTestId(`frame-level-${level}`);
    await expect(frame).toHaveAttribute('data-gifting-frame', key);
    const style = await frame.locator('.ur-slot-media').evaluate(el => {
      const s = getComputedStyle(el, '::after');
      return { color: s.borderTopColor, animation: s.animationName, radius: s.borderRadius };
    });
    expect(style).toEqual({ color, animation: 'gifting-frame-pulse', radius: '0px' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByTestId('frame-level-11').locator('.ur-slot-media')
    .evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('none');
});

test('Gold banner remains; Platinum has no special sweep; Deux Wild keeps neon entrance', async ({ page }) => {
  for (const level of [31, 61, 91]) {
    await page.goto(`/tests/browser/harness.html?view=gifting-levels&entrance=${level}`);
    await expect(page.getByTestId('banner-gifting-entrance')).toBeVisible();
    await expect(page.locator('.gifting-entrance-sweep')).toHaveCount(0);
    await expect(page.locator('.gifting-entrance-fullscreen')).toHaveCount(level === 91 ? 1 : 0);
  }
});
