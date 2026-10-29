import { expect, test } from '@playwright/test';
import { channelForDirectoryRoom, roomChannelHref } from '../../src/chat/room-channels';
import { cauldronDisplayLevel } from '../../src/chat/cauldron-display-level';
import { cauldronArtworkBounds, cauldronArtworkFit } from '../../src/chat/cauldron-artwork-fit';
import {
  configuredNycBackgroundVideos, pickRandomHomeBackground, pickRoomBackground,
  NYC_BACKGROUND_VIDEO_SLOTS,
} from '../../src/chat/nyc-background-videos';

const groups = [
  { slug: 'cafe', roomId: 'CAFE01', name: 'Times Square' },
  { slug: 'screening', roomId: 'SCREEN', name: 'Broadway' },
  { slug: 'arena', roomId: 'ARENA1', name: 'Harlem' },
];

for (const width of [320, 390]) {
  test(`three channels enter their combined room directly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/browser/harness.html?view=room-channels');
    await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
    for (const group of groups) {
      const sign = page.getByTestId(`label-channel-${group.slug}`);
      const tile = page.getByTestId(`link-channel-${group.slug}`);
      await expect(sign).toHaveAttribute('aria-label', group.name);
      await expect(sign).toHaveText(group.name.toUpperCase());
      await expect(sign.locator('rect').first()).toHaveAttribute('stroke', '#e4e4d7');
      await expect(sign.locator('rect').first()).toHaveAttribute('fill', new RegExp(`street-sign-${group.slug}-paint`));
      await expect(tile.locator('.rc-tile-title')).toHaveCount(0);
      await expect(tile).toHaveText('');
      await expect(tile).not.toHaveAttribute('title');
      await expect(tile).toHaveAttribute('aria-label', `Enter ${group.name} room`);
      const [signBox, tileBox] = await Promise.all([sign.boundingBox(), tile.boundingBox()]);
      expect(Math.abs(signBox!.x - tileBox!.x)).toBeLessThan(1);
      expect(signBox!.y + signBox!.height).toBeLessThanOrEqual(tileBox!.y);
    }
    await expect(page.getByTestId('section-room-channels').getByText('Go Live', { exact: true })).toBeVisible();
    if (width === 390) await page.screenshot({ path: '../../generated-artifacts/home-channels-390.png', fullPage: true });
    for (const group of groups) {
      await page.getByTestId(`link-channel-${group.slug}`).click();
      await expect(page).toHaveURL(new RegExp(`/rooms/${group.roomId}$`));
      await expect(page.getByRole('heading', { name: group.name, exact: true })).toBeVisible();
      await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(0);
      await expect(page.getByTestId('link-back-to-channel')).toHaveText('Back to channels');
      await page.getByTestId('link-back-to-channel').click();
      await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
    }
    // Browser history returns straight from a channel session to Home.
    await page.getByTestId('link-channel-arena').click();
    await page.goBack();
    await expect(page.getByTestId('section-room-channels')).toBeVisible();
  });
}

test('channel deep links survive reload and invalid channels show the groups', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?view=room-channels&channel=screening');
  await expect(page).toHaveURL(/\/rooms\/SCREEN$/);
  await expect(page.getByRole('heading', { name: 'Broadway', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(0);
  await page.goto('/tests/browser/harness.html?view=room-channels&channel=missing');
  await expect(page.getByTestId('section-room-channels')).toBeVisible();
});

test('overflow rooms keep their parent channel and unrelated rooms are not reassigned', () => {
  expect(channelForDirectoryRoom('MUSIC12')?.slug).toBe('cafe');
  expect(roomChannelHref('WEBSER2')).toBe('/rooms/SCREEN');
  expect(roomChannelHref('CAFE012')).toBe('/home');
  expect(channelForDirectoryRoom('KIDS012')?.slug).toBe('arena');
  expect(roomChannelHref('private-user-room')).toBeNull();
  expect(roomChannelHref('CHESS1')).toBeNull();
  expect(channelForDirectoryRoom('MUSIC1-unrelated')).toBeNull();
});

test('NYC background selection stays disabled until all six sources exist', () => {
  const empty = { videos: NYC_BACKGROUND_VIDEO_SLOTS.map(slot => ({ id: slot.id, src: null })) };
  expect(configuredNycBackgroundVideos(empty)).toEqual([]);
  expect(pickRandomHomeBackground([])).toBeNull();

  const manifest = { videos: NYC_BACKGROUND_VIDEO_SLOTS.map(slot => ({
    id: slot.id, src: `nyc-backgrounds/${slot.fileName}`,
  })) };
  const videos = configuredNycBackgroundVideos(manifest, '/big-apple-live/');
  expect(videos).toHaveLength(6);
  expect(videos[0]).toBe('/big-apple-live/nyc-backgrounds/nyc-background-1.mp4');
  expect(pickRandomHomeBackground(videos, 0)).toBe(videos[0]);
  expect(pickRandomHomeBackground(videos, 0.999)).toBe(videos[5]);
  expect(pickRoomBackground('ABC123', 'social', videos)).toBe(pickRoomBackground('ABC123', 'social', videos));
  expect(videos).toContain(pickRoomBackground('ABC123', 'social', videos));
  expect(pickRoomBackground('ABC123', 'topic', videos)).toBeNull();
  expect(pickRoomBackground('CHESSABC', 'social', videos)).toBeNull();
  expect(configuredNycBackgroundVideos({ videos: manifest.videos.slice(0, 5) })).toEqual([]);
});

test('signed-out landing shows three channels and retains sign-in before room entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/account/chat/**', route => route.fulfill({ json: groups.map(group =>
    ({ roomId: group.roomId, label: group.name, headcount: 0, headcountSince: 0 })) }));
  await page.goto('/tests/browser/harness.html?view=public-channels');
  await expect(page.locator('[data-testid^="link-channel-"]')).toHaveCount(3);
  for (const group of groups) {
    await expect(page.getByTestId(`link-channel-${group.slug}`)).toHaveAttribute('href', '/sign-in');
  }
  await expect(page.locator('[data-testid^="card-home-room-"]')).toHaveCount(0);
});

test('homepage Pink Card occupies the fourth tile, remains static and is absent inside groups', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html?view=room-channels');
  const card = page.getByTestId('tile-pink-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.locator('video')).toHaveCount(0);
  await expect(card.locator('img')).toHaveAttribute('src', /pink-card\/media\/card$/);
  const details = await card.evaluate(el => {
    const children = Array.from(el.closest('ul')!.children);
    const index = children.indexOf(el.closest('li')!);
    return { index, before: children.slice(0, index).filter(child => child.querySelector('[data-testid^="link-channel-"]')).length,
      nextIsLaunch: children[index + 1]?.classList.contains('st-home-go-live') };
  });
  expect(details).toMatchObject({ index: 3, before: 3, nextIsLaunch: true });
  await card.screenshot({ path: '../../generated-artifacts/homepage-pink-card-390.png' });
  await page.getByTestId('link-channel-cafe').click();
  await expect(page.getByTestId('tile-pink-card')).toHaveCount(0);
  await page.getByTestId('link-back-to-channel').click();
  await expect(page.getByTestId('tile-pink-card')).toBeVisible();
});

test('supplied progress holds partial and full stills, with no time-driven fill or animated fallback', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/gift-media/system-cauldron/still/*', async route => {
    const level = new URL(route.request().url()).pathname.split('/').pop();
    const response = await request.get(`http://127.0.0.1:80/api/gift-media/system-cauldron/still/${level}`);
    await route.fulfill({ body: await response.body(), contentType: 'image/png' });
  });
  await page.goto('/tests/browser/harness.html?view=cauldron-hold');
  const wrapper = page.getByTestId('homepage-cauldron');
  const image = page.getByTestId('homepage-cauldron-still');
  await expect(image).toHaveAttribute('src', /\/still\/0$/);
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(266);
  const hash = () => image.evaluate(el => {
    const img = el as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL();
  });
  const empty = await hash();
  await page.waitForTimeout(6500);
  expect(await hash()).toBe(empty);
  for (const level of [25, 50, 75, 100]) {
    await page.getByRole('button', { name: `${level}% fixture input`, exact: true }).click();
    await expect(wrapper).toHaveAttribute('data-display-level', String(level));
    await expect(image).toHaveAttribute('src', new RegExp(`/still/${level}$`));
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(266);
  }
  const held = await hash();
  expect(held).not.toBe(empty);
  await page.waitForTimeout(6500); // Longer than the entire original clip.
  expect(await hash()).toBe(held);
  await expect(wrapper.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: '0% fixture input', exact: true }).click();
  await expect(image).toHaveAttribute('src', /\/still\/0$/);
});

