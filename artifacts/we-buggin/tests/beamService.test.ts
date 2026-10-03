import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PORTRAITS, getPortrait, portraitIdentity, isPortraitId } from '../src/beam/portraits';
import { BEAM_CAPACITIES, type BeamCapacity } from '../src/beam/types';
import { FACE_MOODS, syncMood } from '../src/beam/moodSync';

const saved = new Map<string, string>();
let storageBlocked = false;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageBlocked) throw new Error('Storage blocked');
      saved.set(key, value);
    },
  },
});
const service = await import('../src/beam/services/beamService');
const identity = { emoji: '🌀', style: 'none' as const, hairColor: '#111111' };
const active = () => {
  const state = service.getState();
  assert.ok(state.session);
  return { state, session: state.session, room: state.rooms[state.session.code] };
};

test('all supported face moods select only the matching branded hair identity', () => {
  for (const [emoji, mood] of Object.entries(FACE_MOODS)) {
    assert.ok(mood.emotion);
    for (const start of ['spiked-smile', 'ponytail-smile'] as const) {
      const before = { ...portraitIdentity(start), hairColor: '#12AB34' };
      const expected = mood.portraits[before.style as 'spiked' | 'ponytails'];
      const after = syncMood(before, `hello ${emoji}`);
      if (!expected) assert.equal(after, before);
      else {
        assert.equal(after.portraitId, expected);
        assert.equal(getPortrait(after).style, before.style);
        assert.equal(getPortrait(after).emoji, emoji);
        assert.equal(after.emoji, emoji);
        assert.equal(after.style, before.style);
        assert.equal(after.hairColor, before.hairColor);
      }
    }
  }
});

test('mood detection ignores ordinary emojis and unsupported compound faces', () => {
  const before = portraitIdentity('spiked-grin');
  for (const text of ['hello', '❤️🔥💙👀👍', '😢😡🥺🤖', '🙂‍↔️', '🙂‍↕️', '😶‍🌫️']) {
    assert.equal(syncMood(before, text), before, text);
  }
  assert.equal(syncMood(before, '😊️').portraitId, 'spiked-soft-smile');
  assert.equal(syncMood(before, '😃 then 😆 and 😂🔥😘').portraitId, 'spiked-tears');
  assert.equal(syncMood(portraitIdentity('kiss'), '😃 then 😆 and 😂🔥😘').portraitId, 'kiss');
  const legacy = { ...identity, emoji: '🦋' };
  assert.equal(getPortrait(syncMood(legacy, '😊')).style, getPortrait(legacy).style);
});

