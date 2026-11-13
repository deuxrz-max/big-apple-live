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
