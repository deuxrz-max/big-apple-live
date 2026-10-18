export const MAX_GIFT_QUANTITY = 1314;
const MAX_DATABASE_INTEGER = 2_147_483_647;

/** Returns the per-recipient charge for a gift bundle, or null if it cannot be stored safely. */
export function giftChargeTotal(unitCost: number, quantity: number): number | null {
  if (!Number.isSafeInteger(unitCost) || unitCost < 1
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_GIFT_QUANTITY) return null;
  const total = unitCost * quantity;
  return Number.isSafeInteger(total) && total <= MAX_DATABASE_INTEGER ? total : null;
}
