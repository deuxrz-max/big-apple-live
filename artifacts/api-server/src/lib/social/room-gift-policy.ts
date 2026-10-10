import { HEART } from './heart-policy';
import { MOONFOX } from './moonfox-policy';
import { SPIRIT_PUP } from './spirit-pup-policy';

const ROOM_GIFT_IDS = new Set<string>([HEART.id, SPIRIT_PUP.id, MOONFOX.id]);

export function isRoomGift(giftId: string): boolean {
  return ROOM_GIFT_IDS.has(giftId);
}
