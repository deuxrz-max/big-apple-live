import { expect, test } from '@playwright/test';

// Isolated harness only: every API response below is a local fixture. No real account is touched.
const photo = '/fixture-profile-photo.svg';

for (const width of [320, 390]) {
  test(`Me page has no passport leftovers and keeps photo, coins and gifting shield at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    let photoUrl: string | null = photo;
    await page.route('**/fixture-profile-photo*.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="#20232b"/><ellipse cx="300" cy="220" rx="90" ry="110" fill="#c9a890"/></svg>',
    }));
    await page.route('**/api/social/me', route => route.fulfill({ json: {
      profile: {
        username: 'CleanupFixture', displayName: 'Cleanup Fixture',
        displayNameColor: '#C0C0C0', displayNameTierIndex: 6,
        photoUrl, photoUrls: photoUrl ? [photoUrl] : [],
        photoReviews: photoUrl ? [{ photoUrl, status: 'approved' }] : [],
        photoStatus: photoUrl ? 'approved' : 'none',
        // Old saved preset identity + self-listed platform must render nothing passport-like.
        identity: { emojiId: '1F60E', gender: 'Male', color: '#F7C531', hairColor: '#E8187F', portraitId: 'kiss' },
        externalPlatform: 'LiveMe', externalHandle: 'oldhandle',
        bio: '', country: 'US', interests: [], discoverable: true, favorite: false, blocked: false,
        followerCount: 12, followingCount: 7, receivedCredits: 4321, sentCredits: 8765,
        badgeId: null, badgeName: null, badgeImage: null, badges: [],
      },
      countries: [{ code: 'US', name: 'United States' }],
      products: [], gifts: [], inventory: [],
      wallet: { balance: 1234, earned: 0, received: 0, sent: 0, dailyReward: 0, canClaimDaily: false, unlimited: false },
      nameColorTest: { enabled: false, overrideCoins: null },
      nameColorProgress: { tierIndex: 96, tierName: 'Deux Wild', color: '#39FF14',
        lifetimeCoinsPurchased: 2_000_000, coinsToNextTier: 0, nextTierName: null, nextTierThreshold: null },
    } }));
    await page.route('**/api/account/chat/access', route => route.fulfill({ json: {
      adultConfirmed: true, moderator: false, owner: true, suspended: false,
      chatMuted: false, reportsMuted: false, warning: null,
    } }));
    await page.goto('/tests/browser/harness.html?view=profile-cleanup');

    const view = page.getByTestId('profile-view');
    await expect(page.getByTestId('text-display-name')).toContainText('Cleanup Fixture');
    // Passport, self-listed platform, country stamp and name emoji are gone.
    await expect(view).not.toContainText(/passport/i);
    await expect(view).not.toContainText('LiveMe');
    await expect(view).not.toContainText(/self-listed/i);
    await expect(page.locator('[data-testid^="passport"], [data-testid*="-passport"], .sp-card, .pf-name-emoji')).toHaveCount(0);
    await expect(page.getByTestId('text-display-name')).not.toContainText('😎');
    // Kept: coin stats, gifting level 96 shield, existing Me tools.
    await expect(page.getByTestId('text-received')).toContainText('4,321');
    await expect(page.getByTestId('text-sent')).toContainText('8,765');
    await expect(page.getByTestId('badge-gifting-level-96')).toBeVisible();
    await expect(page.getByTestId('section-gifting-level')).toBeVisible();
    await expect(page.getByTestId('link-buy-credits')).toBeVisible();
    await expect(page.getByTestId('link-profile-photo-review')).toHaveAttribute('href', '/user-portal/photo-reviews');
    await expect(page.getByTestId('link-gift-studio')).toBeVisible();
    // Panel ends cleanly on coin stats: tools/XP above, nothing (no passport gap) after.
    const tail = await page.locator('.pf-panel').first().evaluate((panel) => {
      const kids = [...panel.children].filter((el) => (el as HTMLElement).offsetHeight > 0 || getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().height > 0);
      const last = kids.at(-1) as HTMLElement;
      const panelRect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      return { lastIsStats: last.matches('dl.pf-stats'), gap: panelRect.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth) - parseFloat(getComputedStyle(last).marginBottom) - last.getBoundingClientRect().bottom,
        toolsBefore: !!panel.querySelector('[data-testid="section-gifting-level"]') && !!panel.querySelector('[data-testid="nav-profile-shortcuts"]') };
    });
    expect(tail.lastIsStats).toBe(true);
    expect(tail.toolsBefore).toBe(true);
    expect(Math.abs(tail.gap)).toBeLessThan(2);
    // Uploaded photo stays.
    await expect(page.locator('.pf-hero .pf-slide img')).toHaveAttribute('src', photo);
    await page.screenshot({ path: info.outputPath('me-cleanup-photo.png') });

    // No photo: neutral initials, never preset artwork.
    photoUrl = null;
    await page.reload();
    await expect(page.getByTestId('text-display-name')).toContainText('Cleanup Fixture');
    await expect(page.locator('.pf-hero .pf-slide img')).toHaveCount(0);
    const neutral = page.locator('.pf-slide-empty [role="img"]');
    await expect(neutral).toHaveText('CF');
    await expect(neutral).toHaveAccessibleName('Cleanup Fixture (no photo)');
    await expect(page.locator('img[src*="profile-pictures"]')).toHaveCount(0);
    await expect(page.getByTestId('badge-gifting-level-96')).toBeVisible();
  });
}
