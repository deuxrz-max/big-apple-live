/** Uploaded media reserved for homepage/system use, never user-selectable products. */
export const CAULDRON_VERSION_ID = "8ad11341-334c-4dd3-8ddf-d87622ec4b66";
export const CAULDRON_OVERFLOW_VERSION_ID = "4e90ea00-98be-4b14-a033-7dfb4138a4cb";

export function isSystemCauldronVersion(versionId: string): boolean {
  return versionId === CAULDRON_VERSION_ID || versionId === CAULDRON_OVERFLOW_VERSION_ID;
}

export function isSystemCauldronProduct(giftId: string): boolean {
  return giftId === `studio-${CAULDRON_VERSION_ID}`
    || giftId === `studio-${CAULDRON_OVERFLOW_VERSION_ID}`;
}

export function withoutSystemCauldronProducts<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter(item => !isSystemCauldronProduct(item.id));
}
