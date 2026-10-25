import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/mobile-shell.css', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const nav = readFileSync('src/components/bottom-navigation.tsx', 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('mobile shell layer loads after all theme layers', () => {
  const order = ['theme.css', 'dark-app-theme.css', 'depth-ui.css', 'room-black-gold.css', 'mobile-shell.css'].map((f) => app.indexOf(f));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('shell never styles media players or card finish', () => {
  for (const banned of ['video', 'iframe', 'card-surface', 'cfp', 'card-finish', 'backdrop-filter', 'st-live-page {', 'st-live-stage']) {
    assert.ok(!rules.includes(banned), `must not touch ${banned}`);
  }
  assert.ok(!/infinite/.test(rules), 'no continuously running animation');
});

test('shell respects reduced motion, safe areas and touch targets', () => {
  assert.match(rules, /prefers-reduced-motion: reduce/);
  assert.match(rules, /safe-area-inset-bottom/);
  assert.match(rules, /--dw-tap: 44px/);
  assert.match(rules, /max-width: 380px/);
});

test('bottom nav keeps its routes and test ids', () => {
  for (const href of ['/community/favorites', '/community/messages', '/user-portal']) assert.ok(nav.includes(href));
  assert.ok(nav.includes('bottom-nav-${label.toLowerCase()}'));
  assert.ok(nav.includes('OPEN_ROOM_GIFTS_EVENT'));
});

const read = (p: string) => readFileSync(p, 'utf8');

test('Following menu My profile opens Me while the bio editor remains available', () => {
  const social = read('src/social/SocialApp.tsx');
  assert.match(social, /\{ to: '\/user-portal', label: 'My profile', icon: UserRound \}/);
  assert.doesNotMatch(social, /\{ to: '\/community\/profile', label: 'My profile'/);
  assert.match(app, /<Route path="\/user-portal" component=\{OwnProfileRoute\}/);
  assert.match(social, /<Route path="\/community\/profile" component=\{MyProfilePage\}/);
});

test('thread keeps refresh, clear-history, older/latest and send actions', () => {
  const t = read('src/social/MoneyPages.tsx');
  for (const id of ['button-refresh', 'button-clear-history', 'button-confirm-clear', 'button-older', 'button-latest', 'button-send-message', 'link-my-messages', 'menu-thread-actions']) assert.ok(t.includes(id), id);
  assert.ok(t.includes("backHref=\"/user-portal\""), 'transactions back routes to Me');
});

test('landing and home keep sign-in, sign-up, go-live and wallet entries', () => {
  const c = read('src/chat/ChatApp.tsx');
  for (const id of ['link-landing-sign-in', 'link-landing-sign-up', 'section-landing-hero', 'link-home-wallet', 'link-leaderboard', 'button-home-sign-out', 'nav-home-sections', 'button-save-identity', 'menu-edit-profile']) assert.ok(c.includes(id), id);
  assert.ok(c.includes('st-home-go-live-button'));
});

test('owner card finish link stays dev and owner gated', () => {
  const o = read('src/profile/OwnProfile.tsx');
  assert.match(o, /import\.meta\.env\.DEV && access\.data\?\.owner === true && <Link href="\/user-portal\/card-finish"/);
});

test('live dock keeps host controls, gifts and leave', () => {
  const g = read('src/chat/GoLiveScreens.tsx');
  for (const s of ['flipCamera', 'toggleMicrophone', 'Open live gifts', 'live-leave', 'live-end-stream', 'dock-live-controls']) assert.ok(g.includes(s), s);
  const r = read('src/chat/UniversityRoom.tsx');
  assert.ok(r.includes('button-send') && r.includes('<BeamTv ref={beamTvRef}'));
});

test('mobile headers and route transitions prevent inherited scroll and overflow', () => {
  assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/);
  assert.match(css, /width: 100%; min-width: 0; box-sizing: border-box; margin-inline: 0/);
  const chrome = read('src/components/app-chrome.tsx');
  assert.ok(chrome.includes("document.addEventListener('pointerdown', dismiss)"));
  assert.ok(chrome.includes("document.removeEventListener('pointerdown', dismiss)"));
  assert.ok(chrome.includes("e.key !== 'Escape'"));
  const community = read('src/social/SocialApp.tsx');
  assert.ok(community.includes('<ActionMenu label="More pages"'));
  assert.ok(!community.includes('<details className="sc-more-menu">'));
});
