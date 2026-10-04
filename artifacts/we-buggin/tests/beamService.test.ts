import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PORTRAITS, getPortrait, portraitIdentity, isPortraitId } from '../src/beam/portraits';
import { BEAM_CAPACITIES, type BeamCapacity } from '../src/beam/types';
import { FACE_MOODS, syncMood } from '../src/beam/moodSync';
import { EMOJI_MOOD_KEYS, MOOD_SPRITES, isMoodKey } from '../src/beam/moodCatalog';

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

test('normalized moods use valid same-hairstyle sprites and keep missing artwork unsupported', () => {
  for (const [emoji, moodKey] of Object.entries(EMOJI_MOOD_KEYS)) {
    assert.equal(isMoodKey(moodKey), true);
    assert.equal(FACE_MOODS[emoji].moodKey, moodKey);
    for (const start of ['spiked-smile', 'ponytail-smile'] as const) {
      const before = portraitIdentity(start);
      const after = syncMood(before, emoji);
      const expected = FACE_MOODS[emoji].portraits[before.style as 'spiked' | 'ponytails'];
      if (!expected) {
        assert.equal(after, before);
      } else {
        assert.equal(after.currentMood, moodKey);
        assert.equal(after.portraitId, expected);
        assert.equal(after.style, before.style);
      }
    }
  }
  assert.equal(isMoodKey('not_a_mood'), false);
  assert.equal(isMoodKey('toString'), false);
  assert.equal(isMoodKey(null), false);
  assert.equal(MOOD_SPRITES.winking.portraits.spiked, 'spiked-winking');
  assert.equal(syncMood(portraitIdentity('wink'), '😉').currentMood, 'winking');
  assert.equal(syncMood(portraitIdentity('ponytail-winking'), '😜').currentMood, 'playful_wink');
  const legacy = { emoji: '😁', style: 'spiked' as const, hairColor: '#111111', portraitId: 'spiked-grin' as const };
  assert.equal(syncMood(legacy, 'hello ❤️🔥'), legacy);
  assert.equal(syncMood(legacy, '😊 then 😂🔥😜').currentMood, 'tears_of_joy');
});

test('current mood persists atomically with the sender image without changing peers or manual choices', () => {
  service.resetDemo();
  service.joinBeam('LATEBG', 'saved_mood', portraitIdentity('ponytail-grin'));
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  let notifications = 0;
  const unsubscribe = service.subscribe(() => { notifications++; });
  service.sendMessage(room.code, session.selfId, 'text', '😊 then 🤔');
  unsubscribe();
  assert.equal(notifications, 1);
  const focused = active().room.participants.find(p => p.id === session.selfId)!.identity;
  assert.equal(focused.currentMood, 'thinking');
  assert.equal(focused.portraitId, 'ponytail-thinking');
  for (const text of ['plain text', '❤️🔥', '😶‍🌫️', '😭🤨']) {
    service.sendMessage(room.code, session.selfId, 'text', text);
    assert.equal(active().room.participants.find(p => p.id === session.selfId)!.identity, focused);
  }
  const next = active();
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.currentMood, 'thinking');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  const persistedIdentity = persisted.rooms.LATEBG.participants
    .find((p: { id: string }) => p.id === session.selfId).identity;
  assert.equal(persistedIdentity.currentMood, 'thinking');
  assert.equal(persistedIdentity.portraitId, 'ponytail-thinking');
  const beforeRejected = service.getState();
  assert.throws(() => service.sendMessage(room.code, session.selfId, 'text', '😂'.repeat(150)), { code: 'TOO_LONG' });
  assert.equal(service.getState(), beforeRejected);
  service.updateIdentity(room.code, session.selfId, 'saved_mood', portraitIdentity('wink'));
  assert.equal(active().room.participants.find(p => p.id === session.selfId)!.identity.currentMood, 'playful_wink');
  service.sendMessage(room.code, session.selfId, 'reaction', '😐');
  assert.equal(active().room.participants.find(p => p.id === session.selfId)!.identity.currentMood, 'neutral');
});