test('chat commits sender mood instantly, preserves room logic and persists until another face', () => {
  storageBlocked = false;
  service.resetDemo();
  service.joinBeam('LATEBG', 'mood_me', portraitIdentity('spiked-grin'));
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  let notifications = 0;
  const unsubscribe = service.subscribe(() => { notifications++; });
  service.sendMessage(room.code, session.selfId, 'text', 'feeling 😊');
  unsubscribe();
  assert.equal(notifications, 1);
  let next = active();
  assert.equal(next.room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-soft-smile');
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-soft-smile');
  assert.equal(next.room.messages.at(-1)?.text, 'feeling 😊');
  for (const text of ['still here', '❤️🔥', '😘😡', '🙂‍↔️']) {
    service.sendMessage(room.code, session.selfId, 'text', text);
    assert.equal(active().room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-soft-smile');
  }
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-soft-smile');
  service.sendMessage(room.code, session.selfId, 'reaction', '😂');
  next = active();
  assert.equal(next.room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-tears');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.capacity, room.capacity);
  assert.deepEqual(next.session, session);
  const before = service.getState();
  assert.throws(() => service.sendMessage(room.code, session.selfId, 'text', '😆'.repeat(150)), { code: 'TOO_LONG' });
  assert.throws(() => service.sendMessage(room.code, 'absent', 'text', '😆'), { code: 'NOT_MEMBER' });
  assert.equal(service.getState(), before);
});

test('all nineteen supplied portraits are selectable and old saved identities keep their pictures', () => {
  assert.equal(PORTRAITS.length, 19);
  assert.equal(new Set(PORTRAITS.map(p => p.file)).size, 19);
  for (const portrait of PORTRAITS) {
    assert.ok(isPortraitId(portrait.id));
    assert.equal(getPortrait(portraitIdentity(portrait.id)).id, portrait.id);
  }
  assert.equal(isPortraitId('unknown-image'), false);
  assert.equal(getPortrait({ ...identity, style: 'spiked' }).id, 'skeptical');
  assert.ok(isPortraitId(getPortrait(identity).id));
  assert.equal(getPortrait({ ...identity, emoji: '🦋' }).id, 'laugh-alternate');
  assert.equal(getPortrait({ ...identity, emoji: '👾' }).id, 'laugh');
  assert.equal(getPortrait({ ...identity, emoji: '🪩' }).id, 'wink');
});

test('changing the own profile picture preserves peers and persists the selected artwork', () => {
  storageBlocked = false;
  service.resetDemo();
  service.joinBeam('LATEBG', 'portrait_me', portraitIdentity('kiss'));
  const { room, session } = active();
  const peersBefore = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'picture test');
  service.updateIdentity(room.code, session.selfId, 'portrait_me', portraitIdentity('wink'));
  const next = active();
  assert.equal(next.room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'wink');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peersBefore);
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'wink');
  assert.equal(next.room.messages.at(-1)?.text, 'picture test');
});

test('all four beam sizes persist, stop at their selected limit, and allow room resumption', () => {
  for (const capacity of BEAM_CAPACITIES) {
    service.resetDemo();
    const code = service.createBeam(`Size ${capacity}`, 'host', portraitIdentity('spiked-smile'), capacity);
    assert.equal(active().room.capacity, capacity);
    assert.equal(active().room.participants.length, 1);
    assert.equal(JSON.parse(saved.get(service.STORAGE_KEY)!).rooms[code].capacity, capacity);
    service.simulateFill(code);
    assert.equal(active().room.participants.length, capacity);
    assert.throws(() => service.simulateAddPeer(code), { code: 'ROOM_FULL' });
    const selfId = active().session.selfId;
    service.joinBeam(code, 'host', portraitIdentity('wink'));
    assert.equal(active().session.selfId, selfId);
    assert.equal(active().room.participants.length, capacity);
    service.leaveBeam(code, selfId);
    service.simulateAddPeer(code);
    assert.equal(service.getState().rooms[code].participants.length, capacity);
    assert.throws(() => service.joinBeam(code, 'next_guest', identity), { code: 'ROOM_FULL' });
    service.simulateRemovePeer(code);
    service.joinBeam(code, 'next_guest', identity);
    assert.equal(active().room.participants.length, capacity);
    assert.equal(active().room.capacity, capacity);
  }
});

test('unsupported beam sizes are rejected without changing an active room', () => {
  service.resetDemo();
  service.createBeam('Existing room', 'host', identity, 2);
  const before = service.getState();
  for (const capacity of [0, 1, 3, 6, 13, 99, NaN]) {
    assert.throws(() => service.createBeam('Bad size', 'host', identity, capacity as BeamCapacity), { code: 'INVALID_CAPACITY' });
    assert.equal(service.getState(), before);
  }
});

test('joining demo creates the seventh participant and persists state', () => {
  service.resetDemo();
  service.joinBeam('late-bg', 'Maya', identity);
  const { session, room } = active();
  assert.equal(room.participants.length, 7);
  assert.equal(room.capacity, 12);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.handle, 'Maya');
  assert.equal(JSON.parse(saved.get(service.STORAGE_KEY)!).session.selfId, session.selfId);
});