test('missing or invalid progress cannot invent filling', () => {
  for (const value of [undefined, null, NaN, Infinity, -10]) expect(cauldronDisplayLevel(value)).toBe(0);
  expect(cauldronDisplayLevel(25)).toBe(25);
  expect(cauldronDisplayLevel(50.4)).toBe(50);
  expect(cauldronDisplayLevel(200)).toBe(100);
});

/* MOCK YouTube IFrame API: records commands; no real network playback. */
const mockYoutube = `(() => {
  window.__ytLog = []; window.__ytPlayers = []; window.__ytOptions = [];
  const log = (id, cmd, arg) => window.__ytLog.push({ id, cmd, arg });
  window.YT = { Player: function (target, opts) {
    const id = opts.videoId; let state = -1; const self = this;
    window.__ytOptions.push({ id, playerVars: opts.playerVars });
    const frame = document.createElement('iframe'); frame.setAttribute('data-mock-yt', id); target.replaceWith(frame);
    Object.assign(this, {
      mute() { log(id, 'mute'); }, unMute() { log(id, 'unMute'); }, isMuted() { return true; }, setVolume(v) { log(id, 'setVolume', v); },
      playVideo() { log(id, 'play'); state = 1; opts.events.onStateChange?.({ data: 1, target: self }); },
      pauseVideo() { log(id, 'pause'); state = 2; }, stopVideo() { log(id, 'stop'); },
      destroy() { log(id, 'destroy'); frame.remove(); }, seekTo(s) { log(id, 'seek', Math.round(s)); },
      getDuration() { return 600; }, getCurrentTime() { return 0; }, getPlayerState() { return state; },
      loadVideoById() {}, loadPlaylist() {}, setLoop() {}, unloadModule(module) { log(id, 'unloadModule', module); },
    });
    window.__ytPlayers.push(this);
    setTimeout(() => opts.events.onReady?.({ target: self }), 10);
  } };
})();`;

