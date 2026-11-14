import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const width of [320, 390, 430]) {
  test(`unread badge follows every bottom-nav screen and updates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=audit-fixes');
    for (const path of ['/home', '/community/favorites', '/community/messages', '/community/messages/fixture', '/user-portal', '/rooms/MUSIC1']) {
      await page.getByLabel('Fixture route').fill(path);
      await expect(page.getByTestId('bottom-nav-message').getByTestId('badge-home-unread')).toHaveText('3');
    }
    await page.getByLabel('Fixture unread').fill('120');
    await expect(page.getByTestId('badge-home-unread')).toHaveText('99+');
    await page.getByLabel('Fixture unread').fill('0');
    await expect(page.getByTestId('badge-home-unread')).toHaveCount(0);
    await page.getByLabel('Fixture unread').fill('4');
    await page.getByRole('button', { name: 'Toggle fixture sign-in' }).click();
    await expect(page.getByTestId('badge-home-unread')).toHaveCount(0);
    await page.getByLabel('Fixture route').fill('/community/chess/fixture');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });
  test(`whole portrait photos have rectangular frames at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=audit-fixes');
    const photos = page.locator('section img');
    await expect(photos).toHaveCount(9);
    for (const img of await photos.all()) {
      await expect(img).toHaveCSS('object-fit', 'contain');
      await expect(img).toHaveCSS('border-radius', '0px');
      expect(await img.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 80 && node.naturalHeight === 160)).toBe(true);
    }
  });
}

test('unread fetching stays enabled off Home with polling, focus and reconnect refresh', () => {
  const nav = readFileSync('src/components/bottom-navigation.tsx', 'utf8');
  expect(nav).toContain('enabled: !!isSignedIn && !hidden');
  expect(nav).toContain('refetchInterval: 4_000');
  expect(nav).toContain("refetchOnReconnect: 'always'");
  expect(nav).toContain('refetchOnWindowFocus: true');
  expect(nav).not.toContain("isHome && label === 'Message'");
});
