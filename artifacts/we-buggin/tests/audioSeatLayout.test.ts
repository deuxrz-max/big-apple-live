import assert from "node:assert/strict";
import test from "node:test";
import { arrangeAudioSeats } from "../src/chat/audio-seat-layout";

test("audio room keeps nine seats with the active host centered", () => {
  const slots = Array.from({ length: 9 }, (_, index) => ({
    slotNumber: index + 1,
    participantId: index === 4 ? "host" : `player-${index + 1}`,
  }));
  const layout = arrangeAudioSeats(slots, "host");
  assert.equal(layout.length, 9);
  assert.deepEqual(layout.find(item => item.slot.participantId === "host"),
    { slot: slots[4], area: "host", gridColumn: 3, gridRow: 1 });
  assert.equal(layout.filter(item => item.area === "left").length, 4);
  assert.equal(layout.filter(item => item.area === "right").length, 4);
});
