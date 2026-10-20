import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { PROMO_VIDEOS } from '../../src/chat/promo-playlist';
import { nativeVisibilityBrowser } from './native-browser';

// Fail on JS crashes, unexpected API calls, and attempts to leave the isolated
// origin. Asset request failures are permitted only for explicit fault tests.
const test = base.extend<{ isolation: void }>({
  isolation: [async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/api/') && !response.ok())
        errors.push(`Unexpected fixture API response: ${response.status()} ${response.url()}`);
    });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === baseURL) return route.continue();
      errors.push(`Blocked external request: ${route.request().url()}`);
      return route.abort('blockedbyclient');
    });
    await use();
    expect(errors, 'No real APIs/accounts or unexpected fixture failures').toEqual([]);
  }, { auto: true }],
});

const video = (page: Page) => page.getByTestId('promo-video');
const background = (page: Page) => page.getByTestId('promo-background');

for (const width of [320, 390, 1280]) {
  base(`black room and gold edge keep controls and layout intact at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto('/tests/browser/harness.html');
    await expect(page.getByTestId('text-university-name')).toBeVisible();
    await expect(page.locator('.ur-slot')).toHaveCount(8);
    const styles = await page.evaluate(() => {
      const root = document.querySelector('.ch.ur')!;
      const frame = getComputedStyle(root, '::after');
      return {
        backgrounds: ['.ch.ur', '.ur-in', '.ur-body', '.ch-room', '.ur-head', '.ch-comp', '.ch-comp input', '.ur-tv-placeholder', '.ur-slot-media', '.ur-empty-number', '.ur-people-btn', '.ur-rules-btn', '.ch-comp button']
          .map(selector => getComputedStyle(document.querySelector(selector)!).backgroundColor),
        pointerEvents: frame.pointerEvents,
        frame: frame.boxShadow,
        borderWidth: frame.borderWidth,
      };
    });
    expect(styles.backgrounds.every(value => value === 'rgb(0, 0, 0)')).toBe(true);
    expect(styles.pointerEvents).toBe('none');
    expect(styles.frame).toContain('232, 196, 112');
    expect(styles.borderWidth).toBe('0px');
    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector<HTMLStyleElement>('style[data-vite-dev-id$="/room-black-gold.css"]')!.sheet!;
      const measure = () => [...document.querySelectorAll('.ur-in,.ur-head,.ur-slots,.ur-slot,.ch-comp,.ch-room,video,img')]
        .map(element => ({ box: element.getBoundingClientRect().toJSON(), source: element.getAttribute('src') }));
      const themed = measure();
      const shine = document.querySelector<SVGElement>('.ur-perimeter-shine')!;
      shine.style.display = 'none'; // The original room had no decorative SVG.
      sheet.disabled = true;
      const original = measure();
      sheet.disabled = false;
      shine.style.display = '';
      return { themed, original };
    });
    expect(geometry.themed).toEqual(geometry.original);
    // Desktop keeps People in the persistent sidebar instead of the mobile button.
    for (const id of [...(width <= 760 ? ['button-people'] : []), 'button-rules', 'input-message', 'button-send']) {
      const control = page.getByTestId(id);
      await expect(control).toBeInViewport();
      expect(await control.evaluate(element => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
    await page.getByTestId('input-message').fill('Unsent visual-check draft');
    await expect(page.getByTestId('button-send')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('room-black-gold.png') });
    await page.getByTestId('button-rules').click();
    await expect(page.locator('.ur-rules')).toBeVisible();
    await expect(page.locator('.ur-rules')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/tests/browser/harness.html');
    if (width <= 760) await page.getByTestId('button-people').click();
    await expect(page.locator('.ur-side')).toBeVisible();
    await expect(page.locator('.ur-side')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await page.goto('/tests/browser/harness.html');
    await page.getByTestId('button-open-gift-bag').click();
    await expect(page.getByTestId('gift-bag')).toBeVisible();
    await expect(page.getByTestId('gift-bag')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await page.getByTestId('gift-bag-close').click();
    await expect(page.getByTestId('gift-bag')).toHaveCount(0);
  });
}

base('room perimeter shine stays on the edge, runs smoothly, and respects reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html');
  const shine = page.locator('.ur-perimeter-shine');
  await expect(shine).toBeVisible();
  await expect(shine).toHaveCSS('pointer-events', 'none');
  await expect(shine).toHaveAttribute('aria-hidden', 'true');
  expect(await shine.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  const tip = shine.locator('.ur-perimeter-tip');
  const before = await tip.evaluate(element => getComputedStyle(element).strokeDashoffset);
  const metrics = await page.evaluate(async () => {
    const times: number[] = [];
    await new Promise<void>(resolve => {
      const frame = (time: number) => {
        times.push(time);
        if (times.length === 46) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const intervals = times.slice(1).map((time, index) => time - times[index]!);
    return {
      averageMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      longestMs: Math.max(...intervals),
      animations: document.querySelector('.ur-perimeter-shine')!.getAnimations({ subtree: true }).map(animation => {
        const timing = animation.effect!.getTiming();
        return { duration: timing.duration, easing: timing.easing, iterations: timing.iterations };
      }),
    };
  });
  expect(await tip.evaluate(element => getComputedStyle(element).strokeDashoffset)).not.toBe(before);
  expect(metrics.animations).toHaveLength(4);
  for (const animation of metrics.animations) {
    expect(animation).toEqual({ duration: 12000, easing: 'linear', iterations: Infinity });
  }
  expect(metrics.averageMs).toBeLessThan(50);
  expect(metrics.longestMs).toBeLessThan(250);
  await info.attach('emulated-phone-frame-timing', { body: JSON.stringify(metrics), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('moving-gold-perimeter.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(shine).toBeHidden();
  expect(await page.locator('.ch.ur').evaluate(element => getComputedStyle(element, '::after').boxShadow)).toContain('232, 196, 112');
  await page.getByTestId('button-rules').click();
  await expect(page.locator('.ur-rules')).toBeVisible();
});

base('black and gold room styling does not change the Store', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?view=store');
  await expect(page.locator('.ch.ur')).toHaveCount(0);
  await expect(page.locator('.ur-perimeter-shine')).toHaveCount(0);
  const colors = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLStyleElement>('style[data-vite-dev-id$="/room-black-gold.css"]')!.sheet!;
    const measure = () => [document.body, document.querySelector('.app-page')!, document.querySelector('.app-bottom-nav')!]
      .map(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).background }));
    const enabled = measure();
    sheet.disabled = true;
    const disabled = measure();
    sheet.disabled = false;
    return { enabled, disabled };
  });
  expect(colors.enabled).toEqual(colors.disabled);
});

async function codecs(page: Page, info: TestInfo) {
  const support = await page.evaluate(() => {
    const el = document.createElement('video');
    return {
      avc: el.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      aac: el.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      userAgent: navigator.userAgent,
    };
  });
  await info.attach('codec-support', { body: JSON.stringify(support, null, 2), contentType: 'application/json' });
  return support;
}

async function playable(page: Page, info: TestInfo, view = 'room') {
  await page.goto(`/tests/browser/harness.html?view=${view}`);
  const support = await codecs(page, info);
  test.skip(!support.avc || !support.aac, 'Browser cannot decode the real H.264/AAC uploads; see codec-support attachment');
  await expect(background(page)).toHaveAttribute('data-playlist-index', '0');
  await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
}

async function rememberElement(page: Page) {
  await video(page).evaluate(el => {
    (window as unknown as { originalPromoVideo: Element }).originalPromoVideo = el;
  });
}

async function samePlayingElement(page: Page, index: number, muted: boolean) {
  await expect(background(page)).toHaveAttribute('data-playlist-index', String(index), { timeout: 70_000 });
  await expect(video(page)).toHaveCount(1);
  await expect.poll(() => video(page).evaluate((el, expectedMuted) => {
    const v = el as HTMLVideoElement;
    return {
      same: el === (window as unknown as { originalPromoVideo: Element }).originalPromoVideo,
      muted: v.muted === expectedMuted, playing: !v.paused && v.currentTime > 0.1,
      decoded: v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > 0,
      inline: v.playsInline, nativeLoop: v.loop,
    };
  }, muted)).toEqual({ same: true, muted: true, playing: true, decoded: true, inline: true, nativeLoop: false });
  await expect(video(page)).toHaveAttribute('src', `/promo-videos/${PROMO_VIDEOS[index].file}`);
}

test('codec preflight explicitly requires AVC and AAC', async ({ page }, info) => {
  await page.goto('/tests/browser/harness.html?view=player');
  const support = await codecs(page, info);
  test.skip(process.env.PROMO_ALLOW_CODEC_SKIP === '1' && (!support.avc || !support.aac),
    'Explicitly allowed unsupported-codec run; media checks are not passes');
  expect(support.avc, 'Choose a Chromium build with H.264 support (PROMO_CHROMIUM_PATH)').not.toBe('');
  expect(support.aac, 'Choose a Chromium build with AAC support (PROMO_CHROMIUM_PATH)').not.toBe('');
});

test('real uploads complete naturally in order, wrap, and keep one muted element', async ({ page }, info) => {
  await playable(page, info, 'player');
  await rememberElement(page);
  await samePlayingElement(page, 0, true);
  await video(page).evaluate(el => {
    const v = el as HTMLVideoElement;
    const observations: { file: string; trusted: boolean; time: number; duration: number }[] = [];
    (window as unknown as { promoCompletions: typeof observations }).promoCompletions = observations;
    v.addEventListener('ended', event => observations.push({
      file: new URL(v.currentSrc).pathname.split('/').at(-1)!,
      trusted: event.isTrusted, time: v.currentTime, duration: v.duration,
    }));
  });
  for (const index of [1, 2, 3, 0]) await samePlayingElement(page, index, true);
  const completions = await page.evaluate(() =>
    (window as unknown as { promoCompletions: { file: string; trusted: boolean; time: number; duration: number }[] }).promoCompletions);
  expect(completions.map(c => c.file)).toEqual(PROMO_VIDEOS.map(v => v.file));
  for (const c of completions) {
    expect(c.trusted, 'Not a dispatched ended event').toBe(true);
    expect(c.time).toBeCloseTo(c.duration, 1);
  }
});

test('room enters muted; sound on and off each survive natural clip changes', async ({ page }, info) => {
  await playable(page, info);
  const sound = page.getByTestId('button-background-sound');
  await rememberElement(page);
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await samePlayingElement(page, 0, true);
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await samePlayingElement(page, 0, false);
  await samePlayingElement(page, 1, false);
  await expect(sound).toHaveAccessibleName('Turn background sound off');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await samePlayingElement(page, 1, true);
  await samePlayingElement(page, 2, true);
  await expect(sound).toHaveAccessibleName('Turn background sound on');
});

test('a failed upload is skipped and is not retried on wraparound', async ({ page }, info) => {
  let failures = 0;
  await page.route(`**/promo-videos/${PROMO_VIDEOS[0].file}`, route => { failures++; return route.abort('failed'); });
  await page.goto('/tests/browser/harness.html');
  const support = await codecs(page, info);
  test.skip(!support.avc || !support.aac, 'Real playback requires H.264/AAC');
  await expect(background(page)).toHaveAttribute('data-playlist-index', '1');
  await rememberElement(page);
  for (const index of [1, 2, 3, 1]) await samePlayingElement(page, index, true);
  expect(failures).toBe(1);
  await expect(page.getByTestId('button-background-sound')).toBeEnabled();
});

test('all upload failures settle to dark fallback and disable sound', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/promo-videos/*.mp4', route => {
    requested.push(new URL(route.request().url()).pathname);
    return route.abort('failed');
  });
  await page.goto('/tests/browser/harness.html');
  await expect(background(page)).toHaveAttribute('data-unavailable', 'true');
  await expect(video(page)).toHaveCount(0);
  expect([...requested].sort()).toEqual(PROMO_VIDEOS.map(v => `/promo-videos/${v.file}`).sort());
  await expect(page.getByTestId('button-background-sound')).toBeDisabled();
  await expect(page.getByTestId('button-background-sound')).toHaveText('Sound unavailable');
  expect(await background(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(5, 5, 5)');
  const count = requested.length;
  await page.waitForTimeout(1000);
  expect(requested.length).toBe(count);
  await expect(page.getByTestId('input-message')).toBeVisible();
});

test('reduced motion enters without video and disables sound', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/browser/harness.html');
  await expect(video(page)).toHaveCount(0);
  await expect(background(page)).toHaveAttribute('data-unavailable', 'true');
  await expect(page.getByTestId('button-background-sound')).toBeDisabled();
});

test('changing reduced motion pauses and restores real playback', async ({ page }, info) => {
  await playable(page, info);
  const oldVideo = await video(page).elementHandle();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(video(page)).toHaveCount(0);
  expect(await oldVideo!.evaluate(el => (el as HTMLVideoElement).paused)).toBe(true);
  await expect(page.getByTestId('button-background-sound')).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect(page.getByTestId('button-background-sound')).toBeEnabled();
  await expect(video(page)).toHaveCount(1);
  expect(await video(page).evaluate(el => (el as HTMLVideoElement).muted)).toBe(true);
});

test('real tab hiding pauses playback and return resumes the same clip', async ({ baseURL }, info) => {
  test.skip(process.env.PROMO_HEADLESS === '1', 'Headless Chromium does not hide background tabs; run headed/Xvfb');
  const native = await nativeVisibilityBrowser();
  const { page, context } = native;
  let passed = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === baseURL) return route.continue();
    errors.push(`Blocked external request: ${route.request().url()}`);
    return route.abort('blockedbyclient');
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/api/') && !response.ok())
      errors.push(`Unexpected fixture API response: ${response.status()}`);
  });
  try {
    await page.goto(`${baseURL}/tests/browser/harness.html`);
    const support = await codecs(page, info);
    test.skip(!support.avc || !support.aac, 'Real playback requires H.264/AAC');
    await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
    await rememberElement(page);
    // A user-opened _blank link creates a real tab, not Playwright's new window.
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'about:blank'; a.target = '_blank'; a.textContent = 'Visibility test tab';
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:1000;background:white;color:black';
      document.body.append(a);
    });
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Visibility test tab' }).click();
    const other = await opened;
    await other.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).paused)).toBe(true);
    const before = await video(page).evaluate(el => (el as HTMLVideoElement).currentTime);
    await page.waitForTimeout(600);
    expect(await video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBeCloseTo(before, 2);
    await expect(background(page)).toHaveAttribute('data-playlist-index', '0');
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    await samePlayingElement(page, 0, true);
    await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(before);
    await other.close();
    expect(errors).toEqual([]);
    passed = true;
  } finally {
    if (!passed) {
      if (!page.isClosed())
        await info.attach('native-visibility-screen', { body: await page.screenshot(), contentType: 'image/png' });
    }
    await native.close();
  }
});

for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`phone ${size.width}px header and composer clear navigation and remain usable`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/tests/browser/harness.html');
    await expect(page.getByTestId('text-university-name')).toHaveAccessibleName('Playlist Regression University');
    await expect(page.getByTestId('list-messages').locator('.ch-msg')).toHaveCount(60);
    const title = await page.locator('.ur-head').boundingBox();
    const sound = await page.getByTestId('button-background-sound').boundingBox();
    const log = await page.getByTestId('list-messages').boundingBox();
    const composer = await page.locator('.ch-comp').boundingBox();
    const nav = await page.locator('.app-bottom-nav').boundingBox();
    for (const rect of [title, sound, log, composer, nav]) expect(rect).not.toBeNull();
    expect(title!.y).toBeGreaterThanOrEqual(0);
    expect(title!.y + title!.height).toBeLessThanOrEqual(sound!.y + 1);
    expect(sound!.y + sound!.height).toBeLessThanOrEqual(log!.y + 1);
    expect(log!.y + log!.height).toBeLessThanOrEqual(composer!.y + 1);
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(nav!.y);
    for (const id of ['button-people', 'button-rules', 'input-message', 'button-send']) {
      const el = page.getByTestId(id);
      await expect(el).toBeInViewport({ ratio: 1 });
      expect(await el.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
    await page.getByTestId('input-message').fill('Fixture-only unsent draft');
    await expect(page.getByTestId('button-send')).toBeEnabled();
    // Scroll history only; title and composer must not shift offscreen.
    await page.getByTestId('list-messages').evaluate(el => { el.scrollTop = 0; });
    expect(await page.locator('.ur-head').boundingBox()).toEqual(title);
    expect(await page.locator('.ch-comp').boundingBox()).toEqual(composer);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
