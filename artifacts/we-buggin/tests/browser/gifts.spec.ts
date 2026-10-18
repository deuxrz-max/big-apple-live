import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 1000 }]) {
  test(`Spirit Pup explicit send clears navigation; transparent media and fallbacks ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let sent = false;
    let calls = 0;
    await page.route('**/api/social/me', async route => {
      const response = await route.fetch();
      const original = await response.json();
      await route.fulfill({ response, json: { ...original,
        wallet: { ...original.wallet, balance: sent ? 100 : 200 },
        gifts: [{ id: 'spirit-pup', name: 'Spirit Pup', cost: 100 }],
      } });
    });
    await page.route('**/api/account/rooms/*/messages**', route => route.fulfill({
      json: [{ id: 'friend-message', roomId: 'promo-regression-room', authorId: 'friend-id',
        username: 'friend', kind: 'text', text: 'Hello.', createdAt: new Date().toISOString() }],
    }));
    await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: sent ? [{
      id: 'gift-receipt-fixture', giftId: 'spirit-pup', senderUsername: 'fixture',
      recipientUsername: 'friend', senderName: 'Fixture', recipientName: 'Friend',
      createdAt: new Date().toISOString(),
    }] : [] } }));
    await page.route('**/api/social/gifts', route => {
      calls++;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ recipient: 'friend', giftId: 'spirit-pup', roomId: 'promo-regression-room' });
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(route.request().headers()['x-room-session']).toBe('synthetic-room-session');
      sent = true;
      return route.fulfill({ json: { balance: 100, earned: 0, received: 0, sent: 100, dailyClaimedAt: null } });
    });
    await page.route('**/api/gift-media/spirit-pup/v1/*', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const body = await readFile(new URL(`../../../../generated-artifacts/spirit-pup/${name}`, import.meta.url));
      const contentType = name.endsWith('.webm') ? 'video/webm' : name.endsWith('.webp') ? 'image/webp' : 'image/png';
      await route.fulfill({ body, contentType });
    });
    await page.goto('/tests/browser/harness.html');
    await page.evaluate(() => {
      Object.assign(document.getElementById('root')!.style, { position: 'relative', zIndex: '1', isolation: 'isolate' });
      const nav = document.createElement('div');
      nav.textContent = 'Home Following Message Me';
      Object.assign(nav.style, { position: 'fixed', bottom: '0', left: '0', width: '100%', height: '68px', zIndex: '5000', background: '#222' });
      document.body.appendChild(nav);
    });
    await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Gift', exact: true }).click();
    const catalogItem = page.getByTestId('gift-catalog-spirit-pup');
    const giftImage = catalogItem.locator('img');
    await expect(giftImage).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(giftImage).toHaveCSS('border-width', '0px');
    await expect(giftImage).toHaveCSS('box-shadow', 'none');
    await expect(catalogItem).toHaveCSS('border-width', '0px');
    await page.getByTestId('gift-catalog-spirit-pup').click();
    await expect(catalogItem).toHaveCSS('background-color', 'rgba(138, 43, 255, 0.16)');
    expect(calls).toBe(0);
    const send = page.getByTestId('gift-bag-send');
    await expect(send).toBeEnabled();
    await expect(send).toHaveText('Send gift');
    expect(await send.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top === el || el.contains(top);
    })).toBe(true);
    await send.click(); // Normal click: no force and no bypass of fixed navigation.
    await expect(page.getByTestId('gift-bag')).toHaveCount(0);
    expect(calls).toBe(1);
    const overlay = page.locator('.spirit-overlay');
    await expect(overlay).toBeVisible();
    const media = overlay.locator('video,img');
    await expect(media).toBeVisible();
    expect(await overlay.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    expect(await media.evaluate(el => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      c.getContext('2d')!.drawImage(el as HTMLVideoElement, 0, 0);
      return c.getContext('2d')!.getImageData(0, 0, 1, 1).data[3];
    })).toBeLessThan(8);
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach(v => { if (!v.closest('.spirit-overlay')) v.pause(); });
      document.getAnimations().forEach(a => a.pause());
    });
    const first = await media.screenshot();
    await page.waitForTimeout(650);
    expect(Buffer.compare(first, await media.screenshot())).not.toBe(0);
    if (await overlay.locator('video').count()) {
      await overlay.locator('video').evaluate(el => el.dispatchEvent(new Event('error')));
    }
    await expect(overlay.locator('img')).toHaveAttribute('src', /animation\.webp$/);
    await overlay.locator('img').evaluate(el => el.dispatchEvent(new Event('error')));
    await expect(overlay.locator('img')).toHaveAttribute('src', /animation\.png$/);
    await expect(overlay.locator('img')).toBeVisible();
    await page.getByTestId('input-message').fill('Unsent gift test draft');
    await expect(page.getByTestId('input-message')).toHaveValue('Unsent gift test draft');
    await page.getByTestId('input-message').fill('');
    await expect(overlay).toHaveCount(0, { timeout: 7000 });
  });
}

test('phone gift bag keeps recipient controls without explanatory empty-state copy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.method()); });
  await page.goto('/tests/browser/harness.html?view=gifts');
  await page.getByTestId('button-open-gift-bag').click();
  await expect(page.getByTestId('gift-bag-title')).toHaveText('Gift bag for Test Recipient');
  await expect(page.getByTestId('gift-bag-title')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByTestId('gift-bag-empty')).toHaveCount(0);
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await expect(page.getByTestId('gift-bag-send')).toHaveText('Send gift');
  await expect(page.getByText(/Choose someone above, or tap a person's name/)).toHaveCount(0);
  await expect(page.getByText(/Your gift bag is empty/)).toHaveCount(0);
  await expect(page.getByText(/Select a person and Spirit Pup or Moonfox/)).toHaveCount(0);
  await expect(page.getByText(/Open a university and choose a person/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  await expect(page.getByTestId('button-open-gift-bag')).toBeFocused();
  expect(writes).toEqual([]);
});

test('premium gift catalog uses transparent still icons and bold panel headings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/social/me', async route => {
    const response = await route.fetch();
    const original = await response.json();
    await route.fulfill({ response, json: { ...original, gifts: [
      { id: 'heart', name: 'Heart', cost: 50 },
      { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
      { id: 'moonfox', name: 'Moonfox', cost: 500 },
      { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 2500 },
      { id: 'fireworks', name: 'Fireworks', cost: 2500 },
      { id: 'rose-shower', name: 'Rose Shower', cost: 2500 },
      { id: 'whip', name: 'Whip', cost: 2500 },
    ] } });
  });
  await page.goto('/tests/browser/harness.html?view=gifts');
  await page.getByTestId('button-open-gift-bag').click();

  for (const [giftId, asset] of [
    ['heart', 'heart.svg'],
    ['fireworks', 'fireworks.png'],
    ['rose-shower', 'rose-shower.png'],
    ['whip', 'whip.png'],
    ['cosmic-encore', 'cosmic-encore.png'],
  ] as const) {
    const image = page.getByTestId(`gift-catalog-${giftId}`).locator('img');
    await expect(image).toHaveAttribute('src', new RegExp(`gift-icons/${asset.replace('.', '\\.')}$`));
    await expect(image).toHaveCSS('width', '64px');
    await expect(image).toHaveCSS('height', '64px');
    const cornerAlpha = await image.evaluate(element => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(element as HTMLImageElement, 0, 0, 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    expect(cornerAlpha).toBeLessThan(8);
  }
  for (const selector of ['.gift-title', '.gift-sub', '.gift-balance', '.gift-catalog-heading']) {
    await expect(page.locator(selector)).toHaveCSS('font-weight', '700');
  }
  expect(await page.locator('[data-testid^="gift-catalog-"]').count()).toBe(7);
});

test('gift control is a silent accessible video and repeats on a 30-second cadence', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      this.dataset.testPlayCalls = String(Number(this.dataset.testPlayCalls || '0') + 1);
      return nativePlay.call(this);
    };
  });
  await page.goto('/tests/browser/harness.html');
  const button = page.getByTestId('button-open-gift-bag');
  await expect(button).toHaveAttribute('aria-label', 'Send a gift');
  await expect(button).toHaveText('');
  const video = button.locator('video');
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(1);
  await expect(video).toBeVisible();
  const transparentCorner = await video.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(element as HTMLVideoElement, 0, 0, 8, 8, 0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] <= 8;
  });
  expect(transparentCorner).toBe(true);
  await expect.poll(() => video.evaluate(element => Number(element.dataset.testPlayCalls ?? '0'))).toBeGreaterThan(0);
  const initialPlayCount = await video.evaluate(element => Number(element.dataset.testPlayCalls ?? '0'));
  await page.clock.fastForward(30_000);
  await expect.poll(() => video.evaluate(element => Number(element.dataset.testPlayCalls ?? '0'))).toBeGreaterThan(initialPlayCount);
});

test('Moonfox can be sent for 500 credits and its room animation keeps transparency and image fallbacks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sent = false;
  let sends = 0;
  await page.route('**/api/social/me', async route => {
    const response = await route.fetch();
    const original = await response.json();
    await route.fulfill({ response, json: {
      ...original,
      wallet: { ...original.wallet, balance: sent ? 500 : 1000 },
      gifts: [
        { id: 'heart', name: 'Heart', cost: 50 },
        { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
        { id: 'moonfox', name: 'Moonfox', cost: 500 },
      ],
    } });
  });
  await page.route('**/api/account/rooms/*/messages**', route => route.fulfill({
    json: [{ id: 'friend-message', roomId: 'promo-regression-room', authorId: 'friend-id',
      username: 'friend', kind: 'text', text: 'Hello.', createdAt: new Date().toISOString() }],
  }));
  await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: sent ? [{
    id: 'moonfox-receipt-fixture', giftId: 'moonfox', senderUsername: 'fixture', recipientUsername: 'friend',
    senderName: 'Fixture', recipientName: 'Friend', createdAt: new Date().toISOString(),
  }] : [] } }));
  await page.route('**/api/social/gifts', route => {
    sends++;
    expect(route.request().postDataJSON()).toMatchObject({
      recipient: 'friend', giftId: 'moonfox', roomId: 'promo-regression-room',
    });
    sent = true;
    return route.fulfill({ json: { balance: 500, earned: 0, received: 250, sent: 500, dailyClaimedAt: null } });
  });
  await page.route('**/api/gift-media/moonfox/v1/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const body = await readFile(new URL(`../../../../generated-artifacts/moonfox/${name}`, import.meta.url));
    const contentType = name.endsWith('.webm') ? 'video/webm' : name.endsWith('.webp') ? 'image/webp' : 'image/png';
    await route.fulfill({ body, contentType });
  });
  await page.goto('/tests/browser/harness.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Gift', exact: true }).click();
  const card = page.getByTestId('gift-catalog-moonfox');
  const giftIds = await page.locator('[data-testid^="gift-catalog-"]').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-testid')));
  expect(giftIds).toEqual(['gift-catalog-heart', 'gift-catalog-spirit-pup', 'gift-catalog-moonfox']);
  await expect(page.getByTestId('gift-catalog-heart')).toContainText('50 coins');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Moonfox');
  await expect(card).toContainText('500 coins');
  const icon = card.locator('img');
  await expect(icon).toBeVisible();
  const iconAlpha = await icon.evaluate(el => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d')!; ctx.drawImage(el as HTMLImageElement, 0, 0, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(iconAlpha).toBeLessThan(8);
  await page.getByTestId('gift-catalog-spirit-pup').waitFor({ state: 'visible' });
  expect(sends).toBe(0);
  await card.click();
  await expect(page.getByTestId('gift-bag-selection')).toContainText('Moonfox for friend');
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  await expect(page.getByTestId('gift-notice-moonfox-receipt-fixture')).toContainText('Fixture sent Friend a Moonfox.');
  expect(sends).toBe(1);

  const overlay = page.getByTestId('moonfox-animation');
  await expect(overlay).toBeVisible();
  const video = overlay.locator('video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.2);
  const firstVideoFrame = await video.screenshot();
  await page.waitForTimeout(350);
  expect(Buffer.compare(firstVideoFrame, await video.screenshot())).not.toBe(0);
  const videoAlpha = await video.evaluate(el => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d')!; ctx.drawImage(el as HTMLVideoElement, 0, 0, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(videoAlpha).toBeLessThan(8);
  await video.dispatchEvent('error');
  const webp = overlay.locator('img');
  await expect(webp).toHaveAttribute('src', /animation\.webp$/);
  await expect(webp).toBeVisible();
  const webpAlpha = await webp.evaluate(el => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d')!; ctx.drawImage(el as HTMLImageElement, 0, 0, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(webpAlpha).toBeLessThan(8);
  const firstWebpFrame = await webp.screenshot();
  await page.waitForTimeout(250);
  expect(Buffer.compare(firstWebpFrame, await webp.screenshot())).not.toBe(0);
  await webp.dispatchEvent('error');
  const apng = overlay.locator('img');
  await expect(apng).toHaveAttribute('src', /animation\.png$/);
  await expect(apng).toBeVisible();
  const apngAlpha = await apng.evaluate(el => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d')!; ctx.drawImage(el as HTMLImageElement, 0, 0, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(apngAlpha).toBeLessThan(8);
  const firstApngFrame = await apng.screenshot();
  await page.waitForTimeout(300);
  expect(Buffer.compare(firstApngFrame, await apng.screenshot())).not.toBe(0);
  await expect(page.getByTestId('input-message')).toBeVisible();
});

test('Heart is a 50-credit first gift and shows its lightweight room animation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sent: Record<string, unknown> | null = null;
  let posted = false;
  await page.route('**/api/social/me', async route => {
    const response = await route.fetch();
    const original = await response.json();
    await route.fulfill({ response, json: {
      ...original,
      wallet: { ...original.wallet, balance: posted ? 5000 : 5050 },
      gifts: [
        { id: 'heart', name: 'Heart', cost: 50 },
        { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
        { id: 'moonfox', name: 'Moonfox', cost: 500 },
      ],
    } });
  });
  await page.route('**/api/account/rooms/*/university-session', route => route.fulfill({ json: {
    people: [
      { participantId: 'self', username: 'fixture', displayName: 'Fixture', photoUrl: null, photoStatus: null, self: true, moderator: false, ignored: false, botId: null },
      { participantId: 'test-1', username: 'testbigo1', displayName: 'Test Bigo 1', photoUrl: null, photoStatus: null, self: false, moderator: false, ignored: false, botId: null },
    ],
    ignoredUsernames: [], topic: 'Test room topic', rulesSeen: true, whispers: [],
  } }));
  await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: posted ? [{
    id: 'heart-receipt-fixture', giftId: 'heart', senderUsername: 'fixture', recipientUsername: 'testbigo1',
    senderName: 'Fixture', recipientName: 'Test Bigo 1', createdAt: new Date().toISOString(),
  }] : [] } }));
  await page.route('**/api/social/gifts', route => {
    sent = route.request().postDataJSON();
    posted = true;
    return route.fulfill({ json: { balance: 5000, earned: 0, received: 0, sent: 50, dailyClaimedAt: null } });
  });

  await page.goto('/tests/browser/harness.html');
  await page.getByTestId('button-open-gift-bag').click();
  const send = page.getByTestId('gift-bag-send');
  await expect(send).toBeDisabled();
  await expect(page.getByTestId('gift-catalog-heart')).toContainText('Heart');
  await expect(page.getByTestId('gift-catalog-heart')).toContainText('50 coins');
  const heartIcon = page.getByTestId('gift-catalog-heart').locator('img');
  await expect(heartIcon).toHaveAttribute('src', /gift-icons\/heart\.svg$/);
  await expect(heartIcon).toHaveCSS('width', '64px');

  await page.getByRole('combobox', { name: 'Gift recipient' }).selectOption('testbigo1');
  await expect(send).toBeDisabled();
  await page.getByTestId('gift-catalog-heart').click();
  await expect(send).toBeEnabled();
  await expect(send).toHaveText('Send gift');
  await page.getByTestId('gift-bag-send').click();
  expect(sent).toMatchObject({
    recipient: 'testbigo1',
    giftId: 'heart',
    roomId: 'promo-regression-room',
  });

  await expect(page.getByTestId('gift-notice-heart-receipt-fixture')).toHaveText('Fixture sent Test Bigo 1 a Heart.');
  const animation = page.getByTestId('heart-animation');
  await expect(animation).toBeVisible();
  expect(await animation.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await animation.locator('.heart-gift-animation').evaluate(element => ({
    animationName: getComputedStyle(element).animationName,
    animationDuration: getComputedStyle(element).animationDuration,
    fontSize: parseFloat(getComputedStyle(element).fontSize),
  }))).toMatchObject({ animationName: 'heart-gift-pop-float', animationDuration: '2s' });
  await expect(animation.locator('video,img')).toHaveCount(0);
  await expect(animation).toHaveCount(0, { timeout: 3000 });
});

test('room gift animations serialize Cosmic Encore and following gifts without duplicates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const orderedGifts = ['cosmic-encore', 'heart', 'spirit-pup', 'moonfox', 'fireworks', 'rose-shower', 'whip'];
  let polls = 0;
  let firstAt: number | undefined;
  await page.route('**/api/social/gifts/rooms/*', route => {
    polls++;
    firstAt ??= Date.now();
    const events = orderedGifts.map((giftId, index) => ({
      id: `queued-${giftId}`,
      giftId,
      senderUsername: 'fixture',
      recipientUsername: 'friend',
      senderName: 'Fixture',
      recipientName: 'Friend',
      createdAt: new Date(firstAt! + index * 100).toISOString(),
    }));
    return route.fulfill({ json: { events: [...events].reverse() } });
  });
  for (const giftId of ['spirit-pup', 'moonfox']) {
    await page.route(`**/api/gift-media/${giftId}/v1/*`, async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
      if (name.endsWith('.webm')) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      const body = await readFile(new URL(`../../../../generated-artifacts/${giftId}/${name}`, import.meta.url));
      await route.fulfill({ body, contentType: name.endsWith('.png') ? 'image/png' : 'image/webp' });
    });
  }
  for (const [giftId, source] of [
    ['fireworks', '../../../../attached_assets/grok_video_2026-10-15-02-42-14_1792047155637.mp4'],
    ['rose-shower', '../../../../attached_assets/grok_video_2026-10-15-02-46-01_1792047164600.mp4'],
    ['whip', '../../../../attached_assets/grok_video_2026-10-15-02-47-47_1792047173579.mp4'],
  ] as const) {
    await page.route(`**/api/gift-media/${giftId}/v1/animation.mp4`, async route => {
      const body = await readFile(new URL(source, import.meta.url));
      await route.fulfill({ body, contentType: 'video/mp4' });
    });
  }

  await page.goto('/tests/browser/harness.html');
  const cosmic = page.getByTestId('cosmic-encore-animation');
  await expect(cosmic).toBeVisible();
  await page.waitForTimeout(2200); // A second polling response must not enqueue copies.
  expect(polls).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('heart-animation')).toHaveCount(0);
  await expect(page.getByTestId('spirit-pup-animation')).toHaveCount(0);
  await expect(page.getByTestId('moonfox-animation')).toHaveCount(0);

  await cosmic.evaluate(element => {
    const media = element.querySelector('video, img');
    media?.dispatchEvent(new AnimationEvent('animationend', {
      bubbles: true,
      animationName: 'cosmic-encore-fade-out',
    }));
  });
  const heart = page.getByTestId('heart-animation');
  await expect(heart).toBeVisible();
  expect(await heart.locator('.heart-gift-animation').evaluate(element => getComputedStyle(element).animationName))
    .toBe('heart-gift-reduced-pulse');
  await expect(cosmic).toHaveCount(0);
  await heart.locator('.heart-gift-animation').evaluate(element =>
    element.dispatchEvent(new AnimationEvent('animationend', { bubbles: true })));

  const spirit = page.getByTestId('spirit-pup-animation');
  await expect(spirit).toBeVisible();
  await expect(page.getByTestId('moonfox-animation')).toHaveCount(0);
  await expect(spirit.locator('img')).toHaveAttribute('src', /animation\.webp$/);
  await spirit.locator('img').dispatchEvent('error');
  await expect(spirit.locator('img')).toHaveAttribute('src', /animation\.png$/);
  await spirit.locator('img').dispatchEvent('error');
  await expect(spirit.getByRole('status')).toContainText('Spirit Pup animation could not load.');
  await expect(spirit.locator('img')).toHaveAttribute('src', /icon\.png$/);
  await spirit.locator('img').dispatchEvent('error');

  const moonfox = page.getByTestId('moonfox-animation');
  await expect(moonfox).toBeVisible();
  await expect(spirit).toHaveCount(0);
  await expect(moonfox.locator('img')).toHaveAttribute('src', /animation\.webp$/);
  await moonfox.locator('img').dispatchEvent('error');
  await expect(moonfox.locator('img')).toHaveAttribute('src', /animation\.png$/);
  await moonfox.locator('img').dispatchEvent('error');
  await expect(moonfox.getByRole('status')).toContainText('Moonfox animation could not load.');
  await expect(moonfox.locator('img')).toHaveAttribute('src', /icon\.png$/);
  await expect(moonfox).toHaveCount(0);
  for (const [giftId, emoji, giftName, position] of [
    ['fireworks', '🎆', 'Fireworks', 'top'],
    ['rose-shower', '🌹', 'Rose Shower', 'full'],
    ['whip', '🏎️', 'Whip', 'bottom'],
  ] as const) {
    const animation = page.getByTestId(`big-tier-${giftId}-animation`);
    await expect(animation).toBeVisible({ timeout: 3000 });
    await expect(animation.locator('.big-tier-gift-banner')).toHaveText(`Fixture sent ${giftName} ${emoji}`);
    await expect(animation).toHaveClass(new RegExp(`big-tier-gift-overlay--${position}`));
    await expect(animation).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const video = animation.locator('video');
    await expect(video).toHaveAttribute('src', new RegExp(`api/gift-media/${giftId}/v1/animation\\.mp4$`));
    await expect(video).toHaveJSProperty('muted', true);
    await expect(video).toHaveJSProperty('playsInline', true);
    await expect(video).toHaveCSS('mix-blend-mode', 'screen');
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await expect(page.locator('[data-testid$="-animation"]')).toHaveCount(1);
    await video.evaluate(element => {
      const player = element as HTMLVideoElement;
      player.pause();
      player.dispatchEvent(new Event('ended'));
    });
    await expect(animation).toHaveCount(0, { timeout: 2000 });
  }
  await expect(page.locator('[data-testid$="-animation"]')).toHaveCount(0);
});

test('real component reads saved inventory, selection cannot transfer or buy', async ({ page }) => {
  await page.route('**/api/social/me', r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      wallet: { balance: 1234 }, inventory: ['rose', 'badge', 'unknown'],
      products: [{ id: 'badge', name: 'Badge', description: 'Cosmetic', cost: 20 }],
      gifts: [{ id: 'rose', name: 'Rose', cost: 10 }, { id: 'unowned', name: 'Unowned', cost: 50 }],
    }),
  }));
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.method()); });
  await page.goto('/tests/browser/harness.html?view=gifts');
  await page.getByTestId('button-open-gift-bag').click();
  await page.getByTestId('gift-item-rose').click();
  await expect(page.getByTestId('gift-bag-selection')).toContainText('Rose for Test Recipient');
  await expect(page.getByTestId('gift-item-unowned')).toHaveCount(0);
  await expect(page.getByTestId('gift-item-badge')).toHaveCount(0);
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await expect(page.getByTestId('gift-bag')).not.toContainText('10 coins');
  expect(writes).toEqual([]);
});

test('room name menu connects Gift, Message and supported public-message Report', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/account/rooms/*/messages**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'friend-message', roomId: 'promo-regression-room', authorId: 'friend-id',
      username: 'friend', kind: 'text', text: 'Hello from a fixture member.', createdAt: new Date().toISOString() }]),
  }));
  await page.goto('/tests/browser/harness.html');
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  for (const action of ['Gift', 'Message', 'Report', 'Block'])
    await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Gift', exact: true }).click();
  await expect(page.getByTestId('gift-bag-title')).toHaveText('Gift bag for friend');
  await expect(page.getByTestId('gift-bag-send')).toBeDisabled();
  await page.getByTestId('gift-bag-close').click();
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
  await expect(page.getByText('Report friend', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for friend', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/messages\/friend$/);
});

test('room Send Gift control lets you choose a person and send directly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sent: Record<string, unknown> | null = null;
  await page.route('**/api/social/me', async route => {
    const response = await route.fetch();
    const original = await response.json();
    await route.fulfill({ response, json: {
      ...original,
      wallet: { ...original.wallet, balance: 5050 },
      gifts: [
        { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
        { id: 'moonfox', name: 'Moonfox', cost: 500 },
      ],
    } });
  });
  await page.route('**/api/account/rooms/*/university-session', route => route.fulfill({ json: {
    people: [
      { participantId: 'self', username: 'fixture', displayName: 'Fixture', photoUrl: null, photoStatus: null, self: true, moderator: false, ignored: false, botId: null },
      { participantId: 'test-1', username: 'testbigo1', displayName: 'Test Bigo 1', photoUrl: null, photoStatus: null, self: false, moderator: false, ignored: false, botId: null },
      { participantId: 'ghost', username: 'ghost-bot', displayName: 'Ghost Bot', photoUrl: null, photoStatus: 'approved', self: false, moderator: true, ignored: false, botId: 'ghost' },
    ],
    ignoredUsernames: [], topic: 'Test room topic', rulesSeen: true, whispers: [],
  } }));
  await page.route('**/api/social/gifts/rooms/*', route => route.fulfill({ json: { events: [] } }));
  await page.route('**/api/social/gifts', route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { balance: 4550, earned: 0, received: 0, sent: 500, dailyClaimedAt: null } });
  });

  await page.goto('/tests/browser/harness.html');
  await page.getByTestId('button-open-gift-bag').click();
  await expect(page.getByTestId('gift-bag-title')).toHaveText('Send a gift');
  const recipient = page.getByRole('combobox', { name: 'Gift recipient' });
  await expect(recipient).toBeVisible();
  await recipient.selectOption('testbigo1');
  await expect(recipient.locator('option')).toHaveCount(3);
  await expect(recipient.locator('option[value="fixture"]')).toHaveText(/Fixture/);
  await page.getByTestId('gift-catalog-moonfox').click();
  await expect(page.getByTestId('gift-bag-selection')).toHaveText('Selected: Moonfox for Test Bigo 1');
  await expect(page.getByTestId('gift-bag-send')).toBeEnabled();
  await page.getByTestId('gift-bag-send').click();
  await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  expect(sent).toMatchObject({
    recipient: 'testbigo1',
    giftId: 'moonfox',
    roomId: 'promo-regression-room',
  });
});
