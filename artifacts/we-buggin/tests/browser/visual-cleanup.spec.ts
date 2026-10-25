import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const profile = {
  userId: 'fixture', username: 'fixture', displayName: 'Fixture User', updatedAt: '2026-10-25T00:00:00Z',
  photoUrl: null, photoUrls: [], bio: 'Original bio', country: 'US', interests: ['Music'],
  discoverable: true, externalPlatform: null, externalHandle: null, badges: [],
};
const social = {
  profile, countries: [{ code: 'US', name: 'United States' }], inventory: [], products: [], badges: [],
  gifterAccessLevel: 100, wallet: { balance: 5000 }, hangoutStreak: { days: 1, eligibleToday: false },
  entranceEffects: { ownerTest: null, eligible: false },
};

for (const width of [320, 390, 430]) {
  test(`whole Home photo and black/gold defaults at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=visual-cleanup');
    const photo = page.getByTestId('home-photo').locator('img');
    await expect(photo).toBeVisible();
    await expect(photo).toHaveCSS('object-fit', 'contain');
    await expect(photo).toHaveCSS('border-radius', '0px');
    await expect(page.getByTestId('no-photo').getByRole('img')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.getByTestId('no-photo').getByRole('img')).toHaveCSS('color', 'rgb(230, 200, 120)');
    const neutral = page.getByTestId('neutral-photo');
    await expect(neutral.locator('rect')).toHaveAttribute('fill', '#000000');
    await expect(neutral.locator('text')).toHaveAttribute('fill', '#e6c878');
    const placeholder = page.getByTestId('chess-no-photo');
    const outer = await placeholder.boundingBox();
    const inner = await placeholder.getByRole('img').boundingBox();
    expect(inner!.width).toBeCloseTo(outer!.width, 0);
    expect(inner!.height).toBeCloseTo(outer!.height, 0);
  });

  test(`catalog has one vertical list and new custom gifts in Special at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const gifts = [
      { id: 'heart', name: 'Heart', cost: 10, iconUrl: null },
      { id: 'fireworks', name: 'Fireworks', cost: 20, iconUrl: null },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `studio-custom-${i}`, name: `Custom gift ${i}`, cost: 30 + i, iconUrl: null,
      })),
      { id: 'motion-custom', name: 'Motion custom', cost: 100, iconUrl: null },
    ];
    let sends = 0;
    await page.route('**/api/social/me', route => route.fulfill({ json: { ...social, gifts } }));
    await page.route('**/api/social/gifts', route => { sends++; return route.fulfill({ json: {} }); });
    await page.goto('/tests/browser/harness.html?view=gift-catalog');
    await expect(page.locator('.gift-panel-pager,.gift-panel-page-indicator')).toHaveCount(0);
    await expect(page.locator('.gift-panel-grid [data-testid^="gift-catalog-"]')).toHaveCount(32);
    await page.getByRole('button', { name: 'Special', exact: true }).click();
    await expect(page.locator('.gift-panel-grid [data-testid^="gift-catalog-"]')).toHaveCount(31);
    const last = page.getByTestId('gift-catalog-motion-custom');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();
    await last.click();
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    const scroll = page.locator('.gift-panel-scroll');
    await expect(scroll).toHaveCSS('overflow-x', 'hidden');
    expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId('gift-bag-send')).toBeEnabled();
    expect(sends).toBe(0); // selecting or browsing never charges
  });

  test(`consolidated edit profile keeps readable square dark/gold fields at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/api/me', route => route.fulfill({ json: { profile } }));
    await page.route('**/api/social/me', route => route.fulfill({ json: { ...social, gifts: [] } }));
    await page.goto('/tests/browser/harness.html?view=edit-profile');
    const name = page.getByTestId('input-display-name');
    await expect(name).toHaveValue('Fixture User');
    await name.fill('Updated Fixture');
    await expect(name).toHaveValue('Updated Fixture');
    await expect(name).toHaveCSS('border-radius', '0px');
    await expect(name).toHaveCSS('font-size', '16px');
    expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId('button-save-identity')).toBeEnabled();
    await expect(page.getByTestId('input-bio')).toHaveCount(1);
    await expect(page.getByTestId('input-bio')).toHaveValue('Original bio');
    await expect(page.getByTestId('select-profile-country')).toHaveValue('US');
    await expect(page.getByTestId('input-interests')).toHaveValue('Music');
    await page.getByTestId('input-interests').fill('Music, Chess');
    await expect(page.getByTestId('input-interests')).toHaveValue('Music, Chess');
    await expect(page.getByTestId('input-bio')).toHaveCSS('border-radius', '0px');
    await expect(page.getByTestId('input-bio')).toHaveCSS('font-size', '16px');
    // The shared satin finish may use gold lettering rather than a gold-filled button.
    expect(await page.getByTestId('button-save-profile').evaluate(el => getComputedStyle(el).color))
      .toMatch(/^rgb\((20, 15, 6|255, 231, 166)\)$/);
    await expect(page.locator('.ep-social-profile a.bm-link').first()).toHaveCSS('color', 'rgb(227, 194, 122)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: 'test-results/edit-profile-dark-gold-390.png' });
  });
}

test('Home uses the saved photo and wrestling palette no longer contains its purple colors', () => {
  const source = readFileSync(new URL('../../src/chat/ChatApp.tsx', import.meta.url), 'utf8');
  expect(source).toContain('photoUrl={me.data?.profile?.photoUrl}');
  for (const purple of ['#38203f', '#df9fff', '#df7cff', '#4c1b55']) expect(source).not.toContain(purple);
  const groups = readFileSync(new URL('../../src/gifts/gift-catalog-groups.ts', import.meta.url), 'utf8');
  expect(groups).toContain('/^(studio|motion)-/');
});
