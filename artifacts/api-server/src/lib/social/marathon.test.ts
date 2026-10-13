import assert from "node:assert/strict";
import { test } from "node:test";
import { nextLoginStreak } from "./marathon-policy";

test("daily login streak still counts days but no longer awards retired badges", () => {
  const first = nextLoginStreak(undefined, new Date("2090-01-01T12:00:00Z"));
  assert.deepEqual(first, { day: "2090-01-01", count: 1, changed: true });
  const sameDay = nextLoginStreak({ lastLoginDay: first.day, consecutiveDays: first.count },
    new Date("2090-01-01T23:00:00Z"));
  assert.deepEqual(sameDay, { day: "2090-01-01", count: 1, changed: false });
  const second = nextLoginStreak({ lastLoginDay: first.day, consecutiveDays: first.count },
    new Date("2090-01-02T00:05:00Z"));
  assert.deepEqual(second, { day: "2090-01-02", count: 2, changed: true });
  assert.equal("award" in second, false);
});