test('invalid, missing, full and duplicate-handle entries do not mutate membership', () => {
  service.resetDemo();
  for (const [code, expected] of [['!', 'INVALID_CODE'], ['ZZZZZZ', 'NOT_FOUND'], ['FULL12', 'ROOM_FULL']]) {
    assert.throws(() => service.joinBeam(code, 'Maya', identity), { code: expected });
  }
  assert.throws(() => service.joinBeam('LATEBG', 'MOTH', identity), { code: 'HANDLE_TAKEN' });
  assert.equal(service.getState().session, null);
  assert.equal(service.getState().rooms.LATEBG.participants.length, 6);
});

test('simulated occupancy cannot exceed 12, and removing a peer frees one seat', () => {
  service.resetDemo();
  service.joinBeam('LATEBG', 'Maya', identity);
  service.simulateFill('LATEBG');
  assert.equal(active().room.participants.length, 12);
  assert.throws(() => service.simulateAddPeer('LATEBG'), { code: 'ROOM_FULL' });
  service.simulateRemovePeer('LATEBG');
  assert.equal(active().room.participants.length, 11);
  service.simulateAddPeer('LATEBG');
  assert.equal(active().room.participants.length, 12);
});

test('resuming at capacity keeps one identity and switching rooms releases the old seat', () => {
  service.resetDemo();
  service.joinBeam('LATEBG', 'Maya', identity);
  const oldId = active().session.selfId;
  service.simulateFill('LATEBG');
  service.joinBeam('LATEBG', 'Maya', { ...identity, emoji: '👾' });
  assert.equal(active().session.selfId, oldId);
  assert.equal(active().room.participants.length, 12);
  const code = service.createBeam('After Hours', 'Maya', identity);
  assert.equal(active().room.code, code);
  assert.equal(active().room.participants.length, 1);
  assert.equal(service.getState().rooms.LATEBG.participants.length, 11);
  assert.equal(service.getState().rooms.LATEBG.participants.some(p => p.id === oldId), false);
});

test('identity changes keep participant IDs, and text/reactions have bounded history', () => {
  service.resetDemo();
  service.joinBeam('LATEBG', 'Maya', identity);
  const { session } = active();
  service.updateIdentity(session.code, session.selfId, 'Maya', { ...identity, emoji: '👾' });
  assert.equal(active().session.selfId, session.selfId);
  assert.throws(() => service.sendMessage(session.code, session.selfId, 'text', '  '), { code: 'EMPTY_MESSAGE' });
  assert.throws(() => service.sendMessage(session.code, session.selfId, 'text', 'x'.repeat(281)), { code: 'TOO_LONG' });
  for (let i = 0; i < 70; i++) service.sendMessage(session.code, session.selfId, 'text', `message ${i}`);
  service.sendMessage(session.code, session.selfId, 'reaction', '🔥');
  const { room } = active();
  assert.equal(room.messages.length, 60);
  assert.equal(room.messages.at(-1)?.kind, 'reaction');
  assert.equal(room.messages.at(-1)?.authorSnapshot?.identity.emoji, '👾');
});

test('leaving clears the session and removes only the current participant', () => {
  service.resetDemo();
  service.joinBeam('LATEBG', 'Maya', identity);
  const { session } = active();
  service.leaveBeam(session.code, session.selfId);
  assert.equal(service.getState().session, null);
  assert.equal(service.getState().rooms.LATEBG.participants.length, 6);
  assert.throws(() => service.sendMessage(session.code, session.selfId, 'text', 'gone'), { code: 'NOT_MEMBER' });
});

test('unavailable storage is explicitly reported while the demo remains interactive', () => {
  service.resetDemo();
  storageBlocked = true;
  service.createBeam('Offline Demo', 'Maya', identity);
  assert.equal(active().room.participants.length, 1);
  assert.match(service.getPersistenceNotice()!, /will be lost on refresh/);
  storageBlocked = false;
  service.resetDemo();
  assert.equal(service.getPersistenceNotice(), null);
});