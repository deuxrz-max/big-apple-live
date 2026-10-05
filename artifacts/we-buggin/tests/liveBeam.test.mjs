import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const apiNames = [
  'createAccountRoom', 'joinAccountRoom', 'getRoom', 'getMyProfile', 'saveMyProfile',
  'getRoomMessages', 'sendRoomMessage', 'heartbeatParticipant', 'leaveRoom',
];
const compiled = await build({
  entryPoints: ['src/beam/services/beamService.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'account-api-fixture',
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: apiNames.map(name => `export const ${name} = (...args) => globalThis.__beamApi.${name}(...args);`).join('\n'),
        loader: 'js',
      }));
    },
  }],
});
const service = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('live adapter reconnects and merges history, discards stale account work, and scopes credentials', async () => {
  const originals = Object.fromEntries(['fetch', 'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    .map(name => [name, globalThis[name]]));
  const stored = new Map();
  globalThis.sessionStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  };
  const retries = [];
  globalThis.setTimeout = callback => { retries.push(callback); return retries.length; };
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  const identity = {
    emojiId: '1F602', gender: 'Male', color: '#F7C531', hairColor: '#111111',
    portraitId: 'spiked-tears-of-joy', currentMood: 'tears_of_joy',
  };
  const profile = { username: 'Alpha', identity, updatedAt: '2026-10-01T00:00:00Z' };
  const room = {
    roomId: 'ABC123', name: 'Test Beam', capacity: 2, createdAt: profile.updatedAt,
    hostParticipantId: 'member-a',
    participants: [{ participantId: 'member-a', displayName: 'Alpha', joinedAt: profile.updatedAt,
      isRegistered: true, identity, micEnabled: false, hostMuted: false, unmuteRequested: false }],
  };
  const session = { room, participantId: 'member-a', participantSessionId: 'fixture-capability-a' };
  const makeMessage = n => ({
    id: `message-${String(n).padStart(3, '0')}`, roomId: room.roomId, authorId: 'member-a',
    username: 'Alpha', identity, kind: 'text', text: `message ${n}`,
    createdAt: new Date(Date.parse(profile.updatedAt) + n * 1000).toISOString(),
  });
  const accepted = n => ({ message: makeMessage(n), profile });
  let history = [makeMessage(1)];
  let historyCalls = 0;
  let sendCalls = 0;
  const streams = [];
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['X-Room-Session'], session.participantSessionId);
    return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }), { status: 200 });
  };
  globalThis.__beamApi = {
    getMyProfile: async () => ({ profile }),
    createAccountRoom: async () => session,
    joinAccountRoom: async () => session,
    getRoom: async () => room,
    getRoomMessages: async () => { historyCalls++; return history; },
    heartbeatParticipant: async () => ({}),
    leaveRoom: async () => ({}),
    sendRoomMessage: async (_code, body, options) => {
      sendCalls++;
      assert.deepEqual(Object.keys(body).sort(), ['kind', 'text']);
      assert.equal(options.headers['X-Room-Session'], session.participantSessionId);
      return accepted(3);
    },
    saveMyProfile: async () => { throw new Error('Existing profile must not be reset on entry'); },
  };
  const messages = () => service.getState().rooms.ABC123.messages;
  const frame = data => new TextEncoder().encode(`event: chat.accepted\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    service.configureBeamAccount('account-a');
    await service.createBeam('Test Beam', 'Alpha', { portraitId: identity.portraitId, style: 'spiked', emoji: '😂', hairColor: '#111111' }, 2);
    await flush();
    assert.equal(historyCalls, 1);
    streams[0].enqueue(frame(accepted(1)));
    streams[0].enqueue(frame(accepted(2)));
    await flush();
    await service.sendMessage('ABC123', 'member-a', 'text', ' message 3 ');
    streams[0].enqueue(frame(accepted(3)));
    await flush();
    assert.deepEqual(messages().map(m => m.id), [1, 2, 3].map(n => makeMessage(n).id));
    streams[0].close();
    await flush();
    assert.equal(retries.length, 1);
    history = [makeMessage(4), makeMessage(2), makeMessage(1)];
    void retries.shift()();
    await flush();
    assert.equal(historyCalls, 2);
    assert.deepEqual(messages().map(m => m.id), [1, 2, 3, 4].map(n => makeMessage(n).id));
    assert.equal(service.getPersistenceNotice(), null);
    assert.equal(service.getProfileSnapshot().identity.currentMood, 'tears_of_joy');

    streams[1].close();
    await flush();
    history = Array.from({ length: 90 }, (_, n) => makeMessage(90 - n));
    void retries.shift()();
    await flush();
    assert.equal(messages().length, 60);
    assert.equal(messages()[0].id, makeMessage(31).id);
    assert.equal(messages().at(-1).id, makeMessage(90).id);

    const delayedSend = deferred();
    globalThis.__beamApi.sendRoomMessage = () => { sendCalls++; return delayedSend.promise; };
    const pendingSend = service.sendMessage('ABC123', 'member-a', 'text', 'late A message');
    service.configureBeamAccount('account-b');
    delayedSend.resolve(accepted(91));
    await pendingSend;
    assert.deepEqual(service.getState(), { version: 1, rooms: {}, session: null });
    assert.equal(service.getProfileSnapshot(), null);
    await assert.rejects(service.sendMessage('ABC123', 'member-a', 'text', 'cannot borrow A capability'));
    assert.equal(sendCalls, 2);

    service.configureBeamAccount('account-a');
    const delayedProfile = deferred();
    globalThis.__beamApi.getMyProfile = () => delayedProfile.promise;
    let creates = 0;
    globalThis.__beamApi.createAccountRoom = async () => { creates++; return session; };
    const pendingCreate = service.createBeam('Test Beam', 'Alpha', {}, 2);
    service.configureBeamAccount('account-b');
    delayedProfile.resolve({ profile });
    await assert.rejects(pendingCreate, /Account changed/);
    assert.equal(creates, 0);

    service.configureBeamAccount('account-a');
    globalThis.__beamApi.getRoomMessages = async () => [];
    const delayedHeartbeat = deferred();
    globalThis.__beamApi.heartbeatParticipant = () => delayedHeartbeat.promise;
    const pendingRestore = service.restoreBeam('ABC123');
    await flush();
    service.configureBeamAccount('account-b');
    delayedHeartbeat.resolve({});
    await pendingRestore;
    assert.deepEqual(service.getState(), { version: 1, rooms: {}, session: null });

    service.configureBeamAccount('account-a');
    globalThis.__beamApi.heartbeatParticipant = async () => ({});
    await service.restoreBeam('ABC123');
    await flush();
    const delayedLeave = deferred();
    globalThis.__beamApi.leaveRoom = () => delayedLeave.promise;
    const pendingLeave = service.leaveBeam('ABC123', 'member-a');
    service.configureBeamAccount('account-b');
    const sessionB = { ...session, participantId: 'member-b', participantSessionId: 'fixture-capability-b',
      room: { ...room, participants: [{ ...room.participants[0], participantId: 'member-b' }] } };
    stored.set('wb:room:account-b:ABC123', JSON.stringify(sessionB));
    globalThis.__beamApi.getRoom = async () => sessionB.room;
    globalThis.fetch = async () => new Response(new ReadableStream(), { status: 200 });
    await service.restoreBeam('ABC123');
    delayedLeave.resolve({});
    await pendingLeave;
    assert.equal(service.getState().session.selfId, 'member-b');
  } finally {
    service.configureBeamAccount(null);
    Object.assign(globalThis, originals);
    delete globalThis.__beamApi;
  }
});
