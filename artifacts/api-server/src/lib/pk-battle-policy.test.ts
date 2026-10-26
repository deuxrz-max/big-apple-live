import assert from "node:assert/strict";
import test from "node:test";
import {
  battleWinner, PK_BATTLE_LENGTH_MS, PK_BONUS_END_MS, PK_BONUS_START_MS,
  PK_COUNTDOWN_MS, PK_SEARCH_TIMEOUT_MS, pkPointsForGift, pkWeeklyReset,
} from "./pk-battle-policy";

test("PK search, countdown, battle and bonus windows match the requested schedule", () => {
  assert.equal(PK_SEARCH_TIMEOUT_MS, 60_000);
  assert.equal(PK_COUNTDOWN_MS, 3_000);
  assert.equal(PK_BATTLE_LENGTH_MS, 300_000);
  assert.equal(PK_BONUS_START_MS, 120_000);
  assert.equal(PK_BONUS_END_MS, 180_000);
});

test("PK gifts score 2x only during elapsed minutes three through four", () => {
  assert.equal(pkPointsForGift(125, 119_999), 125);
  assert.equal(pkPointsForGift(125, 120_000), 250);
  assert.equal(pkPointsForGift(125, 179_999), 250);
  assert.equal(pkPointsForGift(125, 180_000), 125);
});

test("ties have no winner and unequal scores select the higher-scoring broadcaster", () => {
  assert.equal(battleWinner(500, 500, "a", "b"), null);
  assert.equal(battleWinner(501, 500, "a", "b"), "a");
  assert.equal(battleWinner(499, 500, "a", "b"), "b");
});

test("weekly PK reset is Monday at 3 AM Eastern on both sides of daylight saving changes", () => {
  assert.equal(pkWeeklyReset(new Date("2026-03-09T16:00:00.000Z")).toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(pkWeeklyReset(new Date("2026-11-02T20:00:00.000Z")).toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(pkWeeklyReset(new Date("2026-11-02T07:59:00.000Z")).toISOString(), "2026-10-26T07:00:00.000Z");
});
