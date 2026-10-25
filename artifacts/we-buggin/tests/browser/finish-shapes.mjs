// Browser-local component/CSS regression. No sign-in, real account, camera or API mutation.
// Run from artifacts/we-buggin: node tests/browser/finish-shapes.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const writes = [];
  await page.route('**/api/**', async (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('http://localhost:80/');
  await page.getByRole('heading', { name: /find your people/i }).waitFor();
  // Resolve Vite's optimized deps (with their current ?v= hash) from the live module graph, never
  // by string-guessing, so a re-optimized cache after restart cannot leave a stale URL.
  const source = (await Promise.all(['/src/chat/GoLiveScreens.tsx', '/src/main.tsx']
    .map(async (path) => (await page.request.get(`http://localhost:80${path}`)).text()))).join('\n');
  const dependency = (filename) => {
    const path = [...source.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((match) => match[1]).find((path) => path.includes(`/${filename}?`));
    assert.ok(path, `Vite dependency ${filename}`);
    return path;
  };
  // Only this cache-busted test module gets a synthetic user and read-only profile hook.
  // Normal app modules and authentication remain unchanged.
  await page.route('**/src/chat/GoLiveScreens.tsx?shape-fixture=*', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const changed = original
      .replace(/import\s*\{\s*useUser\s*\}\s*from\s*["'][^"']+["'];?/, 'const useUser = () => ({ user: { id: "synthetic-shape-only" } });')
      .replaceAll('useGetSocialMe()', '({ data: { profile: { username: "synthetic-shape-only", displayName: "Shape fixture" } }, isLoading: false })');
    assert.notEqual(changed, original);
    await route.fulfill({ response, body: changed, contentType: 'text/javascript' });
  });
  await page.evaluate(async (urls) => {
    const R = await import(urls.react), Q = await import(urls.query), W = await import(urls.router), I = await import(urls.icons);
    const React = R.default ?? R;
    const D = await import(urls.dom);
    const { GoLiveButton } = await import('/src/chat/GoLiveScreens.tsx?shape-fixture=1');
    const { hostLiveSession } = await import('/src/chat/liveSessionController.ts');
    window.__launches = [];
    hostLiveSession.start = async (username) => { window.__launches.push(username); };
    const old = document.getElementById('root');
    old.id = 'original-hidden-app';
    old.style.display = 'none';
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    document.body.classList.add('streamtalk-directory-screen');
    const h = React.createElement;
    const tile = h(GoLiveButton, { className: 'st-home-go-live-button' },
      h('span', { className: 'st-home-go-live-icon' }, h(I.Camera, { size: 31, strokeWidth: 1.8 })),
      h('span', { className: 'st-home-go-live-copy' },
        h('strong', null, 'Go Live'), h('small', null, 'Start your own room')));
    const nav = h('nav', { className: 'app-bottom-nav' },
      h('div', { className: 'app-bottom-nav-inner has-home-live' },
        ...['Home', 'Following'].map((name) => h('a', { className: 'app-bottom-link', key: name }, name)),
        h(GoLiveButton, { className: 'app-home-live' }, h(I.Camera, { size: 22 }), h('span', { className: 'sr-only' }, 'Go live now')),
        ...['Message', 'Me'].map((name) => h('a', { className: 'app-bottom-link', key: name }, name))));
    const card = h('article', { className: 'st-dir-card' },
      h('div', { className: 'st-dir-art' }),
      h('div', { className: 'st-dir-card-copy' }, h('h3', null, 'Synthetic room card')));
    function Fixture() {
      const [path, setPath] = React.useState('/');
      window.__fixturePath = path;
      return h(W.Router, { hook: () => [path, setPath] },
        h('main', { className: 'ch st-home' },
          h('h1', null, 'Actual GoLiveButton / synthetic profile'),
          h('div', { className: 'st-home-grid' },
            h('ul', { className: 'st-home-grid-column' }, h('li', null, card)),
            h('ul', { className: 'st-home-grid-column' }, h('li', { className: 'st-home-go-live' }, tile)))),
        nav);
    }
    (D.createRoot ?? D.default.createRoot)(root).render(
      h(Q.QueryClientProvider, { client: new Q.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(Fixture)));
  }, {
    react: dependency('react.js'), dom: dependency('react-dom_client.js'), query: dependency('@tanstack_react-query.js'),
    router: dependency('wouter.js'), icons: dependency('lucide-react.js'),
  });
  await page.locator('.st-home-go-live-button').waitFor();
  await mkdir('/tmp/deux-finish-shapes', { recursive: true });
  for (const [width, height] of [[360, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
      const tile = document.querySelector('.st-home-go-live-button');
      return {
        tile: box('.st-home-go-live-button'), room: box('.st-dir-card'),
        icon: box('.st-home-go-live-icon'), title: box('.st-home-go-live-copy strong'),
        copy: box('.st-home-go-live-copy small'), camera: box('.app-home-live'),
        radius: getComputedStyle(tile).borderRadius,
        color: getComputedStyle(document.querySelector('.st-home-go-live-copy strong')).color,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await page.screenshot({ path: `/tmp/deux-finish-shapes/home-${width}.png` });
    assert.ok(Math.abs(geometry.tile.width - geometry.room.width) < 1);
    assert.ok(Math.abs(geometry.tile.height - geometry.room.height) < 1);
    assert.equal(geometry.radius, '0px');
    assert.equal(geometry.color, 'rgb(243, 213, 138)');
    assert.ok(geometry.icon.bottom < geometry.title.top);
    assert.ok(geometry.copy.bottom < geometry.tile.bottom - 4);
    assert.ok(Math.abs(geometry.camera.width - geometry.camera.height) < 1);
    assert.equal(geometry.overflow, false);
    await page.locator('.st-home-go-live-button').tap();
    await page.getByTestId('dialog-go-live-choice').waitFor();
    assert.ok(await page.getByTestId('button-start-live-broadcast').isEnabled());
    assert.ok(await page.getByTestId('button-create-social-room').isEnabled());
    await page.getByRole('button', { name: 'Close choices' }).tap();
    await page.locator('.app-home-live').tap();
    await page.getByTestId('dialog-go-live-choice').waitFor();
    await page.getByTestId('button-start-live-broadcast').tap();
    assert.equal(await page.evaluate(() => window.__fixturePath), '/live/start');
    console.log(`PASS ${width}x${height}: equal room/launch card dimensions ${Math.round(geometry.tile.width)}x${Math.round(geometry.tile.height)}, readable separated text, tile + nav launch chooser, Go Live routing`);
  }
  // Representative real stylesheet classes, not claims of signed-in page journeys.
  const probes = await page.evaluate(() => {
    const rectangular = [
      'pf-edit', 'pf-btn', 'sc-nav-item', 'st-search', 'st-room-choice-option',
      'ur-social-profile-popup', 'ur-rules', 'dw-card-test-countdown', 'gift-room-panel',
      'gift-panel-card', 'gift-panel-owned-card', 'gift-panel-send', 'gift-panel-secondary',
      'sc-thread-bar', 'pf-dialog', 'pf-modal', 'st-live-end',
      'dw-card-fan-back', 'dw-jk-bar', 'gs-panel', 'st-live-action-sheet',
    ];
    const boxes13 = ['ur-slot', 'bm-mic-tile', 'bm-seat'];
    const circles = ['ur-person-avatar', 'st-live-avatar',
      'ib-avatar', 'gift-panel-avatar', 'pf-round'];
    return [...rectangular, ...boxes13, ...circles].map((name) => {
      const element = document.createElement(['pf-edit', 'sc-nav-item', 'app-bottom-link'].includes(name) ? 'a' : 'button');
      element.className = name;
      element.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:220px';
      if (name === 'pf-round') element.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px';
      if (name === 'dw-jk-bar') element.append(document.createElement('button'));
      document.getElementById('root').append(element);
      const target = name === 'dw-jk-bar' ? element.firstElementChild : element;
      const computed = getComputedStyle(target), rect = element.getBoundingClientRect();
      const result = { name, box13: boxes13.includes(name), circle: circles.includes(name), radius: computed.borderRadius, width: rect.width, height: rect.height };
      element.remove();
      return result;
    });
  });
  const shapeFailures = probes.filter((p) => p.radius !== '0px');
  assert.deepEqual(shapeFailures, [], 'all component shape probes');
  // Real nine-seat grid: actual .ur-slots five-column CSS, actual arrangeVideoBeamSeats placement
  // (host spans both rows of the centre column), actual seat markup classes. Host occupied, guests 2-9 empty.
  for (const [width, height] of [[360, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const seats = await page.evaluate(async () => {
      const { arrangeVideoBeamSeats } = await import('/src/chat/video-beam-seat-layout.ts');
      const slots = Array.from({ length: 9 }, (_, i) => ({ slotNumber: i + 1, participantId: i === 0 ? 'host' : null }));
      const room = document.createElement('div');
      room.className = 'ch ch-university ur';
      room.innerHTML = '<div class="ch-room ur-social-room"><section class="ur-beam is-social-room"><div class="ur-slots" data-count="1" data-tv="off" style="height:300px"></div></section></div>';
      const grid = room.querySelector('.ur-slots');
      for (const { slot, area, gridColumn, gridRow } of arrangeVideoBeamSeats(slots, 'host')) {
        const host = area === 'host';
        const seat = document.createElement('article');
        seat.className = `ur-slot${host ? ' is-occupied has-person is-beam-host' : ''}`;
        seat.dataset.seatPosition = area;
        seat.style.gridColumn = String(gridColumn);
        seat.style.gridRow = host ? '1 / span 2' : String(gridRow);
        seat.innerHTML = host
          ? '<div class="ur-slot-media"><div class="ur-slot-portrait-layer"><div class="ur-slot-portrait"></div></div><button type="button" class="ur-slot-avatar-button ur-slot-photo-action"></button><div class="ur-slot-copy"><span class="ur-slot-name-line"><span class="ur-slot-name">Host</span></span></div></div>'
          : `<div class="ur-slot-media" role="button" tabindex="0"><div class="ur-slot-empty-copy"><span class="ur-empty-number">${slot.slotNumber}</span><span class="ur-slot-name ur-empty-name">Tap to join</span></div></div>`;
        grid.append(seat);
      }
      document.getElementById('root').append(room);
      const out = [...grid.children].map((seat) => {
        const a = seat.getBoundingClientRect(), label = seat.querySelector('.ur-empty-name');
        const portrait = seat.querySelector('.ur-slot-portrait');
        const r = { pos: seat.dataset.seatPosition, w: a.width, h: a.height, radius: getComputedStyle(seat).borderRadius,
          portraitRadius: portrait ? getComputedStyle(portrait).borderRadius : null, fits: true };
        if (label) {
          const b = label.getBoundingClientRect();
          r.fits = label.scrollWidth <= label.clientWidth + 1 && label.textContent === 'Tap to join'
            && b.left >= a.left - 0.5 && b.right <= a.right + 0.5 && b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5;
        }
        return r;
      });
      room.remove();
      return out;
    });
    assert.equal(seats.length, 9);
    const host = seats.find((s) => s.pos === 'host'), guests = seats.filter((s) => s.pos !== 'host');
    assert.ok(guests.every((g) => host.w > g.w && host.h > g.h), 'centre host larger than guests');
    assert.ok(seats.every((s) => s.radius === '0px'), `square seat boxes: ${seats.map((s) => s.radius)}`);
    assert.notEqual(host.portraitRadius, '50%', 'full-seat portrait follows box, not circle');
    assert.deepEqual(guests.filter((g) => !g.fits).map((g) => g.pos), [], `Tap to join contained at ${width}px`);
    console.log(`PASS ${width}px real 5-column seat grid: host ${Math.round(host.w)}x${Math.round(host.h)}, 8 guests contain full Tap to join, square boxes`);
  }
  // Shared rectangular policy covers room controls, panels and composers.
  const compact = await page.evaluate(() => ['ur-people-btn', 'ur-rules-btn', 'ch-msg', 'ur-arrival-line', 'dw-room-composer',
    'ch-comp', 'app-bottom-link', 'gift-control'].map((name) => {
    const el = document.createElement('button'); el.className = name; el.style.cssText = 'height:28px;width:90px';
    document.getElementById('root').append(el);
    const r = getComputedStyle(el).borderRadius; el.remove(); return { name, r };
  }));
  assert.deepEqual(compact.filter((c) => c.r !== '0px'), [], 'compact controls use square boxes');
  const form = await page.evaluate(() => {
    const f = document.createElement('form'); f.className = 'ch-comp dw-room-composer';
    f.innerHTML = '<input><button type="submit">Send</button>'; document.getElementById('root').append(f);
    const r = [f, ...f.children].map((e) => getComputedStyle(e).borderRadius); f.remove(); return r;
  });
  assert.deepEqual(form, ['0px', '0px', '0px'], 'composer wrapper, input and Send are square boxes');
  assert.equal(writes.length, 0, 'no API mutations');
  assert.equal((await page.evaluate(() => window.__launches)).length, 2);
  console.log(`PASS ${probes.length} cross-screen shape/CSS probes; zero API mutations, no real broadcast/camera started.`);
} finally {
  await browser.close();
}
