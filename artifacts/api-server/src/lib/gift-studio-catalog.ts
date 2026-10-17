import { and, eq, inArray } from "drizzle-orm";
import { db, giftStudioAssets } from "@workspace/db";
import type { GiftStudioGiftId } from "@workspace/api-zod";
import { GIFTS } from "./social/catalog";

const GIFT_IDS = new Set<GiftStudioGiftId>([
  "heart", "spirit-pup", "moonfox", "cosmic-encore", "fireworks", "rose-shower", "whip",
]);
const DEFAULT_GIFT_NAMES = new Map(GIFTS.map((gift) => [gift.id, gift.name] as const));

export function giftNameFromSettings(settings: unknown, giftId: string): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_GIFT_NAMES.get(giftId as GiftStudioGiftId) ?? giftId;
  }
  const name = (settings as Record<string, unknown>).draftName;
  return typeof name === "string" && name.trim()
    ? name.trim().slice(0, 60)
    : DEFAULT_GIFT_NAMES.get(giftId as GiftStudioGiftId) ?? giftId;
}

export function mergeActiveGiftNames(overrides: ReadonlyMap<string, string>) {
  return GIFTS.map((gift) => ({ ...gift, name: overrides.get(gift.id) ?? gift.name }));
}

export async function activeGiftNames(giftIds?: readonly string[]) {
  const ids = giftIds === undefined
    ? [...GIFT_IDS]
    : [...new Set(giftIds.filter((id): id is GiftStudioGiftId => GIFT_IDS.has(id as GiftStudioGiftId)))];
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ giftId: giftStudioAssets.giftId, settings: giftStudioAssets.settings })
    .from(giftStudioAssets)
    .where(and(eq(giftStudioAssets.status, "active"), inArray(giftStudioAssets.giftId, ids)));
  return new Map(rows.flatMap((row) => row.giftId
    ? [[row.giftId, giftNameFromSettings(row.settings, row.giftId)] as const]
    : []));
}

export async function giftCatalogWithActiveNames() {
  return mergeActiveGiftNames(await activeGiftNames());
}

export async function activeGiftDisplayName(giftId: GiftStudioGiftId) {
  return (await activeGiftNames([giftId])).get(giftId) ?? DEFAULT_GIFT_NAMES.get(giftId) ?? giftId;
}
