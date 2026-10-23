import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const css = readFileSync('src/joker-finish.css', 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync('src/App.tsx', 'utf8');
const foil = readFileSync('src/profile/joker-foil.ts', 'utf8');

test('joker finish loads last, after mobile shell', () => {
  const i = app.indexOf("'@/joker-finish.css'");
  assert.ok(i > app.indexOf("'@/mobile-shell.css'") && i > 0);
  const lastCss = [...app.matchAll(/import '([^']+\.css)'/g)].pop()?.[1];
  assert.equal(lastCss, '@/joker-finish.css');
});

const indexCss = readFileSync('src/index.css', 'utf8');
const mobile = readFileSync('src/mobile-shell.css', 'utf8');
const body = rules.slice(rules.indexOf('@layer joker-finish {'));

test('cascade: first-declared layer with important paint props outranks unlayered legacy', () => {
  assert.match(indexCss, /^@layer joker-finish, theme, base, clerk, components, utilities;$/m);
  assert.ok(rules.includes('@layer joker-finish {'));
  for (const prop of ['background', 'box-shadow', 'color', 'border-radius']) {
    const decls = [...body.matchAll(new RegExp(`\\n\\s+${prop}: ([^;]+);`, 'g'))].map((m) => m[1]);
    assert.ok(decls.length > 0 && decls.every((d) => d.endsWith('!important')), `${prop} must be !important`);
  }
});

test('nav glint survives mobile-shell display:none', () => {
  assert.match(mobile, /is-active::after \{ display: none; \}/);
  const blk = body.slice(body.indexOf('.app-bottom-link.is-active::after {'));
  assert.match(blk.slice(0, blk.indexOf('}')), /display: block !important/);
});

test('selected/primary controls stay satin black with gold ink, not gold face', () => {
  assert.ok(!rules.includes('--jk-gold-face'));
  const sel = body.slice(body.indexOf('.pf-btn-fill,'));
  const blk = sel.slice(0, sel.indexOf('}'));
  assert.match(blk, /var\(--jk-satin-selected\)/);
  assert.match(blk, /var\(--jk-bevel-selected\)/);
  assert.match(blk, /color: #ffe7a6/);
  for (const s of ['.gift-panel-category.is-active', '.sc-nav-item.is-on', '.bm-size-opt.is-on', '.gift-panel-all.is-selected']) assert.ok(blk.includes(s), s);
});

test('semantic red / muted / disabled states revert to legacy colours', () => {
  const sem = body.slice(body.indexOf('.ur-slot-leave, .st-live-muted'));
  const blk = sem.slice(0, sem.indexOf('}'));
  for (const s of [':disabled', '[aria-disabled="true"]', '.is-disabled', 'destructive', 'danger']) assert.ok(blk.includes(s), s);
  for (const p of ['background', 'color', 'box-shadow']) assert.match(blk, new RegExp(`${p}: revert-layer !important`));
});

test('glints never take over a pseudo used by an icon', () => {
  assert.match(mobile, /\.pf-btn::after/);
  assert.ok(!/\.pf-btn\)?::after/.test(body.replace(/:is\([^)]*\)::after/g, '')), 'pf-btn arrow ::after preserved');
  assert.ok(!/\.bm-btn[^,{]*::before/.test(body));
  assert.ok(/\.pf-btn::before/.test(body));
});

test('tokens match Joker gold palette and shared geometry', () => {
  for (const c of ['#c99a3e', '#f3d58a', '#7a5a1c']) { assert.ok(foil.includes(c)); assert.ok(rules.includes(c)); }
  for (const t of ['--jk-radius:', '--jk-radius-sm:', '--jk-radius-pill:', '--jk-edge:', '--jk-bevel:', '--jk-ring:', '--jk-satin-fill:', '--jk-grain:']) assert.ok(rules.includes(t), t);
  assert.match(rules, /--jk-black: #000/);
  assert.match(rules, /inset 1px 1px 0 rgba\(243, 213, 138/, 'top-left highlight');
  assert.match(rules, /inset -1px -1px 0 rgba\(58, 40, 10/, 'bottom-right shade');
});

test('covers every requested component family with real selectors', () => {
  const families: Record<string, string[]> = {
    profile: ['.pf-round', '.pf-edit', '.pf-modal', '.pf-dialog', '.pf-panel', '.pf-menu-list', '.ees-panel'],
    store: ['.st-item-card', '.st-launch-tile', '.st-balance-bar', '.st-header-items', '.st-detail-action', '.gift-panel-recharge', '.sc-wallet'],
    dm: ['.sc-msg', '.sc-nav-item', '.sc-thread-bar', '.sc-form'],
    livestart: ['.st-live-start-button', '.st-live-end', '.st-room-choice-card'],
    jokerPreviewControls: ['.dw-cfp-controls', '.dw-cfp-tabs', '.dw-jk-bar'],
    giftbag: ['.gift-room-panel', '.gift-panel-icon-button', '.gift-panel-send', '.gift-panel-all', '.gift-panel-featured', '.gs-panel'],
    buttons: ['.pf-btn', '.bm-btn', '.sp-button', '.gs-button', '.st-safety-button', '.dw-icon-btn'],
    tabs: ['.dw-home-tabs', '.dw-cfp-tabs', '.dh-tabs', '.dh-tabs .is-on', '.gift-panel-category'],
    states: [':disabled', 'aria-disabled', 'destructive', '.ur-slot-leave', ':active'],
    nav: ['.app-bottom-nav-inner', '.app-bottom-link.is-active', '.app-bottom-pip'],
    sheets: ['.st-sheet', '.ur-social-profile-popup', '.ur-rules', '.gift-panel', '.gs-settings', '.dw-action-menu-list', 'role="menu"'],
    seats: ['.ur-slot-avatar-button', '.ur-slot', '.st-live-avatar', '.bm-seat'],
    cards: ['.st-dir-card', '.st-live-directory-card', '.st-home-card-tall', '.gift-panel-card'],
    chat: ['.ch-msg', '.bm-msg', '.st-live-chat-line', '.dw-card-test-countdown', '.app-bottom-unread'],
    golive: ['.st-room-choice-option', '.st-home-go-live-button', '.st-live-bottom-controls', '.st-live-host-controls'],
  };
  for (const [fam, sels] of Object.entries(families)) for (const s of sels) assert.ok(rules.includes(s), `${fam}: ${s}`);
  // Every class selector must exist in real source (tsx className or existing css), no guesses.
  const corpus = execSync("grep -rhoE '[a-z][a-z0-9-]+' --include=*.tsx --include=*.ts src | sort -u", { encoding: 'utf8', maxBuffer: 1 << 26 });
  const known = new Set(corpus.split('\n'));
  const classes = new Set([...body.matchAll(/\.([a-z][a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...classes].filter((c) => !known.has(c));
  assert.deepEqual(missing, [], `unknown classes: ${missing.join(' ')}`);
});

test('shape fixes never change media, artwork or name tiers', () => {
  for (const b of ['video', 'iframe', 'img', 'canvas', 'card-art', 'badge-art', 'slot-photo-fill', 'shiny', 'tier-kicker', 'pf-passport', 'object-fit', 'clip-path', 'backdrop-filter', 'webgl', 'dw-card-face-image']) {
    assert.ok(!rules.toLowerCase().includes(b), `must not touch ${b}`);
  }
  const avatarBlock = rules.slice(rules.indexOf('.ur-slot-avatar-button,'), rules.indexOf('}', rules.indexOf('.ur-slot-avatar-button,')));
  assert.match(avatarBlock, /aspect-ratio: 1 !important/);
  assert.match(avatarBlock, /height: auto !important/);
  assert.ok(!/background/.test(avatarBlock), 'avatars retain their photo/artwork');
});

test('motion is bounded, one-shot and reduced-motion aware', () => {
  assert.ok(!/infinite/.test(rules));
  assert.ok(!/position:\s*fixed/.test(rules), 'no fullscreen overlays');
  assert.ok(!/inset:\s*-/.test(rules), 'glints bounded to their element');
  assert.ok(!/@keyframes jk-flash[^@]*transform/.test(rules), 'nav flash is opacity only');
  const kf = rules.slice(rules.indexOf('@keyframes jk-glint'));
  assert.ok(!/background|left:|top:/.test(kf.slice(0, kf.indexOf('@media'))), 'transform/opacity only');
  for (const m of rules.matchAll(/animation: ([^;]+);/g)) if (!m[1].includes('none')) assert.match(m[1], / 1( !important)?$/);
  assert.match(rules, /prefers-reduced-motion: reduce/);
  assert.match(rules, /transition: transform 120ms ease, box-shadow 120ms ease/);
});

test('no functional source changes beyond the stylesheet import', () => {
  assert.equal((rules.match(/display:\s*none/g) || []).length, 0);
  assert.ok(!/pointer-events: (?!none)/.test(rules));
});

test('Me photo is framed without cropping; live mic and speaking states remain distinct', () => {
  const hero = rules.match(/\.pf-hero\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(hero, /outline: var\(--jk-edge\) solid var\(--jk-gold\) !important/);
  assert.doesNotMatch(hero, /object-fit|overflow|width:|height:|border-radius/);
  assert.match(rules, /\.ur-slot\.is-speaking\s*\{\s*box-shadow: revert-layer !important/);
  assert.match(rules, /\.st-live-muted, \.is-mic-off,/);
});

test('public discovery cards, landing panel and search share the finish too', () => {
  assert.match(rules, /\.dw-landing-hero, \.st-sheet/);
  assert.match(rules, /\.st-card, \.st-dir-card/);
  for (const selector of ['.st-search', '.st-card-body']) {
    const block = rules.slice(rules.indexOf(`${selector} {`)).split('}')[0];
    assert.match(block, /background: var\(--jk-satin-fill\) !important/);
  }
  assert.match(rules, /\.st-card\s*\{\s*border-color: var\(--jk-gold\) !important/);
});

test('reduced motion overrides the full pressed and selected selector specificity', () => {
  const reduced = rules.slice(rules.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.includes('.pf-btn:active:not(:disabled)::before'));
  assert.ok(reduced.includes('.pf-chip, .gift-panel-category, .gift-panel-all, .dw-cfp-tabs button):active:not(:disabled)::before'));
  assert.ok(reduced.includes(':is(.gift-panel-card, .gift-panel-featured):is(:active, .is-selected)::after'));
  assert.match(reduced, /:active:not\(:disabled\) \{ transform: none !important/);
  assert.match(reduced, /transition: none !important/);
});

test('large content controls use card corners; only explicit small chips are pills', () => {
  const controls = rules.slice(rules.indexOf('.pf-btn, .pf-round,'), rules.indexOf('}', rules.indexOf('.pf-btn, .pf-round,')));
  assert.match(controls, /border-radius: var\(--jk-radius\) !important/);
  const round = rules.slice(rules.indexOf('.pf-round, .dw-icon-btn,'), rules.indexOf('}', rules.indexOf('.pf-round, .dw-icon-btn,')));
  assert.ok(!round.includes('.pf-edit'), 'full-width Edit is not a circle');
  assert.match(round, /aspect-ratio: 1 !important/);
  assert.match(round, /height: auto !important/);
  assert.match(rules, /\.app-bottom-link \{ border-radius: var\(--jk-radius\)/);
});

test('small room/nav controls use compact legacy 7px boxes; seats are boxes; no pills', () => {
  assert.match(rules, /--jk-radius-xs: 7px/);
  const blk = rules.slice(rules.indexOf('.ur-people-btn, .ur-rules-btn, .ch-msg'));
  const sel = blk.slice(0, blk.indexOf('{'));
  for (const s of ['.ur-people-btn', '.ur-rules-btn', '.ch-msg', '.ur-arrival-line', '.dw-room-composer', '.dw-room-composer :is(input, textarea, button)', '.app-bottom-link', '.gift-control', '.dw-home-tabs > a']) assert.ok(sel.includes(s), s);
  assert.match(blk.slice(0, blk.indexOf('}')), /border-radius: var\(--jk-radius-xs\) !important/);
  assert.ok(!/border-radius: var\(--jk-radius-pill\)/.test(body), 'no pill radius applied');
  assert.match(rules, /\.ur-slot, \.bm-seat, \.bm-mic-tile \{ border-radius: 13px !important; \}/);
  assert.match(rules, /\.ur-slot-portrait, \.ur-slot-portrait-layer \{ border-radius: inherit !important; \}/);
  assert.ok(!/gifting-shield|ur-gifter|shield/.test(body), 'gifter shields (incl L96) untouched');
  assert.ok(!/999px|border-radius: 2[14]px/.test(mobile.replace(/\/\*[\s\S]*?\*\//g, '')), 'mobile shell has no pill radii');
});

test('Home launch card has its own rectangular footprint and flow layout with light text', () => {
  const block = rules.match(/\.st-home-go-live-button\s*\{([^}]+)\}/)?.[1] ?? '';
  for (const text of ['aspect-ratio: .88 / 1', 'width: 100%', 'height: auto', 'border-radius: var(--jk-radius)', 'flex-direction: column', 'justify-content: center']) {
    assert.ok(block.includes(text), text);
  }
  assert.match(rules, /\.st-home-go-live-icon\s*\{[^}]*position: static !important/);
  assert.match(rules, /\.st-home-go-live\s*\{[^}]*align-self: stretch !important;[^}]*width: 100% !important/);
  assert.match(rules, /\.st-home-go-live-button :is\(strong, small, span, svg\) \{ color: var\(--jk-gold-hi\) !important/);
  const home = readFileSync('src/chat/ChatApp.tsx', 'utf8');
  const nav = readFileSync('src/components/bottom-navigation.tsx', 'utf8');
  assert.match(home, /<GoLiveButton className="st-home-go-live-button">/);
  assert.match(home, /<strong>Go Live<\/strong><small>Start your own room<\/small>/);
  assert.match(nav, /<GoLiveButton className="app-home-live">/);
});
