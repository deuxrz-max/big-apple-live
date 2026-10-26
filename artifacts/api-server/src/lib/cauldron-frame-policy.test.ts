import assert from "node:assert/strict";
import { test } from "node:test";
import { cauldronFrameTime } from "./cauldron-frame-policy";

test("zero uses the empty first frame and full never reaches the loop reset", () => {
  assert.equal(cauldronFrameTime(0), 0);
  assert.equal(cauldronFrameTime(50), 2.2);
  assert.equal(cauldronFrameTime(100), 5.5);
});
test("all display levels advance monotonically within the fill segment", () => {
  let previous = -1;
  for (let level = 0; level <= 100; level++) {
    const time = cauldronFrameTime(level);
    assert.ok(time > previous && time <= 5.5);
    previous = time;
  }
});
test("invalid levels are rejected before media processing", () => {
  for (const level of [-1, 101, 0.5, NaN, Infinity]) assert.throws(() => cauldronFrameTime(level));
});
