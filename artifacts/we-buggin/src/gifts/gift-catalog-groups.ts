/** Keep the server's catalog order; custom gifts must not be hidden by a fixed allowlist. */
const SPECIAL_GIFT_IDS = new Set(['cosmic-encore', 'fireworks', 'rose-shower', 'whip']);

export function isSpecialGift(gift: { id: string }): boolean {
  return SPECIAL_GIFT_IDS.has(gift.id) || /^(studio|motion)-/.test(gift.id);
}
