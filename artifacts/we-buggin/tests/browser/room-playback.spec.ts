import { test, expect, type Page } from '@playwright/test';

/** Real Chromium paint traces, not just JavaScript requestAnimationFrame timing. */
async function paintSample(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
    transferMode: 'ReturnAsStream',
  });
  const frames = await page.evaluate(async () => {
    const times: number[] = [];
    await new Promise<void>(resolve => {
      const start = performance.now();
      const frame = (time: number) => {
        times.push(time);
        if (performance.now() - start >= 1600) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return times.slice(1).map((time, index) => time - times[index]!);
  });
  const complete = new Promise<string>(resolve => cdp.once('Tracing.tracingComplete', result => resolve(result.stream!)));
  await cdp.send('Tracing.end');
  const stream = await complete;
  let json = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    json += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  const events = JSON.parse(json).traceEvents as Array<{
    name: string; dur?: number; args?: { data?: { clip?: number[] } };
  }>;
  const paints = events.filter(event => event.name === 'Paint');
  const largePaints = paints.filter(event => {
    const clip = event.args?.data?.clip;
    if (!clip || clip.length !== 8) return false;
    const width = Math.max(clip[0]!, clip[2]!, clip[4]!, clip[6]!) - Math.min(clip[0]!, clip[2]!, clip[4]!, clip[6]!);
    const height = Math.max(clip[1]!, clip[3]!, clip[5]!, clip[7]!) - Math.min(clip[1]!, clip[3]!, clip[5]!, clip[7]!);
    return width >= 380 && height >= 800;
  });
  return {
    paints: paints.length, fullScreenPaints: largePaints.length,
    paintMs: paints.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000,
    frames: frames.length, maxFrameMs: Math.max(...frames),
    meanFrameMs: frames.reduce((sum, value) => sum + value, 0) / frames.length,
  };
}

test('room perimeter paint diagnostic on a CPU-throttled mobile viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/harness.html');
  await expect(page.locator('.ur-perimeter-shine')).toBeVisible();
  await expect(page.locator('.ur-slot')).toHaveCount(8);
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const animated = await paintSample(page);
  await page.locator('.ur-perimeter-shine').evaluate(element =>
    element.getAnimations({ subtree: true }).forEach(animation => animation.pause()));
  const paused = await paintSample(page);
  console.log('ROOM_PAINT_DIAGNOSTIC', JSON.stringify({ animated, paused }));
  await info.attach('room-paint-diagnostic', {
    body: JSON.stringify({ animated, paused }, null, 2), contentType: 'application/json',
  });
  // Old animated SVG: 61 full-screen paints / ~916ms in this window at 4x CPU.
  // Allow incidental room/fixture paints, but reject a return to per-frame raster.
  expect(animated.fullScreenPaints).toBeLessThan(25);
  expect(animated.paintMs).toBeLessThan(350);
});

test('video session survives chat, gifts, mic changes, visibility reconnect and room re-entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const probe = { calls: [] as Array<{ action: string; value?: number | string }>, instances: [] as any[] };
    (window as any).__roomVideoProbe = probe;
    (window as any).YT = {
      Player: class {
        state = 1; muted = true; position = 0; at = Date.now(); id = '';
        options: any;
        constructor(host: HTMLElement, options: any) {
          this.options = options;
          host.replaceChildren(Object.assign(document.createElement('iframe'), { title: 'Controlled YouTube API fixture' }));
          probe.instances.push(this);
          probe.calls.push({ action: 'create' });
          queueMicrotask(() => options.events.onReady({ target: this }));
        }
        loadVideoById(input: any) {
          this.position = input.startSeconds ?? 0; this.at = Date.now(); this.id = input.videoId;
          probe.calls.push({ action: 'load', value: this.position });
          this.options.events.onStateChange({ data: 1, target: this });
        }
        loadPlaylist(input: any) { this.loadVideoById({ videoId: input.playlist?.[0], startSeconds: input.startSeconds }); }
        getCurrentTime() { return this.position + (this.state === 1 ? (Date.now() - this.at) / 1000 : 0); }
        getDuration() { return 3600; }
        getPlayerState() { return this.state; }
        getVideoData() { return { video_id: this.id }; }
        getPlaylist() { return [this.id]; }
        getPlaylistIndex() { return 0; }
        seekTo(seconds: number) { this.position = seconds; this.at = Date.now(); probe.calls.push({ action: 'seek', value: seconds }); }
        mute() { this.muted = true; probe.calls.push({ action: 'mute' }); }
        unMute() { this.muted = false; probe.calls.push({ action: 'unmute' }); }
        isMuted() { return this.muted; }
        setVolume() {}
        setLoop() {}
        unloadModule() {}
        playVideo() { this.state = 1; probe.calls.push({ action: 'play' }); }
        stopVideo() { probe.calls.push({ action: 'stop' }); }
        destroy() { probe.calls.push({ action: 'destroy' }); }
      },
    };
  });
  await page.goto('/tests/browser/harness.html?view=room-playback');
  const calls = () => page.evaluate(() => (window as any).__roomVideoProbe.calls as Array<{ action: string; value?: number | string }>);
  await expect.poll(async () => (await calls()).filter(call => call.action === 'load').length).toBe(1);
  expect(Number((await calls()).find(call => call.action === 'load')!.value)).toBeGreaterThanOrEqual(59);
  const before = await page.evaluate(() => (window as any).__roomVideoProbe.instances[0].getCurrentTime());
  await page.getByRole('button', { name: 'Add fixture chat', exact: true }).click();
  await expect(page.getByTestId('playback-fixture-chat')).toContainText('message 1');
  await page.getByRole('button', { name: 'Toggle fixture mic', exact: true }).click();
  expect((await calls()).at(-1)?.action).toBe('mute');
  await page.getByRole('button', { name: 'Toggle fixture mic', exact: true }).click();
  expect((await calls()).at(-1)?.action).toBe('unmute');
  await page.getByRole('button', { name: 'Queue fixture gift x10', exact: true }).click();
  await expect(page.locator('.gift-combo-hud')).toBeVisible();
  await page.getByRole('button', { name: /skip/i }).click();
  await page.getByRole('button', { name: 'Queue fixture gift x1', exact: true }).click();
  await expect(page.locator('.gift-combo-hud')).toBeVisible();
  await page.getByRole('button', { name: /skip/i }).click();
  await page.context().setOffline(true);
  await page.evaluate(() => {
    const player = (window as any).__roomVideoProbe.instances[0];
    player.position = player.getCurrentTime(); player.at = Date.now(); player.state = 3;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await calls()).filter(call => call.action === 'seek')).toHaveLength(0);
  await page.context().setOffline(false);
  await page.evaluate(() => {
    const player = (window as any).__roomVideoProbe.instances[0];
    player.state = 1; player.at = Date.now();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const active = await calls();
  expect(active.filter(call => call.action === 'create')).toHaveLength(1);
  expect(active.filter(call => call.action === 'load')).toHaveLength(1);
  expect(active.filter(call => ['seek', 'stop', 'destroy'].includes(call.action))).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__roomVideoProbe.instances[0].getCurrentTime())).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Leave fixture room', exact: true }).click();
  expect((await calls()).filter(call => call.action === 'destroy')).toHaveLength(1);
  await page.getByRole('button', { name: 'Join fixture room', exact: true }).click();
  await expect.poll(async () => (await calls()).filter(call => call.action === 'load').length).toBe(2);
  const loads = (await calls()).filter(call => call.action === 'load');
  expect(Number(loads[1]!.value)).toBeGreaterThan(Number(loads[0]!.value));
});
