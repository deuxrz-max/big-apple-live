import { HEART } from './heart-policy';
import { MOONFOX } from './moonfox-policy';
import { SPIRIT_PUP } from './spirit-pup-policy';
import { COSMIC_ENCORE } from './cosmic-encore-policy';
import { BIG_TIER_GIFTS } from './big-tier-gifts';

const ROOM_GIFT_IDS = new Set<string>([
  HEART.id, SPIRIT_PUP.id, MOONFOX.id, COSMIC_ENCORE.id, ...BIG_TIER_GIFTS.map(gift => gift.id),
]);

export function isRoomGift(giftId: string): boolean {
  return ROOM_GIFT_IDS.has(giftId);
}
