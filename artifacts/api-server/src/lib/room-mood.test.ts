import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_MOOD_WINDOW_MS, ROOM_ATMOSPHERE_SCENE_MS, particleEmojis } from '@workspace/beam-identity';
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
  assert.deepEqual(events, ['chat.accepted', 'emoji_particle', 'room_mood_update']);
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

test('quiet rooms autonomously change scenes without messages and share their timing', () => {
  let now = 123;
  const tracker = new RoomMoodTracker(() => now);
  const initial = tracker.current('BEAM01');
  assert.equal(initial.atmosphere?.phase, 'drift');
  assert.equal(initial.atmosphere?.energy, 0);
  now += ROOM_ATMOSPHERE_SCENE_MS;
  const next = tracker.current('BEAM01');
  assert.equal(next.atmosphere?.phase, 'bloom');
  assert.equal(next.atmosphere?.cycleId, 1);
  assert.equal(next.atmosphere?.startedAt, now);
  assert.equal(next.atmosphere?.durationMs, ROOM_ATMOSPHERE_SCENE_MS);
  assert.deepEqual(next, tracker.current('BEAM01'));
  assert.notEqual(next.atmosphere?.seed, tracker.current('OTHER1').atmosphere?.seed);
  now += ROOM_ATMOSPHERE_SCENE_MS;
  assert.equal(tracker.current('BEAM01').atmosphere?.phase, 'aurora');
  now += ROOM_ATMOSPHERE_SCENE_MS;
  assert.equal(tracker.current('BEAM01').atmosphere?.phase, 'drift');
});

test('ordinary chat and reactions raise bounded energy once and quiet time settles it', () => {
  let now = 10;
  const tracker = new RoomMoodTracker(() => now);
  tracker.recordActivity(2);
  const joined = tracker.current('BEAM01').atmosphere!.energy;
  assert.ok(joined > 0);
  assert.deepEqual(tracker.record('BEAM01', 'plain', 'hello'), []);
  const chatted = tracker.current('BEAM01').atmosphere!.energy;
  assert.ok(chatted > joined);
  tracker.record('BEAM01', 'plain', 'hello');
  assert.equal(tracker.current('BEAM01').atmosphere!.energy, chatted);
  tracker.record('BEAM01', 'reaction', '😂😂');
  const reacted = tracker.current('BEAM01').atmosphere!.energy;
  assert.ok(reacted > chatted);
  now += ROOM_MOOD_WINDOW_MS / 2;
  assert.ok(tracker.current('BEAM01').atmosphere!.energy < reacted);
  for (let i = 0; i < 300; i++) tracker.record('BEAM01', `burst-${i}`, '💜'.repeat(100));
  assert.equal(tracker.current('BEAM01').atmosphere!.energy, 1);
  now += ROOM_MOOD_WINDOW_MS;
  assert.equal(tracker.current('BEAM01').atmosphere!.energy, 0);
});

test('automatic ticks and ordinary activity stay inside the current room incarnation', () => {
  let now = 0;
  const store = new RoomStore(() => now, () => 'ABC123');
  const host = store.create('Host');
  const history = store.getHistoryId(host.room.roomId);
  const scenes: unknown[] = [];
  store.subscribe(host.room.roomId, event => { if (event.type === 'room_mood_update') scenes.push(event.data); });
  now += ROOM_ATMOSPHERE_SCENE_MS;
  store.tickRoomAtmospheres();
  assert.equal(scenes.length, 1);
  assert.equal(store.getRoomMood(host.room.roomId).atmosphere?.phase, 'bloom');
  store.leave(host.room.roomId, host.participantSessionId);
  store.tickRoomAtmospheres();
  assert.equal(scenes.length, 1); // Empty rooms do not keep broadcasting.
  now += 3600000;
  store.sweep();
  const replacement = store.create('New host');
  store.publishChat(replacement.room.roomId, history, { message: { id: 'old', text: 'hello 😂' } } as ChatAccepted);
  assert.equal(store.getRoomMood(replacement.room.roomId).atmosphere?.phase, 'drift');
  assert.equal(store.getRoomMood(replacement.room.roomId).atmosphere?.energy, 0);
});
