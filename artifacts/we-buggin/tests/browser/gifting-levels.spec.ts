import { test, expect } from '@playwright/test';

test('gifting logos precede unchanged readable usernames at mobile size', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const logoLoaded = page.waitForResponse(response => response.url().endsWith('/brand/deux-wild-logo.png'));
  await page.goto('/tests/browser/harness.html?view=gifting-levels');
  expect((await logoLoaded).status()).toBe(200);
  await expect(page.getByTestId('gifting-level-0').locator('.gifting-level-logo')).toHaveCount(0);
  const levels = ['Light Gray', 'Silver', 'Gold', 'Pale Khaki', 'Yellow', 'Cyan',
    'Powder Blue', 'Bright Lime Green', 'Mint Green', 'Hot Pink', 'Light Bubblegum Pink',
    'Lavender', 'Magenta', 'Peach', 'Sky Blue', 'Orange', 'Beige', 'Bright Blue'];
  const expectedColors = ['#E4E4E4', '#C0C0C0', '#FFD700', '#EDEBAD', '#FFFF00',
    '#00FFFF', '#A8DADC', '#00FF00', '#98FF98', '#FF0099', '#FFC1CC', '#B39CD0',
    '#FF00FF', '#FFDAB9', '#87CEEB', '#F39C12', '#F5F5DC', '#09B0EC'];
  for (const [index, name] of levels.entries()) {
    const row = page.getByTestId(`gifting-level-${index + 1}`);
    const logo = row.getByRole('img', { name: `${name} gifting level` });
    await expect(logo).toBeVisible();
    expect(await logo.evaluate(element => getComputedStyle(element).getPropertyValue('--gifting-level-color').trim())).toBe(expectedColors[index]);
    const placement = await row.evaluate(element => {
      const image = element.querySelector('.gifting-level-logo')!;
      const text = element.querySelector('.shiny-name')!;
      const art = image.querySelector('span')!;
      const a = image.getBoundingClientRect(), b = text.getBoundingClientRect();
      return {
        before: a.right <= b.left, textColor: getComputedStyle(text).color,
        glow: getComputedStyle(image).filter, mask: getComputedStyle(art).maskImage,
        maskMode: getComputedStyle(art).maskMode, fill: getComputedStyle(art).backgroundImage,
      };
    });
    expect(placement.before).toBe(true);
    expect(placement.textColor).toBe('rgb(255, 255, 255)');
    expect(placement.glow).toContain('drop-shadow');
    expect(placement.mask).toContain('deux-wild-logo.png');
    expect(placement.maskMode).toBe('luminance');
    expect(placement.fill).toContain('linear-gradient');
  }
  await expect(page.getByTestId('gifting-preserves-username').locator('.shiny-name')).toHaveAttribute('data-tier', '2');
  const colors = await page.locator('.gifting-level-logo').evaluateAll(elements => elements.map(element =>
    getComputedStyle(element).getPropertyValue('--gifting-level-color').trim()));
  expect(colors[9]).not.toBe(colors[12]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('gifting-levels-mobile.png') });
});
