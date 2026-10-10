import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDIT_BUNDLES, formatUsd, savingsPercent } from '../src/social/credit-catalog';

test('only the revised USD bundles are offered', () => {
  assert.deepEqual(CREDIT_BUNDLES.map(({ credits, priceCents }) => [credits, priceCents]), [
    [500, 499], [1000, 899], [2500, 1799],
  ]);
  assert.equal(new Set(CREDIT_BUNDLES.map(b => b.id)).size, 3);
  assert.deepEqual(CREDIT_BUNDLES.map(b => formatUsd(b.priceCents)), ['$4.99', '$8.99', '$17.99']);
});

test('larger packs have progressively better per-credit value', () => {
  assert.deepEqual(CREDIT_BUNDLES.map(savingsPercent), [0, 10, 28]);
  for (let i = 1; i < CREDIT_BUNDLES.length; i++) {
    const previous = CREDIT_BUNDLES[i - 1], current = CREDIT_BUNDLES[i];
    assert.ok(current.priceCents / current.credits < previous.priceCents / previous.credits);
  }
});
