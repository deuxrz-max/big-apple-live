import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`Me photo country badge uses saved country without moving the layout at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    let country: string | null = 'US';
    let pictures = 1;
    const photo = '/fixture-passport-photo.svg';
    await page.route('**/fixture-passport-photo*.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="#20232b"/><ellipse cx="300" cy="220" rx="90" ry="110" fill="#c9a890"/><path d="M130 500Q130 340 300 340T470 500" fill="#555c72"/></svg>',
    }));
    await page.route('**/api/social/me', route => route.fulfill({ json: {
      profile: {
        username: 'PassportFixture', displayName: 'Passport Fixture',
        displayNameColor: '#C0C0C0', displayNameTierIndex: 18,
        photoUrl: photo, photoUrls: pictures === 1 ? [photo] : [photo, '/fixture-passport-photo-2.svg'],
        photoReviews: [photo, '/fixture-passport-photo-2.svg'].map(photoUrl => ({ photoUrl, status: 'approved' })),
        photoStatus: 'approved', identity: { emojiId: '1F600' },
        bio: '', country, interests: [], discoverable: true, favorite: false, blocked: false,
        receivedCredits: 0, badgeId: null, badgeName: null, badgeImage: null, badges: [],
      },
      countries: [{ code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }],
      products: [], gifts: [], inventory: [],
      wallet: { balance: 1234, earned: 0, received: 0, sent: 0, dailyReward: 0, canClaimDaily: false, unlimited: false },
      nameColorTest: { enabled: false, overrideCoins: null },
      nameColorProgress: { tierIndex: 18, tierName: 'Bright Blue', color: '#09B0EC',
        lifetimeCoinsPurchased: 180000, coinsToNextTier: 0, nextTierName: null, nextTierThreshold: null },
    } }));
    await page.route('**/api/account/chat/access', route => route.fulfill({ json: {
      adultConfirmed: true, moderator: false, owner: true, suspended: false,
      chatMuted: false, reportsMuted: false, warning: null,
    } }));
    await page.goto('/tests/browser/harness.html?view=passport-country');
    await expect(page.getByTestId('link-profile-photo-review')).toHaveAttribute('href', '/user-portal/photo-reviews');
    const badge = page.getByTestId('passport-country-badge');
    await expect(badge).toHaveAccessibleName('Country: United States — self-listed');
    await expect(badge).toHaveAttribute('title', 'United States — self-listed');
    await expect(badge).toContainText('🇺🇸');
    await expect(badge).toContainText('US');
    await expect(badge).toContainText('United States');
    await expect(badge).toContainText('SELF-LISTED');
    await page.evaluate(() => document.fonts.ready);
    const hero = page.locator('.pf-hero');
    const rect = (await hero.boundingBox())!;
    const flagRect = (await badge.boundingBox())!;
    expect(Math.abs(rect.x + rect.width - flagRect.x - flagRect.width - 12)).toBeLessThan(1);
    expect(Math.abs(rect.y + rect.height - flagRect.y - flagRect.height - 40)).toBeLessThan(1);
    const panel = (await page.locator('.pf-panel').first().boundingBox())!;
    expect(flagRect.y + flagRect.height).toBeLessThanOrEqual(panel.y - 8);
    expect(flagRect.width * flagRect.height / (rect.width * rect.height)).toBeLessThan(.11);
    await expect(badge).toHaveCSS('border-radius', '999px');
    await expect(hero.locator('.pf-slide img')).toHaveAttribute('src', photo);
    await expect(page.getByTestId('text-display-name').getByRole('img', { name: 'Bright Blue gifting level' })).toBeVisible();
    const title = await page.getByTestId('text-display-name').boundingBox();
    await page.screenshot({ path: info.outputPath('me-country-badge-mobile.png'), fullPage: false });

    country = null;
    await page.reload();
    await expect(page.getByTestId('text-display-name')).toBeVisible();
    await expect(badge).toHaveCount(0);
    expect(await hero.boundingBox()).toEqual(rect);
    expect(await page.getByTestId('text-display-name').boundingBox()).toEqual(title);

    country = 'GB'; pictures = 2;
    await page.reload();
    await expect(badge).toHaveAccessibleName('Country: United Kingdom — self-listed');
    await expect(badge).toContainText('🇬🇧');
    const secondPhotoTab = page.getByRole('tab', { name: 'Photo 2 of 2' });
    const tabRect = (await secondPhotoTab.boundingBox())!;
    expect(tabRect.x + tabRect.width).toBeLessThanOrEqual(flagRect.x);
    await secondPhotoTab.click();
    await expect(page.getByRole('tab', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-selected', 'true');
    await expect(badge).toBeVisible();
    expect(await badge.boundingBox()).toEqual(flagRect);

    country = 'XX';
    await page.reload();
    await expect(page.getByTestId('text-display-name')).toBeVisible();
    await expect(badge).toHaveCount(0);
  });
}
