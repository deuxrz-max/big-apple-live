import test from 'node:test';
import assert from 'node:assert/strict';
import { GIFTS } from './catalog';
import { HEART } from './heart-policy';
import { isRoomGift } from './room-gift-policy';
import { spiritSplit } from './spirit-pup-policy';
import { COSMIC_ENCORE } from './cosmic-encore-policy';

test('Heart is the entry-level room gift and splits 50 credits evenly', () => {
  assert.deepEqual(HEART, { id: 'heart', name: 'Heart', cost: 50 });
  const roomGiftIds = GIFTS
    .filter(gift => gift.id === 'heart' || gift.id === 'spirit-pup' || gift.id === 'moonfox' || gift.id === 'cosmic-encore')
    .map(gift => gift.id);
  assert.deepEqual(roomGiftIds, ['heart', 'spirit-pup', 'moonfox', 'cosmic-encore']);
  assert.equal(isRoomGift(HEART.id), true);
  assert.equal(isRoomGift('good-vibes'), false);
  assert.deepEqual(spiritSplit(HEART.cost), { recipientCredits: 25, houseCredits: 25 });
});

test('Cosmic Encore is the top-tier room gift and splits 1250 credits evenly', () => {
  assert.deepEqual(COSMIC_ENCORE, { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 2500, durationMs: 6042 });
  assert.equal(GIFTS.at(-1)?.id, COSMIC_ENCORE.id);
  assert.equal(isRoomGift(COSMIC_ENCORE.id), true);
  assert.deepEqual(spiritSplit(COSMIC_ENCORE.cost), { recipientCredits: 1250, houseCredits: 1250 });
});