test('mood detection ignores ordinary emojis and unsupported compound faces', () => {
  const before = portraitIdentity('spiked-grin');
  for (const text of ['hello', '❤️🔥💙👀👍', '😢😡🥺🤖', '🙂‍↔️', '🙂‍↕️', '😶‍🌫️']) {
    assert.equal(syncMood(before, text), before, text);
  }
  assert.equal(syncMood(before, '😊️').portraitId, 'spiked-smiling-eyes');
  assert.equal(syncMood(before, '😃 then 😆 and 😂🔥😘').portraitId, 'spiked-blowing-kiss');
  assert.equal(syncMood(portraitIdentity('kiss'), '😃 then 😆 and 😂🔥😘').portraitId, 'ponytail-blowing-kiss');
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
  assert.equal(next.room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-smiling-eyes');
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-smiling-eyes');
  assert.equal(next.room.messages.at(-1)?.text, 'feeling 😊');
  for (const text of ['still here', '❤️🔥', '😜😡', '🙂‍↔️']) {
    service.sendMessage(room.code, session.selfId, 'text', text);
    assert.equal(active().room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-smiling-eyes');
  }
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-smiling-eyes');
  service.sendMessage(room.code, session.selfId, 'reaction', '😂');
  next = active();
  assert.equal(next.room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'spiked-tears-of-joy');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.capacity, room.capacity);
  assert.deepEqual(next.session, session);
  const before = service.getState();
  assert.throws(() => service.sendMessage(room.code, session.selfId, 'text', '😆'.repeat(150)), { code: 'TOO_LONG' });
  assert.throws(() => service.sendMessage(room.code, 'absent', 'text', '😆'), { code: 'NOT_MEMBER' });
  assert.equal(service.getState(), before);
});

test('all forty-one supplied portraits are selectable and old saved identities keep their pictures', () => {
  assert.equal(PORTRAITS.length, 41);
  assert.equal(new Set(PORTRAITS.map(p => p.file)).size, 41);
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

test('loudly crying updates and persists a spiky sender without changing ponytail moods', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '😭'), female);
  assert.equal(syncMood(female, '😊 then 😭').portraitId, 'ponytail-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😂 then 😭🔥').portraitId, 'spiked-loudly-crying');
  service.resetDemo();
  service.joinBeam('LATEBG', 'crying_me', portraitIdentity('spiked-smile'));
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'oh no 😭');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-loudly-crying');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-loudly-crying');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-loudly-crying');
});

test('ROFL persists for spiky senders without replacing crying, joy or ponytail variants', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '🤣').portraitId, 'ponytail-rofl');
  assert.equal(syncMood(female, '😊 then 🤣').portraitId, 'ponytail-rofl');
  assert.equal(syncMood(portraitIdentity('spiked-smile'), '😭😂🤣🔥').portraitId, 'spiked-rofl');
  assert.equal(syncMood(portraitIdentity('spiked-rofl'), '😂').portraitId, 'spiked-tears-of-joy');
  assert.equal(syncMood(portraitIdentity('spiked-rofl'), '😭').portraitId, 'spiked-loudly-crying');
  service.resetDemo();
  service.joinBeam('LATEBG', 'rofl_me', portraitIdentity('spiked-smile'));
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'too funny 🤣');
  service.sendMessage(room.code, session.selfId, 'reaction', '🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-rofl');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-rofl');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-rofl');
});

test('heart-eyes selects the matching hair variant but standalone hearts do not trigger a mood', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '😍').portraitId, 'ponytail-heart-eyes');
  assert.equal(syncMood(female, '😊😍❤️').portraitId, 'ponytail-heart-eyes');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '❤️💖💙♥️🔥'), male);
  assert.equal(syncMood(male, '🤣 then 😍❤️').portraitId, 'spiked-heart-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'heart_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'love this 😍');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-heart-eyes');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-heart-eyes');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-heart-eyes');
});

test('smiling with hearts matches each hairstyle while ordinary hearts leave moods unchanged', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '🥰').portraitId, 'ponytail-smiling-hearts');
  assert.equal(syncMood(female, '😊 then 🥰❤️').portraitId, 'ponytail-smiling-hearts');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '❤️💖💙♥️🔥'), male);
  assert.equal(syncMood(male, '😍 then 🥰❤️').portraitId, 'spiked-smiling-hearts');
  assert.equal(syncMood(portraitIdentity('spiked-smiling-hearts'), '😍').portraitId, 'spiked-heart-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'hearts_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'feeling loved 🥰');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-smiling-hearts');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-smiling-hearts');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-smiling-hearts');
});

