import assert from "node:assert/strict";
import test from "node:test";
import { isRoomMicEnabled, shouldSubscribeToRoomAudio } from "../src/chat/room-audio-policy";

const slots = [
  { participantId: "speaker-a", micMuted: false, mutedByHost: false },
  { participantId: "speaker-b", micMuted: true, mutedByHost: false },
  { participantId: "speaker-c", micMuted: false, mutedByHost: true },
];

test("room audio connects only unmuted speakers to mic-on seated listeners", () => {
  assert.equal(isRoomMicEnabled(slots[0]), true);
  assert.equal(isRoomMicEnabled(slots[1]), false);
  assert.equal(isRoomMicEnabled(slots[2]), false);
  assert.equal(shouldSubscribeToRoomAudio({
    listenerId: "speaker-a", listenerMicEnabled: true, publisherId: "speaker-b",
    slots: slots.map(slot => slot.participantId === "speaker-b" ? { ...slot, micMuted: false } : slot),
  }), true);
  assert.equal(shouldSubscribeToRoomAudio({
    listenerId: "speaker-a", listenerMicEnabled: false, publisherId: "speaker-a", slots,
  }), false);
  assert.equal(shouldSubscribeToRoomAudio({
    listenerId: "speaker-a", listenerMicEnabled: true, publisherId: "speaker-a", slots,
  }), false);
  assert.equal(shouldSubscribeToRoomAudio({
    listenerId: "speaker-a", listenerMicEnabled: true, publisherId: "speaker-c", slots,
  }), false);
});
