import assert from "node:assert/strict";
import test from "node:test";
import { hasDevelopmentUnlimitedCredits, planCreditSpend } from "./credits-policy";

test("unlimited credits are restricted to Vampsquad in development", () => {
  assert.equal(hasDevelopmentUnlimitedCredits("Vampsquad", "development"), true);
  assert.equal(hasDevelopmentUnlimitedCredits("VAMPSQUAD", "development"), true);
  assert.equal(hasDevelopmentUnlimitedCredits("TestBigo1", "development"), false);
  assert.equal(hasDevelopmentUnlimitedCredits("Vampsquad", "production"), false);
  assert.equal(hasDevelopmentUnlimitedCredits("Vampsquad", "test"), false);
});

test("the development allowance bypasses spend checks without debiting the stored balance", () => {
  assert.deepEqual(planCreditSpend(0, 2_500, true), { allowed: true, debit: 0 });
  assert.deepEqual(planCreditSpend(0, 2_500, false), { allowed: false, debit: 2_500 });
  assert.deepEqual(planCreditSpend(3_000, 2_500, false), { allowed: true, debit: 2_500 });
});
