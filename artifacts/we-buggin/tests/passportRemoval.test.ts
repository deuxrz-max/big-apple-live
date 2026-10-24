import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { avatarInitials } from '../src/components/neutral-avatar';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

test('passport UI modules are gone', () => {
  for (const f of ['StreamerPassport.tsx', 'PassportCountryBadge.tsx', 'passport.css', 'passport-country-badge.css']) {
    assert.equal(existsSync(join(root, 'src/passport', f)), false, f);
  }
});

test('no source imports or renders passport UI', () => {
  for (const f of walk(join(root, 'src')).filter((f) => /\.tsx?$/.test(f))) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /@\/passport\/|PassportSummaryBadge|StreamerPassport|passport-review|PassportCountryBadge/, f);
  }
});

test('own profile ends after coin stats without passport/self-listed chips or name emoji', () => {
  const own = read('src/profile/OwnProfile.tsx');
  assert.doesNotMatch(own, /streamer-passport|Streamer passport/);
  assert.match(own, /RewardsPage embedded/);
  assert.match(own, /section-gifting-level/);
  const view = read('src/profile/ProfileView.tsx');
  assert.doesNotMatch(view, /emojiFromId|pf-name-emoji|Self-listed|externalPlatform/);
  assert.match(view, /Coins sent in gifts/);
});

test('retired preset portraits render as neutral defaults', () => {
  const glyph = read('src/beam/components/IdentityGlyph.tsx');
  assert.doesNotMatch(glyph, /profile-pictures|getPortrait/);
  const id = read('src/lib/identity.tsx');
  assert.doesNotMatch(id, /Ponytail|SPIKE_|emojiImageUrl\(identity/);
  assert.doesNotMatch(read('src/components/identity-editor.tsx'), /Spiky hair|Ponytail/);
  assert.doesNotMatch(read('src/beam/components/EmojiPicker.tsx'), /AVATAR_CHOICES|Mood Sync/);
  assert.match(read('src/components/user-photo.tsx'), /<img src=\{photoSrc\(photoUrl\)\}/);
});

test('initials helper', () => {
  assert.equal(avatarInitials('Rosa Lima'), 'RL');
  assert.equal(avatarInitials('night_owl'), 'NO');
  assert.equal(avatarInitials(''), '');
  assert.equal(avatarInitials(null), '');
});

test('retired portrait artwork is physically absent and unreferenced', () => {
  const dir = join(root, 'public/profile-pictures');
  const images = existsSync(dir) ? walkAll(dir).filter((f) => /\.(webp|png|jpe?g|gif|svg)$/i.test(f)) : [];
  assert.deepEqual(images, []);
  for (const f of walk(join(root, 'src'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /profile-pictures\//, f);
});

test('combined CSS lists carry no dead passport selectors', () => {
  for (const f of walk(join(root, 'src')).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /\.sp-[a-z]|pcb-|passport/i, f);
  }
});

test('browser harness uses the profile-cleanup check, not the old passport spec', () => {
  assert.equal(existsSync(join(root, 'tests/browser/passport-country.spec.ts')), false);
  assert.match(read('tests/browser/playwright.config.ts'), /profile-cleanup\.spec\.ts/);
  assert.match(read('tests/browser/harness.tsx'), /'profile-cleanup' \? <OwnProfile \/>/);
});

function walkAll(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walkAll(p, out); else out.push(p); }
  return out;
}

test('own Me panel ends on coin stats; public profile order unchanged', () => {
  const view = read('src/profile/ProfileView.tsx');
  const panel = view.slice(view.indexOf('<section className="pf-panel">'), view.indexOf('</section>', view.indexOf('<section className="pf-panel">')));
  const stats = panel.indexOf('<dl className="pf-stats"');
  assert.ok(panel.indexOf('{own && children}') < stats && panel.indexOf('{own && links}') < stats);
  const after = panel.slice(panel.indexOf('</dl>') + 5).trim();
  assert.equal(after, '{!own && children}\n        {!own && links}');
});

test('full-seat neutral fallback fills its box; small avatars are square', () => {
  const n = read('src/components/neutral-avatar.tsx');
  assert.match(n, /fill \? 'xMidYMid slice'/);
  assert.doesNotMatch(n, /borderRadius/);
  assert.match(n, /'square'/);
  assert.doesNotMatch(n, /<circle cx="50" cy="50"/);
  assert.match(read('src/chat/UniversityRoom.tsx'), /<IdentityAvatar identity=\{person\.identity\} name=\{fallbackName\} size="100%" fill \/>/);
  assert.match(read('src/joker-finish.css'), /\.ur-slot-avatar-button\.ur-slot-photo-action \{ border-radius: inherit !important; \}/);
});
