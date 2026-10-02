import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioEvent, AudioPeer } from "@workspace/room-audio";
import { RoomStore, RoomError, SESSION_TIMEOUT_MS } from "./room-store";
import { AudioSignaling } from "./audio-signaling";

function sink() {
  const events: AudioEvent[] = [];
  let closed = false;
  return {
    events,
    send(event: AudioEvent) { events.push(event); },
    close() { closed = true; },
    get closed() { return closed; },
    self(): AudioPeer {
      const ready = events.find((event) => event.type === "audio.ready");
      assert.ok(ready?.type === "audio.ready");
      return ready.data.self;
    },
  };
}

test("private credentials authenticate signaling; messages stay in the same room", () => {
  const store = new RoomStore();
  const relay = new AudioSignaling(store);
  const first = store.create("First");
  const second = store.join(first.room.roomId, "Second");
  const outsider = store.create("Outside");
  const a = sink(), b = sink(), c = sink();
  relay.connect(first.room.roomId, first.participantSessionId, a);
  relay.connect(first.room.roomId, second.participantSessionId, b);
  relay.connect(outsider.room.roomId, outsider.participantSessionId, c);
  assert.throws(() => relay.authorize(first.room.roomId, a.self().participantId),
    (error: unknown) => error instanceof RoomError && error.status === 401);
  assert.throws(() => relay.authorize(first.room.roomId, outsider.participantSessionId),
    (error: unknown) => error instanceof RoomError && error.status === 401);
  const from = a.self(), to = b.self();
  const input = {
    sourceConnectionId: from.connectionId,
    targetParticipantId: to.participantId, targetConnectionId: to.connectionId,
    description: { type: from.participantId < to.participantId ? "offer" as const : "answer" as const, sdp: "v=0\r\n" },
  };
  relay.signal(first.room.roomId, first.participantSessionId, input);
  assert.equal(b.events.filter((event) => event.type === "audio.signal").length, 1);
  assert.equal(a.events.filter((event) => event.type === "audio.signal").length, 0);
  assert.equal(c.events.filter((event) => event.type === "audio.signal").length, 0);
  assert.ok(!JSON.stringify(b.events).includes(first.participantSessionId));
  assert.throws(() => relay.signal(first.room.roomId, first.participantSessionId, {
    ...input, targetParticipantId: c.self().participantId, targetConnectionId: c.self().connectionId,
  }), (error: unknown) => error instanceof RoomError && error.status === 404);
});

test("reconnect fences stale signaling and an old disconnect cannot close its replacement", () => {
  const store = new RoomStore();
  const relay = new AudioSignaling(store);
  const first = store.create("First");
  const second = store.join(first.room.roomId, "Second");
  const a = sink(), b = sink(), replacement = sink();
  const oldDisconnect = relay.connect(first.room.roomId, first.participantSessionId, a);
  relay.connect(first.room.roomId, second.participantSessionId, b);
  relay.connect(first.room.roomId, first.participantSessionId, replacement);
  oldDisconnect();
  assert.ok(a.closed);
  assert.ok(!replacement.closed);
  assert.notEqual(a.self().connectionId, replacement.self().connectionId);
  assert.throws(() => relay.signal(first.room.roomId, first.participantSessionId, {
    sourceConnectionId: a.self().connectionId,
    targetParticipantId: b.self().participantId, targetConnectionId: b.self().connectionId,
    description: { type: "offer", sdp: "v=0\r\n" },
  }), (error: unknown) => error instanceof RoomError && error.status === 409);
  relay.disconnect(first.room.roomId, first.participantSessionId, a.self().connectionId);
  assert.ok(!replacement.closed);
  assert.equal(store.get(first.room.roomId).participants.length, 2);
});

test("leaving or heartbeat expiry closes audio; audio disconnect alone preserves room membership", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  const relay = new AudioSignaling(store);
  const first = store.create("First");
  const second = store.join(first.room.roomId, "Second");
  const a = sink(), b = sink();
  relay.connect(first.room.roomId, first.participantSessionId, a);
  relay.connect(first.room.roomId, second.participantSessionId, b);
  relay.disconnect(first.room.roomId, second.participantSessionId, b.self().connectionId);
  assert.ok(b.closed);
  assert.equal(store.get(first.room.roomId).participants.length, 2);
  const rejoinedAudio = sink();
  relay.connect(first.room.roomId, second.participantSessionId, rejoinedAudio);
  store.leave(first.room.roomId, second.participantSessionId);
  assert.ok(rejoinedAudio.closed);
  now = SESSION_TIMEOUT_MS;
  store.sweep();
  assert.ok(a.closed);
  assert.throws(() => relay.authorize(first.room.roomId, first.participantSessionId),
    (error: unknown) => error instanceof RoomError && error.status === 401);
});