import { test, expect } from '@playwright/test';

test('gifting logos precede unchanged readable usernames at mobile size', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const logoLoaded = page.waitForResponse(response => response.url().endsWith('/brand/deux-wild-logo.png'));
  await page.goto('/tests/browser/harness.html?view=gifting-levels');
  expect((await logoLoaded).status()).toBe(200);
  await expect(page.getByTestId('gifting-level-0').locator('.gifting-level-logo')).toHaveCount(0);
  const levels = ['Green', 'Pink', 'Purple', 'Yellow', 'Platinum', 'Magenta'];
  const expectedColors = ['#00FF00', '#FF0099', '#B39CD0', '#FFFF00', '#C0C0C0', '#FF00FF'];
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
  expect(colors[1]).not.toBe(colors[5]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('gifting-levels-mobile.png') });
});
