import assert from "node:assert/strict";
import test from "node:test";
import { planCreditSpend } from "./credits-policy";

test("an explicitly authorized test allowance bypasses spend checks without debiting the stored balance", () => {
  assert.deepEqual(planCreditSpend(0, 2_500, true), { allowed: true, debit: 0 });
  assert.deepEqual(planCreditSpend(0, 2_500, false), { allowed: false, debit: 2_500 });
  assert.deepEqual(planCreditSpend(3_000, 2_500, false), { allowed: true, debit: 2_500 });
});
