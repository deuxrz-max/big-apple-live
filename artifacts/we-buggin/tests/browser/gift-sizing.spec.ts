import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Run the read-only audit-gift-sizing script first. These are copies of actual
// active media, never sent gifts or fixture writes to any real account.
const dir = path.resolve(import.meta.dirname, '../../../../generated-artifacts/gift-sizing-audit');
type Gift = { versionId: string; giftId: string; name: string; backgroundMode: string; durationMs: number; filename: string };
let gifts: Gift[] = [];
try { gifts = JSON.parse(await readFile(path.join(dir, 'inventory.json'), 'utf8')); } catch { /* optional local media audit */ }

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
  test(`custom gift sizing: all active uploads at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.skip(!gifts.length, 'Run the read-only active-media audit first.');
    await page.setViewportSize(viewport);
    let writes = 0;
    page.on('request', req => { if (req.method() !== 'GET') writes++; });
    await page.route('**/api/social/gift-studio/active/**', async route => {
      const gift = gifts.find(g => route.request().url().endsWith(encodeURIComponent(g.giftId)));
      await route.fulfill({ json: { media: gift ? {
        ...gift, webmUrl: `/sizing-media/${gift.versionId}.webm`, safariUrl: `/sizing-media/${gift.versionId}.png`,
      } : null } });
    });
    await page.route('**/sizing-media/*', async route => {
      const filename = new URL(route.request().url()).pathname.split('/').pop()!;
      await route.fulfill({ contentType: filename.endsWith('.webm') ? 'video/webm' : 'image/png', body: await readFile(path.join(dir, filename)) });
    });
    for (const gift of gifts) {
      await page.goto(`/tests/browser/harness.html?view=gift-animation&quantity=1&giftId=${encodeURIComponent(gift.giftId)}`);
      const overlay = page.getByTestId(`gift-studio-animation-${gift.giftId}`);
      const video = overlay.locator('video');
      await expect(video).toBeVisible();
      await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
      const geometry = await video.evaluate(el => {
        const v = el as HTMLVideoElement, box = v.getBoundingClientRect(), s = getComputedStyle(v);
        return { x: box.x, y: box.y, width: box.width, height: box.height,
          fit: s.objectFit, transform: s.transform, blend: s.mixBlendMode, radius: s.borderRadius,
          sourceWidth: v.videoWidth, sourceHeight: v.videoHeight };
      });
      expect(geometry).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height, fit: 'contain', transform: 'none', radius: '0px' });
      expect(geometry.blend).toBe(gift.backgroundMode === 'black' ? 'screen' : 'normal');
      expect(geometry.sourceWidth).toBeGreaterThan(0);
      // Largest uncropped uniform scale must keep the entire source within the screen.
      const scale = Math.min(viewport.width / geometry.sourceWidth, viewport.height / geometry.sourceHeight);
      expect(geometry.sourceWidth * scale).toBeLessThanOrEqual(viewport.width + .01);
      expect(geometry.sourceHeight * scale).toBeLessThanOrEqual(viewport.height + .01);
      if (viewport.width === 390) {
        await video.evaluate(v => { (v as HTMLVideoElement).currentTime = 2; });
        await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).seeking)).toBe(false);
        await page.screenshot({ path: `test-results/gift-sizing-${gift.versionId}.png` });
      }
    }
    expect(writes).toBe(0);
  });
}

test('custom gift sizing: animated-image fallback uses the same full-screen uncropped layout', async ({ page }) => {
  test.skip(!gifts.length, 'Run the read-only active-media audit first.');
  await page.setViewportSize({ width: 390, height: 844 });
  const gift = gifts.find(g => g.name === 'Black Panther')!;
  await page.route('**/api/social/gift-studio/active/**', route => route.fulfill({ json: { media: {
    ...gift, webmUrl: '/sizing-broken.webm', safariUrl: '/sizing-fallback.png',
  } } }));
  await page.route('**/sizing-broken.webm', route => route.abort());
  // Actual extracted alpha frame verifies image geometry; this is not a Safari timing test.
  await page.route('**/sizing-fallback.png', async route => route.fulfill({ contentType: 'image/png', body: await readFile(path.join(dir, `${gift.versionId}.png`)) }));
  await page.goto(`/tests/browser/harness.html?view=gift-animation&quantity=1&giftId=${gift.giftId}`);
  const image = page.getByTestId(`gift-studio-animation-${gift.giftId}`).locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate(el => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, fit: getComputedStyle(el).objectFit };
  })).toEqual({ x: 0, y: 0, w: 390, h: 844, fit: 'contain' });
});
