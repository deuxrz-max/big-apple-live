import test from "node:test";
import assert from "node:assert/strict";
import { RoomStore, RoomError } from "./room-store";
import { UniversityVideoBeamStore } from "./university-video-beam";

test("room seats are audio-only and keep nine-seat voice behavior", () => {
  let now = 1_000;
  const rooms = new RoomStore(() => now);
  rooms.registerCommunity({ roomId: "MUSIC1", historyId: "history-audio", label: "Music", createdAt: new Date(now) });
  const member = rooms.join("MUSIC1", "Speaker", {
    accountId: "account-1",
    identity: { emojiId: "1F600", gender: "Male", color: "#F7C531", hairColor: "#111111" },
  });
  const store = new UniversityVideoBeamStore(rooms, () => now);
  let state = store.joinSlot("MUSIC1", member.participantId, "account-1");
  assert.equal(state.slots.length, 9);
  assert.equal(state.beamActive, true);
  assert.equal(state.tv.enabled, false);
  assert.equal(state.tv.searchAvailable, false);
  assert.equal(state.slots[0]?.micMuted, true);
  assert.equal(state.slots[0]?.cameraOff, true);

  state = store.markConnected("MUSIC1", member.participantId);
  assert.equal(store.connectedSeatOccupants("MUSIC1")[0]?.accountId, "account-1");
  store.assertSelfMedia("MUSIC1", member.participantId, "mic", true);
  state = store.setSelfMedia("MUSIC1", member.participantId, "mic", true);
  assert.equal(state.slots[0]?.micMuted, false);
  assert.throws(() => store.assertSelfMedia("MUSIC1", member.participantId, "camera", true),
    (error: unknown) => error instanceof RoomError && error.status === 410);

  state = store.leaveSlot("MUSIC1", member.participantId);
  assert.equal(state.beamActive, false);
  assert.equal(state.slots[0]?.participantId, null);
  assert.equal(store.connectedSeatOccupants("MUSIC1").length, 0);
  now += 1;
});

test("social rooms have four explicitly claimed boxes without automatic seating", () => {
  const rooms = new RoomStore();
  const identity = { emojiId: "1F600", gender: "Male" as const, color: "#FFFFFF", hairColor: "#000000" };
  const created = rooms.createSocialRoom("ABCDEF123456", "four-seats", "Test", "Owner", { accountId: "owner", identity });
  const store = new UniversityVideoBeamStore(rooms);
  const roomId = created.room.roomId;
  const members = Array.from({ length: 5 }, (_, i) => rooms.join(roomId, `Guest${i}`, { accountId: `guest-${i}`, identity }));
  let state = store.getState(roomId);
  assert.equal(state.slots.length, 4);
  assert.ok(state.slots.every(slot => slot.participantId === null), "joining a room does not claim a box");
  state = store.joinSlot(roomId, members[0]!.participantId, "guest-0", 4);
  assert.equal(state.slots[3]!.participantId, members[0]!.participantId);
  assert.equal(state.slots[0]!.participantId, null);
  assert.throws(() => store.joinSlot(roomId, members[1]!.participantId, "guest-1", 4), /unavailable/);
  assert.throws(() => store.joinSlot(roomId, members[1]!.participantId, "guest-1", 5), /available player box/);
  for (let i = 1; i < 4; i++) store.joinSlot(roomId, members[i]!.participantId, `guest-${i}`, i);
  assert.throws(() => store.joinSlot(roomId, members[4]!.participantId, "guest-4"), /unavailable/);
  state = store.leaveSlot(roomId, members[0]!.participantId);
  assert.equal(state.slots[3]!.participantId, null);
  state = store.joinSlot(roomId, members[4]!.participantId, "guest-4", 4);
  assert.equal(state.slots[3]!.participantId, members[4]!.participantId);
  assert.ok(state.slots.every(slot => slot.cameraOff && slot.micMuted));
});