test('new smiling eyes is selected only on a qualifying message and preserves the old choice', () => {
  const oldChoice = portraitIdentity('spiked-soft-smile');
  assert.equal(getPortrait(oldChoice).id, 'spiked-soft-smile');
  assert.equal(syncMood(oldChoice, 'still smiling ❤️🔥'), oldChoice);
  assert.equal(syncMood(oldChoice, '😊').portraitId, 'spiked-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('ponytail-grin'), '😊').portraitId, 'ponytail-smiling-eyes');
});

test('melting matches both hairstyles and persists for a spiky sender without changing peers', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '🫠').portraitId, 'ponytail-melting');
  assert.equal(syncMood(female, '😊 then 🫠🔥').portraitId, 'ponytail-melting');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '🥰 then 🫠🔥').portraitId, 'spiked-melting');
  assert.equal(syncMood(portraitIdentity('spiked-melting'), '😊').portraitId, 'spiked-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'melting_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'what a day 🫠');
  service.sendMessage(room.code, session.selfId, 'reaction', '🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-melting');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-melting');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-melting');
});

test('blowing a kiss keeps the matching hair variant and persists a spiky reaction sender', () => {
  assert.equal(syncMood(portraitIdentity('ponytail-grin'), '😘').portraitId, 'ponytail-blowing-kiss');
  assert.equal(getPortrait(portraitIdentity('kiss')).id, 'kiss');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '😊 then 😘❤️').portraitId, 'spiked-blowing-kiss');
  assert.equal(syncMood(portraitIdentity('spiked-blowing-kiss'), '😊').portraitId, 'spiked-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'kiss_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'reaction', '😘');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-blowing-kiss');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-blowing-kiss');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-blowing-kiss');
});

test('thinking matches each hairstyle and persists for spiky senders without replacing skeptical artwork', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '🤔').portraitId, 'ponytail-thinking');
  assert.equal(syncMood(female, '😊 then 🤔🔥').portraitId, 'ponytail-thinking');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '🤨 then 🤔❤️').portraitId, 'spiked-thinking');
  assert.equal(syncMood(portraitIdentity('spiked-thinking'), '🤨').portraitId, 'skeptical');
  service.resetDemo();
  service.joinBeam('LATEBG', 'thinking_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'let me think 🤔');
  service.sendMessage(room.code, session.selfId, 'reaction', '🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-thinking');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-thinking');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-thinking');
});

test('winking persists for a spiky sender without replacing the ponytail playful wink', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '😉').portraitId, 'ponytail-winking');
  assert.equal(syncMood(female, '😜 then 😉🔥').portraitId, 'ponytail-winking');
  const male = portraitIdentity('spiked-grin');
  assert.equal(syncMood(male, '😜'), male);
  assert.equal(syncMood(male, '🤔 then 😉❤️').portraitId, 'spiked-winking');
  assert.equal(syncMood(portraitIdentity('spiked-winking'), '😊').portraitId, 'spiked-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'winking_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'reaction', '😉');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-winking');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-winking');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-winking');
});

test('neutral matches each hairstyle only on an explicit face, not ordinary text', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '😐').portraitId, 'ponytail-neutral');
  assert.equal(syncMood(female, '😊 then 😐🔥').portraitId, 'ponytail-neutral');
  const male = portraitIdentity('spiked-winking');
  assert.equal(syncMood(male, 'nothing new ❤️🔥'), male);
  assert.equal(syncMood(male, '😉 then 😐❤️').portraitId, 'spiked-neutral');
  assert.equal(syncMood(portraitIdentity('spiked-neutral'), '😊').portraitId, 'spiked-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'neutral_me', male);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'feeling neutral 😐');
  service.sendMessage(room.code, session.selfId, 'text', 'just talking ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'spiked-neutral');
  assert.equal(me.identity.style, 'spiked');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'spiked-neutral');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'spiked-neutral');
});

test('new ponytail tears of joy preserves older selections and the spiky mapping', () => {
  const oldChoice = portraitIdentity('laugh-alternate');
  assert.equal(getPortrait(oldChoice).id, 'laugh-alternate');
  assert.equal(syncMood(oldChoice, 'still laughing ❤️🔥'), oldChoice);
  assert.equal(syncMood(oldChoice, '😂').portraitId, 'ponytail-tears-of-joy');
  assert.equal(syncMood(oldChoice, '😂 then 😭🤨').portraitId, 'ponytail-tears-of-joy');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😂').portraitId, 'spiked-tears-of-joy');
  service.resetDemo();
  service.joinBeam('LATEBG', 'joy_me', oldChoice);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'reaction', '😂');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-tears-of-joy');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-tears-of-joy');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-tears-of-joy');
});

