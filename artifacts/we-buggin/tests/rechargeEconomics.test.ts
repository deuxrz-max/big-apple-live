import assert from 'node:assert/strict';
import test from 'node:test';
import { CREDIT_BUNDLES, previewEconomics, RECHARGE_PREVIEW_POLICY } from '../src/social/credit-catalog';

test('all eleven exact USD prices buy one base coin per cent', () => {
  assert.deepEqual(CREDIT_BUNDLES.map(b => b.priceCents),
    [199, 699, 999, 1999, 2999, 4999, 9999, 39999, 99999, 199999, 299999]);
  assert.equal(new Set(CREDIT_BUNDLES.map(b => b.id)).size, 11);
  for (const b of CREDIT_BUNDLES) {
    assert.equal(b.baseCoins, b.priceCents);
    assert.equal(b.credits, b.baseCoins + b.bonusCoins);
    assert.equal(b.bonusCoins, Math.floor(b.baseCoins * b.bonusBasisPoints / 10_000));
  }
});

test('bonuses are a conservative graduated proposal, rounded down to whole coins', () => {
  assert.deepEqual(CREDIT_BUNDLES.map(b => b.bonusCoins), [1, 13, 29, 79, 149, 299, 699, 3199, 8999, 19999, 35999]);
  assert.equal(CREDIT_BUNDLES.at(-1)!.credits, 335998);
  assert.ok(CREDIT_BUNDLES.every(b => b.bonusCoins > 0));
});

test('all coins, including bonus, count toward full broadcaster liability at 3 per cent', () => {
  for (const b of CREDIT_BUNDLES) {
    const e = previewEconomics(b);
    assert.equal(e.liabilityThirdCents, b.baseCoins + b.bonusCoins);
    assert.equal(e.reserveCents, Math.ceil((b.baseCoins + b.bonusCoins) / 3));
    assert.equal(e.coinsPerUsd, b.credits * 100 / b.priceCents);
  }
});

test('unknown fees never produce an invented net margin or enable real checkout', () => {
  for (const b of CREDIT_BUNDLES) {
    assert.equal(previewEconomics(b).feeCents, null);
    assert.equal(previewEconomics(b).remainingCents, null);
  }
  assert.equal(RECHARGE_PREVIEW_POLICY.checkoutEnabled, false);
  assert.equal(RECHARGE_PREVIEW_POLICY.bonusesApproved, false);
  assert.equal(RECHARGE_PREVIEW_POLICY.processorFeesVerified, false);
  assert.deepEqual(RECHARGE_PREVIEW_POLICY.paymentMethods, ['card']);
});

test('fee illustration subtracts percent, fixed and other known costs with conservative rounding', () => {
  const b = CREDIT_BUNDLES[0]!;
  const e = previewEconomics(b, { percentBasisPoints: 350, fixedCents: 30, otherKnownCents: 10 });
  assert.equal(e.feeCents, 47);
  assert.equal(e.reserveCents, 67);
  assert.equal(e.remainingCents, 85);
  for (const pack of CREDIT_BUNDLES) {
    const example = previewEconomics(pack, { percentBasisPoints: 350, fixedCents: 30, otherKnownCents: 0 });
    assert.ok(example.remainingCents! > 0, 'illustration only, not a profit guarantee');
  }
});

test('high fees can erase the spread; model does not guarantee a positive margin', () => {
  assert.ok(previewEconomics(CREDIT_BUNDLES[0]!,
    { percentBasisPoints: 10000, fixedCents: 30, otherKnownCents: 0 }).remainingCents! < 0);
  assert.throws(() => previewEconomics(CREDIT_BUNDLES[0]!,
    { percentBasisPoints: 3.5, fixedCents: 30, otherKnownCents: 0 }), /Invalid fees/);
});