test('channel previews play muted only when visible, pause off-screen and destroy on route change (mock player)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(mockYoutube);
  await page.goto('/tests/browser/harness.html?view=room-channels&previews=1');
  await expect(page.locator('iframe[data-mock-yt="mockvid0"]')).toHaveCount(1);
  await expect(page.locator('iframe[data-mock-yt="mockvid2"]')).toHaveCount(1);
  await expect(page.getByTestId('preview-channel-cafe')).toHaveAttribute('data-state', 'playing');
  await expect(page.getByTestId('preview-channel-arena')).toHaveAttribute('data-state', 'playing');
  const log = () => page.evaluate(() => (window as unknown as { __ytLog: { id: string; cmd: string; arg?: number | string }[] }).__ytLog);
  let entries = await log();
  expect(entries.some(e => e.cmd === 'unMute')).toBe(false);
  expect(entries.filter(e => e.id === 'mockvid0' && e.cmd === 'mute').length).toBeGreaterThan(0);
  expect(entries.filter(e => e.id === 'mockvid2' && e.cmd === 'mute').length).toBeGreaterThan(0);
  expect(entries.some(e => e.id === 'mockvid2' && e.cmd === 'unloadModule' && e.arg === 'captions')).toBe(true);
  const playerOptions = await page.evaluate(() => (window as unknown as {
    __ytOptions: { id: string; playerVars: { autoplay: number; cc_load_policy: number } }[];
  }).__ytOptions);
  expect(playerOptions.find(option => option.id === 'mockvid2')?.playerVars).toMatchObject({
    autoplay: 1, cc_load_policy: 0,
  });
  expect(entries.find(e => e.id === 'mockvid0' && e.cmd === 'seek')?.arg).toBeGreaterThanOrEqual(29);
  // Taps reach the channel link, not the iframe.
  expect(await page.locator('.rc-preview').first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 390, height: 120 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => (await log()).filter(e => e.id === 'mockvid0').at(-1)?.cmd).toBe('pause');
  const initialSeeks = (await log()).filter(e => e.id === 'mockvid0' && e.cmd === 'seek').length;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('link-channel-cafe').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await log()).filter(e => e.id === 'mockvid0' && e.cmd === 'seek').length)
    .toBeGreaterThan(initialSeeks);
  await page.getByTestId('link-channel-cafe').click();
  await expect(page).toHaveURL(/\/rooms\/CAFE01$/);
  entries = await log();
  expect(entries.some(e => e.id === 'mockvid0' && e.cmd === 'destroy')).toBe(true);
  await expect(page.locator('iframe[data-mock-yt]')).toHaveCount(0);
  expect(entries.some(e => e.cmd === 'unMute')).toBe(false);
});

