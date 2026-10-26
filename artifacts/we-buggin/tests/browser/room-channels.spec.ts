import { expect, test } from '@playwright/test';
import { channelForDirectoryRoom, roomChannelHref } from '../../src/chat/room-channels';

const groups = [
  { slug: 'cafe', name: 'The Cafe', rooms: [['MUSIC1', 'Music'], ['COMEDY', 'Comedy'], ['NEWS01', 'News']] },
  { slug: 'screening', name: 'The Screening Room', rooms: [['MOVIES', 'Movies'], ['WEBSER', 'Web Series'], ['HIST01', 'History']] },
  { slug: 'arena', name: 'The Arena', rooms: [['SPORTS', 'Sports'], ['KIDS01', 'Pro Wrestling']] },
];

for (const width of [320, 390]) {
  test(`all eight room links return to the right group at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=room-channels');
    await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
    await expect(page.getByTestId('section-room-channels').getByText('Go Live', { exact: true })).toBeVisible();
    if (width === 390) await page.screenshot({ path: '../../generated-artifacts/home-channels-390.png', fullPage: true });
    for (const group of groups) {
      await page.getByTestId(`link-channel-${group.slug}`).click();
      await expect(page).toHaveURL(new RegExp(`/home\\?channel=${group.slug}$`));
      await expect(page.getByTestId('text-channel-title')).toHaveText(group.name);
      await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(group.rooms.length);
      if (width === 390 && group.slug === 'cafe') {
        await page.screenshot({ path: '../../generated-artifacts/cafe-channel-390.png', fullPage: true });
      }
      for (const [id, name] of group.rooms) {
        const card = page.getByTestId(`card-home-room-${id}`);
        await expect(card).toHaveAttribute('href', `/rooms/${id}`);
        const bounds = await card.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await card.click();
        await expect(page).toHaveURL(new RegExp(`/rooms/${id}$`));
        await expect(page.getByRole('heading', { name: name!, exact: true })).toBeVisible();
        await page.getByTestId('link-back-to-channel').click();
        await expect(page).toHaveURL(new RegExp(`/home\\?channel=${group.slug}$`));
        await expect(page.getByTestId('text-channel-title')).toHaveText(group.name);
      }
      await page.getByTestId('link-back-to-channels').click();
      await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
    }
    // Browser history restores the channel selection too.
    await page.getByTestId('link-channel-arena').click();
    await page.getByTestId('card-home-room-SPORTS').click();
    await page.goBack();
    await expect(page.getByTestId('text-channel-title')).toHaveText('The Arena');
    await page.goBack();
    await expect(page.getByTestId('section-room-channels')).toBeVisible();
  });
}

test('channel deep links survive reload and invalid channels show the groups', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?view=room-channels&channel=screening');
  await expect(page.getByTestId('text-channel-title')).toHaveText('The Screening Room');
  await page.reload();
  await expect(page.getByTestId('text-channel-title')).toHaveText('The Screening Room');
  await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(3);
  await page.goto('/tests/browser/harness.html?view=room-channels&channel=missing');
  await expect(page.getByTestId('section-room-channels')).toBeVisible();
});

test('overflow rooms keep their parent channel and unrelated rooms are not reassigned', () => {
  expect(channelForDirectoryRoom('MUSIC12')?.slug).toBe('cafe');
  expect(roomChannelHref('WEBSER2')).toBe('/home?channel=screening');
  expect(channelForDirectoryRoom('KIDS012')?.slug).toBe('arena');
  expect(roomChannelHref('private-user-room')).toBeNull();
  expect(roomChannelHref('CHESS1')).toBeNull();
  expect(channelForDirectoryRoom('MUSIC1-unrelated')).toBeNull();
});

test('signed-out landing shows three channels and retains sign-in before room entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/account/chat/**', route => route.fulfill({ json: groups.flatMap(group =>
    group.rooms.map(([roomId, label]) => ({ roomId, label, headcount: 0, headcountSince: 0 }))) }));
  await page.goto('/tests/browser/harness.html?view=public-channels');
  await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
  await expect(page.getByTestId('link-channel-cafe')).toHaveAttribute('href', '/?channel=cafe');
  await page.getByTestId('link-channel-cafe').click();
  await expect(page.getByTestId('text-channel-title')).toHaveText('The Cafe');
  await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(3);
  await expect(page.getByTestId('card-home-room-MUSIC1')).toHaveAttribute('href', '/sign-in');
  await page.getByTestId('link-back-to-channels').click();
  await expect(page.getByTestId('section-room-channels')).toBeVisible();
});

test('homepage Cauldron is below all three channels, transparent, silent and absent inside groups', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: string[] = [];
  page.on('request', request => { requests.push(request.url()); });
  await page.route('**/api/gift-media/system-cauldron/webm', route =>
    route.fulfill({ path: '/tmp/deux-home-cauldron.webm', contentType: 'video/webm' }));
  await page.goto('/tests/browser/harness.html?view=room-channels');
  const cauldron = page.getByTestId('homepage-cauldron');
  await cauldron.scrollIntoViewIfNeeded();
  const video = page.getByTestId('homepage-cauldron-video');
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).videoWidth)).toBe(266);
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  const details = await cauldron.evaluate(el => {
    const media = el.querySelector('video')!;
    const style = getComputedStyle(el);
    const children = Array.from(el.closest('ul')!.children);
    const index = children.indexOf(el.parentElement!);
    const canvas = document.createElement('canvas');
    canvas.width = media.videoWidth; canvas.height = media.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(media, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) transparent++;
    return { index, before: children.slice(0, index).filter(child => child.querySelector('[data-testid^="link-channel-"]')).length,
      nextIsLaunch: children[index + 1]?.classList.contains('st-home-go-live'),
      background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow,
      muted: media.muted, transparent };
  });
  expect(details).toMatchObject({ index: 3, before: 3, nextIsLaunch: true,
    background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none', muted: true });
  expect(details.transparent).toBeGreaterThan(1000);
  expect(requests.some(url => url.includes('4e90ea00-98be-4b14-a033-7dfb4138a4cb'))).toBe(false);
  await cauldron.screenshot({ path: '../../generated-artifacts/homepage-cauldron-390.png' });
  await page.getByTestId('link-channel-cafe').click();
  await expect(page.getByTestId('homepage-cauldron')).toHaveCount(0);
});
