import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseCoinDropRooms,
  coinDropAmount,
  displayHangoutStreakDays,
  easternHangoutDayKey,
  isSeatQualified,
  nextHangoutStreakState,
  previousHangoutDay,
  randomizedDropDelayMs,
  seatSinceAfterJoin,
} from "./community-hangout-policy";

test("coin drops choose one or two occupied rooms and never every public room", () => {
  for (const eligibleCount of [1, 2, 3, 7]) {
    for (const random of [() => 0, () => 0.49, () => 0.5, () => 0.999]) {
      const selected = chooseCoinDropRooms(
        Array.from({ length: eligibleCount }, (_, index) => `room-${index}`),
        7,
        random,
      );
      assert.ok(selected.length >= 1 && selected.length <= 2);
      assert.ok(selected.length < 7);
      assert.equal(new Set(selected).size, selected.length);
    }
  }
  assert.deepEqual(chooseCoinDropRooms(["only"], 1, () => 0), []);
  assert.deepEqual(chooseCoinDropRooms([], 7, () => 0), []);
});

test("coin drop values cover only the inclusive server-selected 1–100 range", () => {
  assert.equal(coinDropAmount(() => 0), 1);
  assert.equal(coinDropAmount(() => 0.5), 51);
  assert.equal(coinDropAmount(() => 0.999999), 100);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(coinDropAmount(() => (index + 0.5) / 100), index + 1);
  }
});

test("seat eligibility is based on server-side tenure and survives a same-room seat move", () => {
  const now = 10_000_000;
  assert.equal(isSeatQualified(now - 15 * 60_000 + 1, now), false);
  assert.equal(isSeatQualified(now - 15 * 60_000, now), true);
  assert.equal(seatSinceAfterJoin("MUSIC", 1234, "MUSIC", now), 1234);
  assert.equal(seatSinceAfterJoin(null, null, "MUSIC", now), now);
  // Leaving deletes the stored row; joining later therefore starts a new tenure.
  assert.equal(seatSinceAfterJoin(null, null, "MUSIC", now + 20_000), now + 20_000);
});

test("hangout days roll over at 3 AM Eastern in both standard and daylight time", () => {
  assert.equal(easternHangoutDayKey(new Date("2026-01-15T07:59:00Z")), "2026-01-14"); // 2:59 AM EST
  assert.equal(easternHangoutDayKey(new Date("2026-01-15T08:00:00Z")), "2026-01-15"); // 3:00 AM EST
  assert.equal(easternHangoutDayKey(new Date("2026-07-15T06:59:00Z")), "2026-07-14"); // 2:59 AM EDT
  assert.equal(easternHangoutDayKey(new Date("2026-07-15T07:00:00Z")), "2026-07-15"); // 3:00 AM EDT
  assert.equal(previousHangoutDay("2026-01-01"), "2025-12-31");
});

test("seven consecutive hangout days pay once, start a new cycle, and a missed day resets", () => {
  let state: ReturnType<typeof nextHangoutStreakState>["state"] | null = null;
  let payouts = 0;
  for (let day = 1; day <= 7; day += 1) {
    const result = nextHangoutStreakState(state, `2026-03-0${day}`);
    state = result.state;
    if (result.rewardedNow) payouts += 1;
    assert.equal(state.consecutiveDays, day);
  }
  assert.equal(payouts, 1);
  assert.equal(nextHangoutStreakState(state, "2026-03-07").rewardedNow, false);
  assert.equal(displayHangoutStreakDays(state, "2026-03-07"), 7);
  const nextCycle = nextHangoutStreakState(state, "2026-03-08");
  assert.equal(nextCycle.state.consecutiveDays, 1);
  assert.equal(nextCycle.rewardedNow, false);
  assert.equal(displayHangoutStreakDays(state, "2026-03-09"), 0);
  assert.equal(nextHangoutStreakState(state, "2026-03-09").state.consecutiveDays, 1);
});

test("randomized reward intervals stay between half and one-and-a-half of the setting", () => {
  assert.equal(randomizedDropDelayMs(60, () => 0), 30 * 60_000);
  const nearMaximum = randomizedDropDelayMs(60, () => 0.999999);
  assert.ok(nearMaximum <= 90 * 60_000);
  assert.ok(nearMaximum > 90 * 60_000 - 10);
});
