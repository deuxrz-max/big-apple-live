import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_MOOD_WINDOW_MS, particleEmojis } from '@workspace/beam-identity';
import { RoomMoodTracker } from './room-mood';
import { RoomStore } from './room-store';
import type { ChatAccepted } from '@workspace/api-zod';

test('supported emoji occurrences and text-presentation hearts are counted exactly', () => {
  assert.deepEqual(particleEmojis('hello ❤️ ❤ 💖💜😊😄😂🎤🎵🎶 nope 👍'), ['❤️', '❤️', '💖', '💜', '😊', '😄', '😂', '🎤', '🎵', '🎶']);
});
test('bursts are authoritative, deduplicated, bounded and mood computes only on tick', () => {
  let now = 100;
  const tracker = new RoomMoodTracker(() => now);
  const bursts = tracker.record('BEAM01', 'm1', '💜💜😂🎵');
  assert.equal(bursts.length, 3);
  assert.ok(bursts.every(b => b.burstSize >= 3 && b.burstSize <= 8 && b.roomId === 'BEAM01'));
  assert.equal(tracker.current('BEAM01').emoji, null);
  assert.deepEqual(tracker.record('BEAM01', 'm1', '💜💜😂🎵'), []);
  assert.equal(tracker.compute('BEAM01').emoji, '💜');
  now += ROOM_MOOD_WINDOW_MS - 1;
  assert.equal(tracker.compute('BEAM01').emoji, '💜');
  now++;
  assert.equal(tracker.compute('BEAM01').emoji, null);
});
test('rolling window purges old counts, deterministically resolves ties and resets quiet rooms', () => {
  let now = 10;
  const tracker = new RoomMoodTracker(() => now);
  tracker.record('ABC123', 'old', '❤️❤️❤️');
  now += 1000;
  tracker.record('ABC123', 'new', '🎤😂');
  assert.equal(tracker.compute('ABC123').emoji, '❤️');
  now = 10 + ROOM_MOOD_WINDOW_MS;
  assert.equal(tracker.compute('ABC123').emoji, '😂');
  now += 1000;
  assert.equal(tracker.compute('ABC123').emoji, null);
});
test('room moods and emoji events never cross room incarnations or room boundaries', () => {
  let now = 0;
  const store = new RoomStore(() => now, () => 'ABC123');
  const host = store.create('Host');
  const key = store.getHistoryId(host.room.roomId);
  const events: string[] = [];
  store.subscribe(host.room.roomId, e => events.push(e.type));
  const message = { message: { id: 'm1', text: '❤️❤️' } } as ChatAccepted;
  store.publishChat(host.room.roomId, key, message);
  assert.deepEqual(events, ['chat.accepted', 'emoji_particle']);
  store.tickRoomMoods();
  assert.equal(store.getRoomMood(host.room.roomId).emoji, '❤️');
  store.leave(host.room.roomId, host.participantSessionId);
  now += 3600000;
  store.sweep();
  const replacement = store.create('New host');
  store.publishChat(replacement.room.roomId, key, message);
  store.tickRoomMoods();
  assert.equal(store.getRoomMood(replacement.room.roomId).emoji, null);
});
