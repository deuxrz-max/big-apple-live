import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
const username = 'navigation-fixture';
const person = {
  username, displayName: 'Navigation Fixture', photoUrl: null, photoUrls: [],
  country: null, bio: 'Isolated profile navigation test', interests: [],
  followerCount: 3, followingCount: 2, receivedCredits: 0, sentCredits: 0,
  favorite: false, blocked: false, displayNameColor: '#FFFFFF', displayNameTierIndex: 11,
};
test.beforeEach(async ({ page }) => {
  await page.route(`**/api/social/people/${username}`, r => r.fulfill({ json: person }));
  await page.route('**/api/social/messages', r => r.fulfill({ json: { conversations: [{
    username, displayName: person.displayName, photoUrl: null, unreadCount: 0, blocked: false,
    updatedAt: '2026-01-01T00:00:00Z', lastMessage: 'Fixture message', lastText: 'Fixture message',
  }] } }));
  await page.route('**/api/social/favorites/gallery', r => r.fulfill({ json: [] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html?view=profile-navigation');
});

for (const width of [320, 390, 430]) {
  test(`photo sheet preserves route, draft and square shape at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel('Preserved draft').fill('Keep this draft');
    await page.getByTestId(`card-person-${username}`).getByTestId(`tap-profile-photo-${username}`).tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('text-quick-profile-username')).toHaveText(`@${username}`);
    await expect(sheet).toHaveCSS('border-radius', '0px');
    await expect(sheet).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    const box = await sheet.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width === 390) await page.screenshot({ path: 'test-results/quick-profile-390.png' });
    await expect(page.getByTestId('navigation-route')).toHaveText('/home');
    await page.getByTestId('button-quick-profile-dismiss').tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByLabel('Preserved draft')).toHaveValue('Keep this draft');
  });
}

test('Following and Inbox photo taps do not join rooms or open message threads', async ({ page }) => {
  await page.getByTestId(`tile-following-${username}`).getByTestId(`tap-profile-photo-${username}`).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('navigation-joins')).toHaveText('0');
  await page.getByTestId('button-quick-profile-close').tap();
  await page.getByTestId(`button-join-following-${username}`).tap();
  await expect(page.getByTestId('navigation-joins')).toHaveText('1');
  await page.locator('.ib').getByTestId(`tap-profile-photo-${username}`).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('navigation-route')).toHaveText('/home');
});

test('full profile has a working Back to its originating route', async ({ page }) => {
  await page.getByTestId(`card-person-${username}`).getByTestId(`tap-profile-photo-${username}`).tap();
  await page.getByTestId('link-quick-profile-full').tap();
  await expect(page.getByTestId('navigation-route')).toHaveText(`/community/people/${username}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back', exact: true }).tap();
  await expect(page.getByTestId('navigation-route')).toHaveText('/home');
});

test('Escape, focus trap, retry and focus restoration work', async ({ page }) => {
  let failed = true;
  await page.route(`**/api/social/people/${username}`, r => r.fulfill(failed
    ? { status: 500, json: { error: 'Fixture unavailable' } } : { json: person }));
  const trigger = page.getByTestId(`card-person-${username}`).getByTestId(`tap-profile-photo-${username}`);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-quick-profile-error')).toBeVisible();
  failed = false;
  await page.getByTestId('button-quick-profile-retry').click();
  await expect(page.getByTestId('text-quick-profile-name')).toContainText(person.displayName);
  await page.getByTestId('button-quick-profile-dismiss').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('button-quick-profile-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('Chess photo swipe stays a swipe; a tap opens the profile', async ({ page }) => {
  const track = page.getByTestId(`tap-chess-photo-${username}`);
  await track.scrollIntoViewIfNeeded();
  await track.dispatchEvent('pointerdown', { clientX: 250, clientY: 500 });
  await track.dispatchEvent('pointermove', { clientX: 80, clientY: 500 });
  await track.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await track.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('livestream host picture opens profile without leaving the live screen', async ({ page }) => {
  await page.route('**/api/social/people/fixture', r => r.fulfill({ json: { ...person, username: 'fixture' } }));
  await page.goto('/tests/browser/harness.html?view=live-layout');
  await page.getByTestId('live-creator-avatar').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('text-quick-profile-username')).toHaveText('@fixture');
  await page.getByTestId('button-quick-profile-close').tap();
  await expect(page.getByTestId('dock-live-controls')).toBeVisible();
  await expect(page.getByPlaceholder('Say something…')).toBeVisible();
});