test('ponytail ROFL persists without replacing tears of joy or the spiky variant', () => {
  const female = portraitIdentity('ponytail-tears-of-joy');
  assert.equal(syncMood(female, 'still here ❤️🔥'), female);
  assert.equal(syncMood(female, '😂 then 🤣😭').portraitId, 'ponytail-rofl');
  assert.equal(syncMood(portraitIdentity('ponytail-rofl'), '😂').portraitId, 'ponytail-tears-of-joy');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '🤣').portraitId, 'spiked-rofl');
  service.resetDemo();
  service.joinBeam('LATEBG', 'rofl_female', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'too funny 🤣');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-rofl');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-rofl');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-rofl');
});

test('ponytail heart-eyes persists while ordinary hearts, saved choices and the spiky variant stay unchanged', () => {
  const female = portraitIdentity('ponytail-grin');
  assert.equal(syncMood(female, '❤️💖💙♥️🔥'), female);
  assert.equal(getPortrait(female).id, 'ponytail-grin');
  assert.equal(syncMood(female, '🤣 then 😍🤨').portraitId, 'ponytail-heart-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😍').portraitId, 'spiked-heart-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'heart_female', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'reaction', '😍');
  service.sendMessage(room.code, session.selfId, 'text', 'love this ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-heart-eyes');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-heart-eyes');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-heart-eyes');
});

test('ponytail smiling with hearts persists without replacing heart-eyes or the spiky variant', () => {
  const female = portraitIdentity('ponytail-heart-eyes');
  assert.equal(syncMood(female, '❤️💖💙♥️🔥'), female);
  assert.equal(syncMood(female, '😍 then 🥰🤨').portraitId, 'ponytail-smiling-hearts');
  assert.equal(syncMood(portraitIdentity('ponytail-smiling-hearts'), '😍').portraitId, 'ponytail-heart-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '🥰').portraitId, 'spiked-smiling-hearts');
  service.resetDemo();
  service.joinBeam('LATEBG', 'hearts_girl', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  service.sendMessage(room.code, session.selfId, 'text', 'feeling loved 🥰');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-smiling-hearts');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-smiling-hearts');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-smiling-hearts');
});

test('new ponytail smiling eyes preserves the old selection until a qualifying face is sent', () => {
  const oldChoice = portraitIdentity('ponytail-soft-smile');
  assert.equal(getPortrait(oldChoice).id, 'ponytail-soft-smile');
  assert.equal(syncMood(oldChoice, 'still smiling ❤️🔥'), oldChoice);
  assert.equal(syncMood(oldChoice, '😊').portraitId, 'ponytail-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😊').portraitId, 'spiked-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'smile_girl', oldChoice);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-soft-smile');
  service.sendMessage(room.code, session.selfId, 'text', 'feeling happy 😊');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-smiling-eyes');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-smiling-eyes');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-smiling-eyes');
});

test('ponytail melting persists without changing saved choices, peers or the spiky variant', () => {
  const female = portraitIdentity('ponytail-smiling-eyes');
  assert.equal(syncMood(female, 'what a day ❤️🔥'), female);
  assert.equal(syncMood(female, '😊 then 🫠🤨').portraitId, 'ponytail-melting');
  assert.equal(syncMood(portraitIdentity('ponytail-melting'), '😊').portraitId, 'ponytail-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '🫠').portraitId, 'spiked-melting');
  service.resetDemo();
  service.joinBeam('LATEBG', 'melt_girl', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-smiling-eyes');
  service.sendMessage(room.code, session.selfId, 'reaction', '🫠');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-melting');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-melting');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-melting');
});

test('grateful updates only ponytail senders and persists without changing peers or saved selections', () => {
  const female = portraitIdentity('ponytail-smiling-eyes');
  const male = portraitIdentity('spiked-smile');
  assert.equal(syncMood(male, '🥹'), male);
  assert.equal(syncMood(male, '😊 then 🥹').portraitId, 'spiked-smiling-eyes');
  assert.equal(syncMood(female, 'thank you ❤️🔥✨'), female);
  assert.equal(syncMood(female, '😊 then 🥹😭').portraitId, 'ponytail-grateful');
  assert.equal(syncMood(female, '🥹 then 😊').portraitId, 'ponytail-smiling-eyes');
  service.resetDemo();
  service.joinBeam('LATEBG', 'grateful_me', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-smiling-eyes');
  service.sendMessage(room.code, session.selfId, 'text', 'thank you 🥹');
  service.sendMessage(room.code, session.selfId, 'reaction', '❤️');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-grateful');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-grateful');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-grateful');
});

test('new ponytail kiss preserves the original saved choice until a qualifying message and persists sender-only', () => {
  const oldChoice = portraitIdentity('kiss');
  assert.equal(getPortrait(oldChoice).id, 'kiss');
  assert.equal(syncMood(oldChoice, 'sending love ❤️🔥'), oldChoice);
  assert.equal(syncMood(oldChoice, '😘').portraitId, 'ponytail-blowing-kiss');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😘').portraitId, 'spiked-blowing-kiss');
  service.resetDemo();
  service.joinBeam('LATEBG', 'kiss_girl', oldChoice);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'kiss');
  service.sendMessage(room.code, session.selfId, 'reaction', '😘');
  service.sendMessage(room.code, session.selfId, 'text', 'sending love ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-blowing-kiss');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-blowing-kiss');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-blowing-kiss');
});

