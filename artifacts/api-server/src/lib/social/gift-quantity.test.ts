import test from 'node:test';
import assert from 'node:assert/strict';
import { giftChargeTotal, MAX_GIFT_QUANTITY } from './gift-quantity';
import { planCreditSpend } from './credits-policy';

test('gift quantity charges unit price times the selected quantity', () => {
  assert.equal(giftChargeTotal(50, 1), 50);
  assert.equal(giftChargeTotal(50, 10), 500);
  assert.equal(giftChargeTotal(2500, 37), 92_500);
  assert.equal(giftChargeTotal(2500, 99), 247_500);
  assert.equal(giftChargeTotal(2500, 520), 1_300_000);
  assert.equal(giftChargeTotal(2500, MAX_GIFT_QUANTITY), 3_285_000);
});

test('gift quantity rejects invalid counts and totals that exceed a database integer', () => {
  assert.equal(giftChargeTotal(50, 0), null);
  assert.equal(giftChargeTotal(50, 1.5), null);
  assert.equal(giftChargeTotal(50, MAX_GIFT_QUANTITY + 1), null);
  assert.equal(giftChargeTotal(2_000_000, MAX_GIFT_QUANTITY), null);
});

test('an insufficient balance rejects the whole quantity without a partial debit', () => {
  const total = giftChargeTotal(2500, 99);
  assert.equal(total, 247_500);
  assert.deepEqual(planCreditSpend(247_499, total!, false), { allowed: false, debit: 247_500 });
  assert.deepEqual(planCreditSpend(247_500, total!, false), { allowed: true, debit: 247_500 });
});
