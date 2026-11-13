export type SendableGift = {
  status: string;
  productType: string;
  animationAvailable: boolean;
};

export function isSendableGift(item: SendableGift | null | undefined): boolean {
  return Boolean(
    item
      && item.status === "active"
      && item.productType === "gift",
  );
}

export function filterSendableGifts<T extends SendableGift>(items: readonly T[]): T[] {
  return items.filter(isSendableGift);
}

export function requireSendableGift<T extends SendableGift, E extends Error>(
  item: T | null | undefined,
  unavailableError: () => E,
): T {
  if (!item || !isSendableGift(item)) throw unavailableError();
  return item;
}