test('ponytail thinking persists sender-only without changing saved choices or skeptical artwork', () => {
  const female = portraitIdentity('ponytail-smiling-eyes');
  assert.equal(syncMood(female, 'thinking about it ❤️🔥'), female);
  assert.equal(syncMood(female, '😊 then 🤔🤨').portraitId, 'ponytail-thinking');
  assert.equal(syncMood(portraitIdentity('ponytail-thinking'), '😊').portraitId, 'ponytail-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '🤔').portraitId, 'spiked-thinking');
  assert.equal(syncMood(portraitIdentity('spiked-thinking'), '🤨').portraitId, 'skeptical');
  service.resetDemo();
  service.joinBeam('LATEBG', 'think_girl', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-smiling-eyes');
  service.sendMessage(room.code, session.selfId, 'text', 'let me think 🤔');
  service.sendMessage(room.code, session.selfId, 'reaction', '🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-thinking');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-thinking');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-thinking');
});

test('ponytail winking persists sender-only and remains distinct from the original playful wink', () => {
  const oldChoice = portraitIdentity('wink');
  assert.equal(getPortrait(oldChoice).id, 'wink');
  assert.equal(syncMood(oldChoice, 'still here ❤️🔥'), oldChoice);
  assert.equal(syncMood(oldChoice, '😉').portraitId, 'ponytail-winking');
  assert.equal(syncMood(portraitIdentity('ponytail-winking'), '😜').portraitId, 'wink');
  assert.equal(syncMood(portraitIdentity('ponytail-winking'), '😉 then 🤨').portraitId, 'ponytail-winking');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😉').portraitId, 'spiked-winking');
  service.resetDemo();
  service.joinBeam('LATEBG', 'wink_girl', oldChoice);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'wink');
  service.sendMessage(room.code, session.selfId, 'reaction', '😉');
  service.sendMessage(room.code, session.selfId, 'text', 'still here ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-winking');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-winking');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-winking');
});

test('ponytail neutral activates explicitly and persists sender-only without resetting other moods', () => {
  const female = portraitIdentity('ponytail-winking');
  assert.equal(syncMood(female, 'ordinary text ❤️🔥'), female);
  assert.equal(syncMood(female, '😉 then 😐😭').portraitId, 'ponytail-neutral');
  assert.equal(syncMood(portraitIdentity('ponytail-neutral'), '😊').portraitId, 'ponytail-smiling-eyes');
  assert.equal(syncMood(portraitIdentity('spiked-grin'), '😐').portraitId, 'spiked-neutral');
  service.resetDemo();
  service.joinBeam('LATEBG', 'neutral_girl', female);
  const { room, session } = active();
  const peers = room.participants.filter(p => p.id !== session.selfId);
  assert.equal(room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-winking');
  service.sendMessage(room.code, session.selfId, 'text', 'ordinary text ❤️🔥');
  assert.equal(active().room.participants.find(p => p.id === session.selfId)?.identity.portraitId, 'ponytail-winking');
  service.sendMessage(room.code, session.selfId, 'reaction', '😐');
  service.sendMessage(room.code, session.selfId, 'text', 'just talking ❤️🔥');
  const next = active();
  const me = next.room.participants.find(p => p.id === session.selfId)!;
  assert.equal(me.identity.portraitId, 'ponytail-neutral');
  assert.equal(me.identity.style, 'ponytails');
  assert.deepEqual(next.room.participants.filter(p => p.id !== session.selfId), peers);
  assert.equal(next.room.messages.at(-1)?.authorSnapshot?.identity.portraitId, 'ponytail-neutral');
  const persisted = JSON.parse(saved.get(service.STORAGE_KEY)!);
  assert.equal(persisted.rooms.LATEBG.participants.find((p: { id: string }) => p.id === session.selfId).identity.portraitId, 'ponytail-neutral');
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