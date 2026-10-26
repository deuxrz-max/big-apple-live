import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleAfterWin, rewardCycleBounds, rewardCycleKey, rewardDrawTimes, WIN_COOLDOWN_MS } from "./pink-card-policy";

test("daily entry cycle changes at 3 AM Eastern, not midnight UTC", () => {
  assert.equal(rewardCycleKey(new Date("2026-10-26T06:59:59Z")), "2026-10-25");
  assert.equal(rewardCycleKey(new Date("2026-10-26T07:00:00Z")), "2026-10-26");
  assert.equal(rewardCycleKey(new Date("2026-12-26T07:59:59Z")), "2026-12-25");
  assert.equal(rewardCycleKey(new Date("2026-12-26T08:00:00Z")), "2026-12-26");
});
test("Eastern cycles follow DST (23/25 hours), cooldown stays exactly 24 hours", () => {
  const short = rewardCycleBounds(new Date("2026-03-07T12:00:00Z"));
  const long = rewardCycleBounds(new Date("2026-10-31T12:00:00Z"));
  assert.equal(short.end.getTime() - short.start.getTime(), 23 * 3_600_000);
  assert.equal(long.end.getTime() - long.start.getTime(), 25 * 3_600_000);
  const win = new Date("2026-03-07T08:00:00Z");
  assert.equal(eligibleAfterWin(win, new Date(+win + WIN_COOLDOWN_MS - 1)), false);
  assert.equal(eligibleAfterWin(win, new Date(+win + WIN_COOLDOWN_MS)), true);
});
test("six distinct random slots stay inside daily cycle at both random extremes", () => {
  const { start, end } = rewardCycleBounds(new Date("2026-10-26T15:00:00Z"));
  for (const rng of [() => 0, (max: number) => max - 1]) {
    const times = rewardDrawTimes(start, end, rng);
    assert.equal(times.length, 6);
    assert.equal(new Set(times.map(Number)).size, 6);
    assert.ok(times.every(at => at >= start && at < end));
    assert.ok(times.every((at, i) => !i || at > times[i - 1]!));
  }
});
test("new participants are eligible; future win timestamps fail closed", () => {
  const now = new Date();
  assert.equal(eligibleAfterWin(null, now), true);
  assert.equal(eligibleAfterWin(new Date(+now + 1), now), false);
});
