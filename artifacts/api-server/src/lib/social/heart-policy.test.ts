import test from 'node:test';
import assert from 'node:assert/strict';
import { GIFTS } from './catalog';
import { HEART } from './heart-policy';
import { isRoomGift } from './room-gift-policy';
import { spiritSplit } from './spirit-pup-policy';
import { COSMIC_ENCORE } from './cosmic-encore-policy';
import { BIG_TIER_GIFTS } from './big-tier-gifts';

test('Heart is the entry-level room gift and splits 50 credits evenly', () => {
  assert.deepEqual(HEART, { id: 'heart', name: 'Heart', cost: 50 });
  const roomGiftIds = GIFTS
    .filter(gift => gift.id === 'heart' || gift.id === 'spirit-pup' || gift.id === 'moonfox' || gift.id === 'cosmic-encore'
      || gift.id === 'fireworks' || gift.id === 'rose-shower' || gift.id === 'whip')
    .map(gift => gift.id);
  assert.deepEqual(roomGiftIds, ['heart', 'spirit-pup', 'moonfox', 'cosmic-encore', 'fireworks', 'rose-shower', 'whip']);
  assert.equal(isRoomGift(HEART.id), true);
  assert.equal(isRoomGift('good-vibes'), false);
  assert.deepEqual(spiritSplit(HEART.cost), { recipientCredits: 25, houseCredits: 25 });
});

test('Cosmic Encore and the new big-tier gifts use the 2500-credit tier', () => {
  assert.deepEqual(COSMIC_ENCORE, { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 2500, durationMs: 6042 });
  assert.deepEqual(BIG_TIER_GIFTS, [
    { id: 'fireworks', name: 'Fireworks', cost: 2500, durationMs: 6042 },
    { id: 'rose-shower', name: 'Rose Shower', cost: 2500, durationMs: 6042 },
    { id: 'whip', name: 'Whip', cost: 2500, durationMs: 6042 },
  ]);
  assert.equal(GIFTS.at(-4)?.id, COSMIC_ENCORE.id);
  assert.equal(isRoomGift(COSMIC_ENCORE.id), true);
  assert.deepEqual(spiritSplit(COSMIC_ENCORE.cost), { recipientCredits: 1250, houseCredits: 1250 });
  for (const gift of BIG_TIER_GIFTS) {
    assert.equal(GIFTS.find(item => item.id === gift.id)?.cost, 2500);
    assert.equal(isRoomGift(gift.id), true);
    assert.deepEqual(spiritSplit(gift.cost), { recipientCredits: 1250, houseCredits: 1250 });
  }
});
