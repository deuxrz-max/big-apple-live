import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore, SESSION_TIMEOUT_MS } from "./room-store";
import { AudioSignaling } from "./audio-signaling";
import type { EmojiIdentity, RoomState } from "@workspace/api-zod";
import type { AudioEvent } from "@workspace/room-audio";

const identity: EmojiIdentity = { emojiId: "1F600", gender: "Male", color: "#12AB9F", hairColor: "#8912EF" };

test("saved identity follows its account only, broadcasts edits, and cannot mutate stored state", () => {
  const store = new RoomStore();
  const a = store.create("DedicatedA", { accountId: "account-a", identity });
  const b = store.join(a.room.roomId, "DedicatedB", {
    accountId: "account-b", identity: { ...identity, gender: "Female", color: "#020304" },
  });
  const otherRoom = store.create("DedicatedA", { accountId: "account-a", identity });
  const guest = store.join(a.room.roomId, "Guest");
  let snapshot: RoomState | undefined;
  store.subscribe(a.room.roomId, (event) => { if (event.type === "room.snapshot") snapshot = event.data; });
  a.room.participants[0]!.identity!.color = "#FFFFFF";
  assert.equal(store.getSessionParticipant(a.room.roomId, a.participantSessionId).identity!.color, "#12AB9F");
  const changed = { ...identity, gender: "Female" as const, color: "#010203" };
  store.updateAccountIdentity("account-a", "DedicatedA", changed);
  changed.color = "#FFFFFF";
  assert.equal(snapshot!.participants.find((p) => p.participantId === a.participantId)!.identity!.color, "#010203");
  assert.equal(store.get(otherRoom.room.roomId).participants[0]!.identity!.gender, "Female");
  assert.equal(store.getSessionParticipant(a.room.roomId, b.participantSessionId).identity!.color, "#020304");
  assert.equal(store.getSessionParticipant(a.room.roomId, guest.participantSessionId).identity, null);
  const publicState = JSON.stringify(store.get(a.room.roomId));
  assert.ok(!publicState.includes("account-a"));
  assert.ok(!publicState.includes(a.participantSessionId));
  assert.equal(store.get(a.room.roomId).participants.length, 3);
});

test("changing an identity preserves audio generations and does not extend presence", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  const relay = new AudioSignaling(store);
  const a = store.create("A", { accountId: "owner", identity });
  const events: AudioEvent[] = [];
  let closed = false;
  relay.connect(a.room.roomId, a.participantSessionId, {
    send: (event) => events.push(event), close: () => { closed = true; },
  });
  const readyCount = events.filter((e) => e.type === "audio.ready").length;
  now = SESSION_TIMEOUT_MS - 1;
  store.updateAccountIdentity("owner", "A", { ...identity, color: "#ABCDEF" });
  assert.equal(events.filter((e) => e.type === "audio.ready").length, readyCount);
  assert.equal(closed, false);
  now = SESSION_TIMEOUT_MS;
  store.sweep();
  assert.equal(closed, true);
  assert.equal(store.get(a.room.roomId).participants.length, 0);
});

test("only the creator can control another microphone; activation requires visitor consent", () => {
  const store = new RoomStore();
  const host = store.create("Creator");
  const visitor = store.join(host.room.roomId, "Visitor");
  const other = store.join(host.room.roomId, "Other");
  const code = host.room.roomId;
  const target = visitor.participantId;
  const get = () => store.get(code).participants.find(p => p.participantId === target)!;
  assert.equal(store.get(code).hostParticipantId, host.participantId);
  assert.equal(get().micEnabled, false);
  assert.throws(() => store.controlMicrophone(code, other.participantSessionId, target, "mute"), { status: 403 });
  assert.throws(() => store.controlMicrophone(code, visitor.participantSessionId, other.participantId, "request-unmute"), { status: 403 });
  assert.throws(() => store.controlMicrophone(code, host.participantSessionId, target, "unmute"), { status: 403 });
  assert.throws(() => store.controlMicrophone(code, "bogus", target, "mute"), { status: 401 });
  assert.throws(() => store.controlMicrophone(code, host.participantSessionId, "bogus", "mute"), { status: 404 });
  let notices = 0;
  store.subscribe(code, event => { if (event.type === "room.snapshot") notices++; });
  store.controlMicrophone(code, host.participantSessionId, target, "request-unmute");
  assert.equal(get().micEnabled, false);
  assert.equal(get().unmuteRequested, true);
  store.controlMicrophone(code, visitor.participantSessionId, target, "unmute");
  assert.equal(get().micEnabled, true);
  assert.equal(get().unmuteRequested, false);
  store.controlMicrophone(code, host.participantSessionId, target, "mute");
  assert.equal(get().micEnabled, false);
  assert.equal(get().hostMuted, true);
  assert.throws(() => store.controlMicrophone(code, visitor.participantSessionId, target, "unmute"), { status: 403 });
  store.controlMicrophone(code, host.participantSessionId, target, "request-unmute");
  assert.equal(get().hostMuted, false);
  assert.equal(get().micEnabled, false);
  store.controlMicrophone(code, visitor.participantSessionId, target, "unmute");
  store.controlMicrophone(code, visitor.participantSessionId, target, "mute");
  assert.equal(get().micEnabled, false);
  assert.equal(notices, 6);
  assert.equal(store.getSessionParticipant(code, visitor.participantSessionId).micEnabled, false);
  const beforeLeave = store.get(code);
  store.leave(code, host.participantSessionId);
  assert.equal(store.get(code).hostParticipantId, beforeLeave.hostParticipantId);
  assert.throws(() => store.controlMicrophone(code, other.participantSessionId, target, "mute"), { status: 403 });
});