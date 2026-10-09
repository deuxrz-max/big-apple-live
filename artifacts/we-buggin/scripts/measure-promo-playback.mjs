// One-off performance measurement, not the playlist/sound regression test suite.
// Usage: PROMO_PREVIEW_URL=https://... node .../measure-promo-playback.mjs
import { chromium } from '../../../node_modules/.pnpm/node_modules/playwright/index.mjs';

const base = process.env.PROMO_PREVIEW_URL;
if (!base) throw new Error('PROMO_PREVIEW_URL must point to the running development preview');
const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  for (const mode of ['optimized-playlist', 'original-fourth']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${base}/promo-videos/README.md`);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150,
      downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8,
      connectionType: 'cellular3g',
    });
    await page.evaluate(async (mode) => {
      // Render the actual component in isolation, avoiding unrelated login/API traffic.
      const refresh = (await import('/@react-refresh')).default;
      refresh.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const reactModule = await import('/node_modules/.vite/deps/react.js');
      const React = reactModule.default ?? reactModule;
      const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = domModule.default ?? domModule;
      const { PromoBackground } = await import('/src/chat/PromoBackground.tsx');
      document.body.innerHTML = '<div id="measurement" style="position:fixed;inset:0"></div>';
      window.measurement = { mode, started: performance.now(), events: [], frames: {}, errors: [] };
      const record = (type, el) => {
        window.measurement.events.push({
          type, atMs: Math.round(performance.now() - window.measurement.started),
          file: el.currentSrc.split('/').pop(), currentTime: el.currentTime,
          bufferedUntil: el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0,
          readyState: el.readyState,
        });
      };
      for (const type of ['loadstart', 'loadedmetadata', 'playing', 'waiting', 'stalled', 'ended', 'error']) {
        document.addEventListener(type, (event) => {
          if (!(event.target instanceof HTMLVideoElement)) return;
          record(type, event.target);
          if (type === 'error') window.measurement.errors.push(event.target.error?.message);
        }, true);
      }
      if (mode === 'optimized-playlist') {
        createRoot(document.getElementById('measurement')).render(
          React.createElement(PromoBackground, { soundOn: false, onUnavailableChange: () => {} }));
      } else {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = '/@fs/home/runner/workspace/attached_assets/Project_08-29_Full_HD_1080p_MEDIUM_FR30_1791486565694.mp4';
        document.getElementById('measurement').append(video);
        void video.play().catch(error => window.measurement.errors.push(error.message));
      }
      const el = await new Promise(resolve => {
        const poll = () => document.querySelector('video') ? resolve(document.querySelector('video')) : setTimeout(poll, 10);
        poll();
      });
      window.measurement.codecSupport = el.canPlayType('video/mp4; codecs="avc1.64001f, mp4a.40.2"');
      const frame = (_, metadata) => {
        const file = el.currentSrc.split('/').pop();
        window.measurement.frames[file] = (window.measurement.frames[file] || 0) + 1;
        el.requestVideoFrameCallback(frame);
      };
      el.requestVideoFrameCallback(frame);
    }, mode);
    if (mode === 'optimized-playlist') {
      await page.waitForFunction(() => window.measurement.events.filter(e => e.type === 'ended').length >= 4,
        null, { timeout: 150_000 });
      await page.waitForFunction(() => window.measurement.events.filter(e => e.type === 'playing').length >= 5,
        null, { timeout: 30_000 });
      // Real user gesture enables the original AAC track on the same media element.
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.style.cssText = 'position:fixed;top:0;left:0;z-index:10';
        button.textContent = 'Enable sound';
        button.id = 'sound-measurement';
        button.onclick = () => { const video = document.querySelector('video'); video.muted = false; void video.play(); };
        document.body.append(button);
      });
      await page.locator('#sound-measurement').click();
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(35_000);
    }
    console.log(JSON.stringify(await page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        ...window.measurement,
        elapsedMs: Math.round(performance.now() - window.measurement.started),
        tint: document.querySelector('.promo-background') &&
          getComputedStyle(document.querySelector('.promo-background'), '::after').backgroundColor,
        finalMedia: {
          currentTime: video.currentTime, muted: video.muted, paused: video.paused,
          audioBytesDecoded: video.webkitAudioDecodedByteCount,
          videoFramesDecoded: video.webkitDecodedFrameCount,
          unavailable: document.querySelector('.promo-background')?.dataset.unavailable,
        },
      };
    }), null, 2));
    await context.close();
  }
} finally {
  await browser.close();
}
