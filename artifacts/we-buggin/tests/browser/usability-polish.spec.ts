import { test, expect } from '@playwright/test';
import { PRODUCTS } from '../../../api-server/src/lib/social/catalog';

const profile = {
  username: 'fixture', displayName: 'Fixture User', updatedAt: '2026-10-25T00:00:00Z',
  photoUrl: null, photoUrls: [], bio: 'Original bio', country: 'US', interests: ['Music'],
  discoverable: true, externalPlatform: null, externalHandle: null, badges: [],
};
const social = {
  profile, countries: [{ code: 'US', name: 'United States' }], inventory: [], products: PRODUCTS, badges: [],
  gifts: [], wallet: { balance: 5000, earned: 0, received: 0, sent: 0, dailyReward: 25, canClaimDaily: false },
  hangoutStreak: { days: 1, eligibleToday: false }, entranceEffects: { ownerTest: null, eligible: false },
};

for (const width of [320, 390, 430]) {
  test(`Home selection and occupied-only LIVE labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=home-polish');
    const nav = page.getByTestId('nav-home-sections');
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toHaveClass('is-on');
    await nav.getByRole('link', { name: 'Creators', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Creators', exact: true })).toHaveAttribute('aria-current', 'location');
    await expect(nav.locator('.is-on')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).not.toHaveClass('is-on');
    await page.goBack();
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toHaveClass('is-on');
    await expect(nav.getByText('All live')).toHaveAttribute('href', '/live');
    await expect(nav.getByText('Leaderboard')).toHaveAttribute('href', '/community/leaderboard');
    await expect(page.getByTestId('card-home-room-empty').getByText('LIVE', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('card-home-room-occupied').getByText('LIVE', { exact: true })).toBeVisible();
  });

  test(`one bio editor, preserved save contracts and recharge labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let savedBio = profile.bio;
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/me', route => {
      if (route.request().method() === 'PUT') {
        writes.push({ url: 'identity', body: route.request().postDataJSON() });
      }
      return route.fulfill({ json: route.request().method() === 'GET'
        ? { profile: { ...profile, bio: savedBio } } : { ...profile, bio: savedBio } });
    });
    await page.route('**/api/social/me', route => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push({ url: 'preferences', body });
        savedBio = body.bio;
        return route.fulfill({ json: { ...profile, ...body } });
      }
      return route.fulfill({ json: { ...social, profile: { ...profile, bio: savedBio } } });
    });
    await page.goto('/tests/browser/harness.html?view=edit-profile');
    const bio = page.getByTestId('input-bio');
    await expect(bio).toHaveCount(1);
    await bio.fill('One canonical biography');
    await page.getByTestId('input-interests').fill('Music, Chess');
    await page.getByTestId('button-save-profile').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.body).toMatchObject({ bio: 'One canonical biography', interests: ['Music', 'Chess'], country: 'US' });
    await page.getByTestId('input-display-name').fill('New Fixture Name');
    await page.getByTestId('button-save-identity').click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]!.body).not.toHaveProperty('bio');
    expect(writes[1]!.body).toMatchObject({ displayName: 'New Fixture Name' });
    expect(savedBio).toBe('One canonical biography');
    await expect(page.locator('.ep-social-profile a').getByText('Blocked')).toHaveAttribute('href', '/community/blocks');
    await page.goto('/tests/browser/harness.html?view=badges');
    await expect(page.locator('.sc-product')).toHaveCount(PRODUCTS.length);
    for (const product of PRODUCTS) {
      await expect(page.getByTestId(`label-recharge-tier-${product.id}`)).toHaveText('Recharge tier');
      await expect(page.getByTestId(`card-product-${product.id}`)).toHaveCSS('border-radius', '0px');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`long livestream name stays contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=live-layout&longName=1');
    const name = page.getByTestId('live-creator-profile').locator('strong');
    await expect(name).toContainText('Extremely Long');
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    await expect(name).toHaveCSS('white-space', 'nowrap');
    const tag = await page.getByTestId('live-creator-profile').boundingBox();
    const actions = await page.locator('.st-live-top-actions').boundingBox();
    expect(tag!.x + tag!.width).toBeLessThanOrEqual(actions!.x + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  for (const color of ['w', 'b']) {
    test(`Chess ${color} controls and full no-photo banners at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const player = (id: string) => ({ ...profile, accountId: id, giftingLevel: 1 });
      await page.route('**/api/social/chess/rooms/polish**', route => route.fulfill({ json: {
        roomId: 'polish', revision: 1, status: 'playing', yourColor: color, turn: 'w', inCheck: false,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        legalMoves: [{ from: 'e2', to: 'e4' }], players: { white: player('white'), black: player('black') },
        serverNow: new Date().toISOString(), result: null, rematchRequestedBy: null,
      } }));
      await page.goto('/tests/browser/harness.html?view=chess-polish');
      const own = page.getByTestId(`chess-player-${color}`);
      const other = page.getByTestId(`chess-player-${color === 'w' ? 'b' : 'w'}`);
      await expect(own.getByTestId('button-chess-mic')).toBeVisible();
      await expect(own.getByTestId('button-chess-leave')).toBeVisible();
      await expect(other.getByTestId('button-chess-mic')).toHaveCount(0);
      await expect(page.locator('.chess-photo-initials')).toHaveCount(2);
      const banner = await own.boundingBox();
      const placeholder = await own.locator('.chess-photo-fallback').boundingBox();
      expect(placeholder!.width).toBeGreaterThan(banner!.width - 5);
      expect(placeholder!.height).toBeGreaterThan(banner!.height - 5);
      await own.getByTestId('button-chess-resign').click();
      await expect(page.getByRole('dialog', { name: 'Confirm resignation' })).toBeVisible();
      await page.getByRole('button', { name: 'Keep playing' }).click();
      await expect(page.getByTestId('chess-board').getByRole('gridcell')).toHaveCount(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
