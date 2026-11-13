import test from 'node:test';
import assert from 'node:assert/strict';
import { GIFTING_LEVEL_THRESHOLDS, giftingProgress } from '@workspace/beam-identity';
import {
  giftingPerks, isGiftLocked, levelUpToCelebrate, normalizeGiftingLevel, profileGiftingProgress,
} from '../src/gifting/gifting';

test('levels clamp to 0..100', () => {
  assert.equal(normalizeGiftingLevel(-3), 0);
  assert.equal(normalizeGiftingLevel(140), 100);
  assert.equal(normalizeGiftingLevel(undefined), 0);
  assert.equal(normalizeGiftingLevel(31.9), 31);
});

test('gifting levels and name colors remain while badge and entrance perks are retired', () => {
  assert.equal(giftingPerks(0).tierNameColor, false);
  assert.equal(giftingPerks(10).tierNameColor, false);
  assert.equal(giftingPerks(11).tierNameColor, true);
  for (let level = 0; level <= 100; level++) {
    assert.equal(giftingPerks(level).tierNameColor, level >= 11);
    assert.deepEqual(Object.keys(giftingPerks(level)), ['tierNameColor']);
  }
});

test('legacy exclusive flags never lock gifts at any level', () => {
  assert.equal(isGiftLocked({ id: 'a' }, 0), false);
  assert.equal(isGiftLocked({ id: 'a', platinumExclusive: false }, 1), false);
  for (let level = 0; level <= 100; level++) {
    assert.equal(isGiftLocked({ id: 'a', platinumExclusive: true }, level), false);
  }
  assert.equal(isGiftLocked({ id: 'a', platinumExclusive: true }, 61), false);
  assert.equal(isGiftLocked(undefined, 0), false);
});

test('profile progress uses shared thresholds and handles max', () => {
  const xp = GIFTING_LEVEL_THRESHOLDS[31]! + 5;
  const p = profileGiftingProgress(31, xp);
  assert.equal(p.level, 31);
  assert.equal(p.tier.key, 'gold');
  assert.equal(p.currentLevelXp, giftingProgress(xp).currentLevelXp);
  const max = profileGiftingProgress(100, GIFTING_LEVEL_THRESHOLDS[100]!);
  assert.equal(max.isMax, true);
  assert.equal(max.xpRemaining, 0);
  assert.equal(profileGiftingProgress(0, 0).level, 0);
});

test('level-up celebrates only real increases after a baseline', () => {
  assert.equal(levelUpToCelebrate(null, 40), null);
  assert.equal(levelUpToCelebrate(40, 40), null);
  assert.equal(levelUpToCelebrate(40, 39), null);
  assert.equal(levelUpToCelebrate(40, 42), 42);
});
