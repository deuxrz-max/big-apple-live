import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.use({ hasTouch: true });

for (const width of [320, 390, 430]) {
  test(`access recovery controls fit and respond at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=access-error');
    for (const [label, result] of [['Retry', 'Retried'], ['Back', 'Went back'], ['Sign out', 'Signed out']]) {
      const button = page.getByRole('button', { name: label, exact: true });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await button.tap();
      await expect(page.getByRole('status')).toHaveText(result);
    }
  });
}

test('failed sign out keeps recovery actions available', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?view=access-error&fail-signout=1');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Could not sign out. Try again, or use Back or the bottom tabs.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Retried');
});

test('navigation stays outside the access-gated route tree', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  expect(app).toMatch(/<\/RoutedErrorBoundary><\/div>\s*<BottomNavigation/);
  const gate = readFileSync('src/chat/ChatApp.tsx', 'utf8');
  expect(gate).toContain("else navigate('/user-portal')");
  expect(gate).toContain('window.history.back()');
  expect(gate).toContain("signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })");
});
