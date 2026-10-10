import test from 'node:test';
import assert from 'node:assert/strict';
import { GIFTS } from './catalog';
import { HEART } from './heart-policy';
import { isRoomGift } from './room-gift-policy';
import { spiritSplit } from './spirit-pup-policy';

test('Heart is the entry-level room gift and splits 50 credits evenly', () => {
  assert.deepEqual(HEART, { id: 'heart', name: 'Heart', cost: 50 });
  const roomGiftIds = GIFTS
    .filter(gift => gift.id === 'heart' || gift.id === 'spirit-pup' || gift.id === 'moonfox')
    .map(gift => gift.id);
  assert.deepEqual(roomGiftIds, ['heart', 'spirit-pup', 'moonfox']);
  assert.equal(isRoomGift(HEART.id), true);
  assert.equal(isRoomGift('good-vibes'), false);
  assert.deepEqual(spiritSplit(HEART.cost), { recipientCredits: 25, houseCredits: 25 });
});
