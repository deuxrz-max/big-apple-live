import assert from "node:assert/strict";
import test from "node:test";
import { CASH_OUT_SETTINGS, quoteCashOutGold } from "./cash-out-policy";

test("cash-out quote enforces 30,000 gold minimum and exact cent storage", () => {
  assert.equal(CASH_OUT_SETTINGS.minimumGold, 30_000);
  assert.deepEqual(quoteCashOutGold(29_999), null);
  assert.deepEqual(quoteCashOutGold(30_000), { gold: 30_000, cents: 5_397, currency: "USD" });
  assert.deepEqual(quoteCashOutGold(60_000), { gold: 60_000, cents: 10_794, currency: "USD" });
});

test("amounts above the minimum use a proportional rate rounded once to cents", () => {
  assert.deepEqual(quoteCashOutGold(30_001), { gold: 30_001, cents: 5_397, currency: "USD" });
  assert.deepEqual(quoteCashOutGold(30_003), { gold: 30_003, cents: 5_398, currency: "USD" });
  assert.throws(() => quoteCashOutGold(1.5), /whole number/);
  assert.throws(() => quoteCashOutGold(-1), /nonnegative/);
});
