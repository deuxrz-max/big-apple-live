import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { ROOM_VISUALS_SOCKET_PATH, type RoomMoodUpdate } from '@workspace/beam-identity';
import { RoomStore } from './room-store';
import { attachRoomMoodSocket } from './room-mood-socket';
import type { ChatAccepted } from '@workspace/api-zod';

function socketEvent<T = unknown>(socket: ReturnType<typeof io>, event: string): Promise<T> {
  return new Promise(resolve => socket.once(event, (data: T) => resolve(data)));
}

test('real sockets synchronize bursts and moods, isolate rooms, reject spoofing and revoke departed sessions', { timeout: 10000 }, async t => {
  const store = new RoomStore();
  const identity = { emojiId: '1F642', gender: 'Male' as const, color: '#F7C531', hairColor: '#111111' };
  const a = store.create('Host', { accountId: 'a', identity }, { name: 'Test', capacity: 4 });
  const b = store.join(a.room.roomId, 'Visitor', { accountId: 'b', identity });
  const outside = store.create('Other', { accountId: 'c', identity }, { name: 'Other', capacity: 4 });
  const server = createServer();
  const relay = attachRoomMoodSocket(server, store)!;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const sockets: ReturnType<typeof io>[] = [];
  const make = (roomId: string, participantSessionId: string) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      path: ROOM_VISUALS_SOCKET_PATH, transports: ['polling'],
      auth: { roomId, participantSessionId }, autoConnect: false, reconnection: false,
    });
    sockets.push(socket);
    return socket;
  };
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise<void>(resolve => relay.close(() => resolve()));
  });
  const host = make(a.room.roomId, a.participantSessionId);
  const visitor = make(a.room.roomId, b.participantSessionId);
  const other = make(outside.room.roomId, outside.participantSessionId);
  const bursts: unknown[][] = [[], [], []];
  for (const [index, socket] of [host, visitor, other].entries()) {
    socket.on('emoji_particle', event => bursts[index]!.push(event));
    const connected = socketEvent(socket, 'connect');
    socket.connect();
    await connected;
  }
  const invalid = make(a.room.roomId, outside.participantSessionId);
  const denied = socketEvent<Error>(invalid, 'connect_error');
  invalid.connect();
  assert.match((await denied).message, /Join this Beam/);
  // Incoming effect events are ignored; only committed chat is authoritative.
  host.emit('emoji_particle', { roomId: a.room.roomId, emoji: '❤️' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(bursts[0]!.length, 0);
  const h = socketEvent(host, 'emoji_particle'), v = socketEvent(visitor, 'emoji_particle');
  store.publishChat(a.room.roomId, store.getHistoryId(a.room.roomId),
    { message: { id: 'committed', text: '💜💜😊' } } as ChatAccepted);
  assert.deepEqual(await h, await v);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(bursts[0]!.length, 2);
  assert.equal(bursts[1]!.length, 2);
  assert.equal(bursts[2]!.length, 0);
  const moodHost = socketEvent<RoomMoodUpdate>(host, 'room_mood_update');
  const moodVisitor = socketEvent<RoomMoodUpdate>(visitor, 'room_mood_update');
  store.tickRoomMoods();
  const mh = await moodHost, mv = await moodVisitor;
  assert.deepEqual(mh, mv);
  assert.equal(mh.emoji, '💜');
  assert.equal(store.getRoomMood(outside.room.roomId).emoji, null);
  const departed = socketEvent(visitor, 'disconnect');
  store.leave(a.room.roomId, b.participantSessionId);
  await departed;
  assert.equal(visitor.connected, false);
  assert.equal(host.connected, true);
});