test('live previews stay at the live edge even when YouTube reports a finite DVR duration (mock player)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(mockYoutube.replace('getDuration() { return 600; }',
    'getDuration() { return 600; }, getVideoData() { return { isLive: true }; }'));
  await page.goto('/tests/browser/harness.html?view=room-channels&previews=1');
  await expect(page.getByTestId('preview-channel-cafe')).toHaveAttribute('data-state', 'playing');
  const entries = await page.evaluate(() =>
    (window as unknown as { __ytLog: { cmd: string }[] }).__ytLog);
  expect(entries.some(entry => entry.cmd === 'seek' || entry.cmd === 'unMute')).toBe(false);
});

test('provider errors reveal the poster and status instead of covering them with an iframe error (mock player)', async ({ page }) => {
  await page.addInitScript(mockYoutube.replace(
    'setTimeout(() => opts.events.onReady?.({ target: self }), 10);',
    'setTimeout(() => { opts.events.onReady?.({ target: self }); opts.events.onError?.({ target: self }); }, 10);'));
  await page.goto('/tests/browser/harness.html?view=room-channels&previews=1');
  const preview = page.getByTestId('preview-channel-cafe');
  await expect(preview).toHaveAttribute('data-state', 'unavailable');
  await expect(preview.locator('.rc-preview-status')).toHaveCount(0);
  await expect(preview.locator('.rc-preview-poster')).toBeVisible();
  await expect(preview.locator('.rc-preview-player')).toHaveCSS('visibility', 'hidden');
});

