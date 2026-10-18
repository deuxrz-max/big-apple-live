import assert from "node:assert/strict";
import test from "node:test";
import { createRandomGiftMotion, guessGiftMotionCategory } from "../src/gifts/gift-motion-utils";

test("sample car model name and low-profile bounds are detected as a vehicle", () => {
  assert.equal(guessGiftMotionCategory("sample-race-car.glb", [2.8, 0.72, 1.35]), "vehicle");
});

test("sample character model name and upright bounds are detected as a character", () => {
  assert.equal(guessGiftMotionCategory("sample-character.glb", [0.65, 2.2, 0.5]), "character");
});

test("shuffled motion is bounded, six seconds long, and includes a detected animation", () => {
  const preset = createRandomGiftMotion("vehicle", 2);
  assert.equal(preset.version, 1);
  assert.equal(preset.durationMs, 6000);
  assert.equal(preset.category, "vehicle");
  assert.notEqual(preset.entry, preset.exit);
  assert.equal(preset.animationIndex === 0 || preset.animationIndex === 1, true);
  assert.ok(preset.speed >= 0.5 && preset.speed <= 1.5);
  assert.equal(preset.spin.length, 3);
  assert.ok(preset.spin.every((axis) => axis >= -6.3 && axis <= 6.3));
});
