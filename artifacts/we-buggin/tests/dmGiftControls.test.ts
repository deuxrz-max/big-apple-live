import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');
const giftSendingControl = /GiftControl|GiftBag|GiftIcon|<Gift\b|useSendSocialGift|sendSocialGift|button-send-gift|button-gift-|Send a gift|Send gift/;

test('DM inbox has no gift button, gift picker or gift mutation', () => {
  assert.doesNotMatch(read('social/InboxPage.tsx'), giftSendingControl);
});

test('DM thread and conversation actions have text messaging but no gift controls', () => {
  const source = read('social/MoneyPages.tsx');
  const thread = source.slice(source.indexOf('export function ThreadPage'), source.indexOf('export function RewardsPage'));
  assert.ok(thread.length > 1000, 'Inspect the real thread, not an empty extraction');
  assert.doesNotMatch(thread, giftSendingControl);
  assert.match(thread, /useSendSocialMessage\(\)/);
  assert.match(thread, /data-testid="input-message"/);
  assert.match(thread, /data-testid="button-send-message"/);
  assert.match(thread, /Conversation actions/);
});

test('profile opened from a private thread cannot offer context-free gifting', () => {
  const source = read('social/PeoplePages.tsx');
  const person = source.slice(source.indexOf('export function PersonPage'), source.indexOf('export function MyProfilePage'));
  assert.ok(person.length > 1000);
  assert.doesNotMatch(person, giftSendingControl);
  assert.match(person, /data-testid="link-message"/);
});

test('shared navigation only offers gifts inside rooms, never DM inbox or threads', () => {
  const nav = read('components/bottom-navigation.tsx');
  assert.match(nav, /const isUniversityRoom = path\.startsWith\('\/rooms\/'\)/);
  assert.match(nav, /\{isUniversityRoom && \(\s*<GiftControl/);
  assert.equal((nav.match(/<GiftControl\b/g) ?? []).length, 1);
  for (const path of ['/community/messages', '/community/messages/Example', '/community/people/Example']) {
    assert.equal(path.startsWith('/rooms/'), false);
  }
});
