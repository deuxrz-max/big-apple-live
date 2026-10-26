import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAnnounced, isAnnouncementRoute, isFreshDraw, markAnnounced } from '../src/chat/pinkCardLogic';

test('announcement routes', () => {
  assert.equal(isAnnouncementRoute('/rooms/CHESS'), true);
  assert.equal(isAnnouncementRoute('/community/chess/actual-id'), true);
  assert.equal(isAnnouncementRoute('/live/abc'), true);
  assert.equal(isAnnouncementRoute('/live/start'), false);
  assert.equal(isAnnouncementRoute('/home'), false);
  assert.equal(isAnnouncementRoute('/live'), false);
});
test('freshness window 20s', () => {
  const now = Date.parse('2025-01-01T00:00:30Z');
  assert.equal(isFreshDraw('2025-01-01T00:00:15Z', now), true);
  assert.equal(isFreshDraw('2025-01-01T00:00:05Z', now), false);
  assert.equal(isFreshDraw('garbage', now), false);
});
test('once per draw per session', () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(markAnnounced(s, 'd1'), true);
  assert.equal(hasAnnounced(s, 'd1'), true);
  assert.equal(markAnnounced(s, 'd1'), false);
});
test('blocked session storage still cannot replay an announcement', () => {
  assert.equal(markAnnounced(null, 'blocked-storage-draw'), true);
  assert.equal(hasAnnounced(null, 'blocked-storage-draw'), true);
  assert.equal(markAnnounced(null, 'blocked-storage-draw'), false);
});
