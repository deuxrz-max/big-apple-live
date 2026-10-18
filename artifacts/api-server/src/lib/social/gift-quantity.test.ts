import test from 'node:test';
import assert from 'node:assert/strict';
import { giftChargeTotal, MAX_GIFT_QUANTITY } from './gift-quantity';

test('gift quantity charges unit price times the selected quantity', () => {
  assert.equal(giftChargeTotal(50, 1), 50);
  assert.equal(giftChargeTotal(50, 10), 500);
  assert.equal(giftChargeTotal(2500, MAX_GIFT_QUANTITY), 3_285_000);
});

test('gift quantity rejects invalid counts and totals that exceed a database integer', () => {
  assert.equal(giftChargeTotal(50, 0), null);
  assert.equal(giftChargeTotal(50, 1.5), null);
  assert.equal(giftChargeTotal(50, MAX_GIFT_QUANTITY + 1), null);
  assert.equal(giftChargeTotal(2_000_000, MAX_GIFT_QUANTITY), null);
});
