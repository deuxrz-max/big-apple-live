import assert from "node:assert/strict";
import test from "node:test";
import { CASH_OUT_SETTINGS, quoteCashOutGold, quoteEarnedCashOut } from "./cash-out-policy";

test("cash-out quote enforces 30,000 gold minimum and exact cent storage", () => {
  assert.equal(CASH_OUT_SETTINGS.minimumGold, 30_000);
  assert.deepEqual(quoteCashOutGold(29_999), null);
  assert.equal(CASH_OUT_SETTINGS.payoutsEnabled, false);
  assert.deepEqual(quoteCashOutGold(30_000), { gold: 30_000, cents: 10_000, currency: "USD" });
  assert.deepEqual(quoteCashOutGold(60_000), { gold: 60_000, cents: 20_000, currency: "USD" });
});

test("amounts above the minimum convert only whole three-unit groups to cents", () => {
  assert.deepEqual(quoteCashOutGold(30_001), { gold: 30_001, cents: 10_000, currency: "USD" });
  assert.deepEqual(quoteCashOutGold(30_003), { gold: 30_003, cents: 10_001, currency: "USD" });
  assert.deepEqual(quoteCashOutGold(30_002), { gold: 30_002, cents: 10_000, currency: "USD" });
  assert.throws(() => quoteCashOutGold(1.5), /whole number/);
  assert.throws(() => quoteCashOutGold(-1), /nonnegative/);
});

test("purchased coins never qualify, combine with, or alter earned cash-out units", () => {
  assert.equal(quoteEarnedCashOut({ purchasedCoins: 1_000_000, earnedUnits: 0 }), null);
  assert.equal(quoteEarnedCashOut({ purchasedCoins: 1_000_000, earnedUnits: 29_999 }), null);
  assert.deepEqual(quoteEarnedCashOut({ purchasedCoins: 1_000_000, earnedUnits: 30_000 }),
    { gold: 30_000, cents: 10_000, currency: "USD" });
  assert.throws(() => quoteEarnedCashOut({ purchasedCoins: -1, earnedUnits: 30_000 }), /Balances/);
});