for (const width of [320, 390]) {
  test(`channel cards use compact two-column 1.15/1 proportions at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    const response = await request.get('http://127.0.0.1:80/api/gift-media/system-cauldron/still/0');
    expect(response.ok()).toBe(true);
    const media = await response.body();
    await page.route('**/api/gift-media/system-cauldron/still/0', route =>
      route.fulfill({ body: media, contentType: 'image/png' }));
    await page.goto('/tests/browser/harness.html?view=room-channels');
    const boxes = await Promise.all(['cafe', 'screening', 'arena'].map(s => page.getByTestId(`link-channel-${s}`).boundingBox()));
    for (const b of boxes) expect(Math.abs(b!.width / b!.height - 1.15)).toBeLessThan(0.02);
    expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThan(1);
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
    const pinkCardTile = page.getByTestId('tile-pink-card');
    const pinkCard = await pinkCardTile.boundingBox();
    expect(Math.abs(pinkCard!.y - boxes[2]!.y)).toBeLessThan(1);
    expect(Math.abs(pinkCard!.width - boxes[2]!.width)).toBeLessThan(1);
    expect(Math.abs(pinkCard!.height - boxes[2]!.height)).toBeLessThan(1);
    expect(pinkCard!.x).toBeGreaterThan(boxes[2]!.x + boxes[2]!.width);
    await expect(pinkCardTile).toHaveCSS('background-color', 'rgb(11, 10, 8)');
    const pinkBorderWidth = Number.parseFloat(await pinkCardTile.evaluate(el => getComputedStyle(el).borderTopWidth));
    expect(pinkBorderWidth).toBeGreaterThan(1.5);
    await expect(pinkCardTile).toHaveCSS('border-top-color', 'rgb(255, 79, 200)');
    await expect(pinkCardTile).toHaveCSS('border-radius', '0px');
    await expect(page.getByTestId('button-pink-card-details')).toHaveCSS('border-top-color', 'rgb(255, 79, 200)');
    const launch = await page.locator('.rc-tiles > .st-home-go-live').boundingBox();
    expect(Math.abs(launch!.x - boxes[0]!.x)).toBeLessThan(1);
    expect(Math.abs(launch!.width - (boxes[1]!.x + boxes[1]!.width - boxes[0]!.x))).toBeLessThan(1);
    // Preserve the existing gap below the reward tile; the actual layout is
    // larger than the old 8-10px assertion and must not be tightened here.
    expect(launch!.y - (pinkCard!.y + pinkCard!.height)).toBeGreaterThanOrEqual(24);
    expect(launch!.y - (pinkCard!.y + pinkCard!.height)).toBeLessThanOrEqual(40);
    await expect(page.locator('.rc-tiles .st-home-go-live-button')).toHaveCSS('height', '128px');
    const borders = await Promise.all(['cafe', 'screening', 'arena'].map(s =>
      page.getByTestId(`link-channel-${s}`).evaluate(el => getComputedStyle(el).borderTopColor)));
    expect(borders).toEqual(['rgb(255, 79, 200)', 'rgb(73, 223, 255)', 'rgb(166, 255, 77)']);
    expect(await page.getByTestId('link-channel-cafe').evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
  });
}

test('artwork sizing doubles when possible and clamps without cutting visible edges', () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  pixels[(1 * 4 + 1) * 4 + 3] = 255;
  pixels[(2 * 4 + 2) * 4 + 3] = 255;
  pixels[3] = 1; // Codec noise outside the artwork.
  expect(cauldronArtworkBounds(pixels, 4, 4)).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  expect(cauldronArtworkBounds(new Uint8ClampedArray(64), 4, 4)).toBeNull();
  for (const bounds of [
    { x: 25, y: 147, width: 216, height: 226 },
    { x: 10, y: 40, width: 248, height: 369 },
    { x: 0, y: 0, width: 266, height: 480 },
  ]) for (const width of [117, 154, 200]) {
      const height = width / 1.15;
    const fit = cauldronArtworkFit(266, 480, bounds, width, height);
    const scale = fit.width / 266;
    expect(scale).toBeLessThanOrEqual(2 * Math.min(width / 266, height / 480));
    expect(fit.left + bounds.x * scale).toBeGreaterThanOrEqual(-1e-9);
    expect(fit.top + bounds.y * scale).toBeGreaterThanOrEqual(-1e-9);
    expect(fit.left + (bounds.x + bounds.width) * scale).toBeLessThanOrEqual(width + 1e-9);
    expect(fit.top + (bounds.y + bounds.height) * scale).toBeLessThanOrEqual(height + 1e-9);
  }
  expect(cauldronArtworkFit(100, 100, { x: 40, y: 40, width: 20, height: 20 }, 100, 100).width).toBe(200);
});
