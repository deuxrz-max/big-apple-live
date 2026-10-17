import { and, eq } from "drizzle-orm";
import {
  db,
  giftStudioAssets,
  socialGiftCatalogSettings,
} from "@workspace/db";
import type { GiftStudioGiftId } from "@workspace/api-zod";
import type { SocialGiftCatalogSettings } from "@workspace/db";
import { RoomError } from "./room-store";
import { GIFTS } from "./social/catalog";
import { isRoomGift } from "./social/room-gift-policy";

const DEFAULT_GIFTS = new Map(GIFTS.map((gift) => [gift.id, gift] as const));
type GiftCatalogStatus = "active" | "inactive" | "deleted";

export function giftNameFromSettings(settings: unknown, giftId: string): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_GIFTS.get(giftId as GiftStudioGiftId)?.name ?? giftId;
  }
  const name = (settings as Record<string, unknown>).draftName;
  return typeof name === "string" && name.trim()
    ? name.trim().slice(0, 60)
    : DEFAULT_GIFTS.get(giftId as GiftStudioGiftId)?.name ?? giftId;
}

async function activeGiftData() {
  const [settings, activeAssets] = await Promise.all([
    db.select().from(socialGiftCatalogSettings),
    db.select({ giftId: giftStudioAssets.giftId, settings: giftStudioAssets.settings })
      .from(giftStudioAssets)
      .where(eq(giftStudioAssets.status, "active")),
  ]);
  return {
    settings: new Map(settings.map((row) => [row.giftId, row] as const)),
    activeNames: new Map(activeAssets.flatMap((row) => row.giftId
      ? [[row.giftId, giftNameFromSettings(row.settings, row.giftId)] as const]
      : [])),
  };
}

function catalogRecord(
  gift: (typeof GIFTS)[number],
  config: SocialGiftCatalogSettings | undefined,
  activeName: string | undefined,
) {
  return {
    id: gift.id,
    name: activeName ?? (config?.displayName?.trim() || gift.name),
    cost: config?.cost ?? gift.cost,
    status: (config?.status ?? "active") as GiftCatalogStatus,
    roomGift: isRoomGift(gift.id),
    animationAvailable: true,
  };
}

export async function listGiftCatalogForOwner() {
  const data = await activeGiftData();
  return GIFTS.map((gift) => catalogRecord(
    gift,
    data.settings.get(gift.id),
    data.activeNames.get(gift.id),
  ));
}

export async function getGiftCatalogItem(giftId: string) {
  const gift = DEFAULT_GIFTS.get(giftId as GiftStudioGiftId);
  if (!gift || gift.id !== giftId) return null;
  const data = await activeGiftData();
  return catalogRecord(gift, data.settings.get(giftId), data.activeNames.get(giftId));
}

export async function giftCatalogWithActiveNames() {
  return (await listGiftCatalogForOwner())
    .filter((gift) => gift.status === "active")
    .map(({ id, name, cost }) => ({ id, name, cost }));
}

export function mergeActiveGiftNames(activeNames: Map<string, string>) {
  return GIFTS.map((gift) => ({ ...gift, name: activeNames.get(gift.id) ?? gift.name }));
}

export async function activeGiftNames(giftIds: string[]): Promise<Map<string, string>> {
  const catalog = await listGiftCatalogForOwner();
  const selected = new Set(giftIds);
  return new Map(catalog.filter((gift) => selected.has(gift.id)).map((gift) => [gift.id, gift.name]));
}

export async function activeGiftDisplayName(giftId: GiftStudioGiftId) {
  return (await getGiftCatalogItem(giftId))?.name ?? DEFAULT_GIFTS.get(giftId)?.name ?? giftId;
}

export async function updateGiftCatalogItem(input: {
  giftId: string;
  name?: string;
  cost?: number;
  status?: GiftCatalogStatus;
}) {
  const gift = DEFAULT_GIFTS.get(input.giftId as GiftStudioGiftId);
  if (!gift || gift.id !== input.giftId) throw new RoomError(404, "Gift catalog item not found.");
  if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 60)) {
    throw new RoomError(400, "Gift names must be 1 to 60 characters.");
  }
  if (input.cost !== undefined && (!Number.isSafeInteger(input.cost) || input.cost < 1)) {
    throw new RoomError(400, "Gift prices must be whole positive credit amounts.");
  }

  await db.transaction(async (tx) => {
    const values: typeof socialGiftCatalogSettings.$inferInsert = {
      giftId: gift.id,
      ...(input.name !== undefined ? { displayName: input.name.trim() } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    };
    const set = {
      ...(input.name !== undefined ? { displayName: input.name.trim() } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    };
    await tx.insert(socialGiftCatalogSettings).values(values)
      .onConflictDoUpdate({ target: socialGiftCatalogSettings.giftId, set });

    if (input.name !== undefined) {
      const activeRows = await tx.select({ id: giftStudioAssets.id, settings: giftStudioAssets.settings })
        .from(giftStudioAssets)
        .where(and(eq(giftStudioAssets.giftId, gift.id), eq(giftStudioAssets.status, "active")));
      await Promise.all(activeRows.map((row) => tx.update(giftStudioAssets)
        .set({ settings: { ...row.settings, draftName: input.name!.trim() } })
        .where(eq(giftStudioAssets.id, row.id))));
    }
  });

  return getGiftCatalogItem(gift.id);
}

export async function getSendableGiftCatalogItem(giftId: string) {
  const item = await getGiftCatalogItem(giftId);
  if (!item || item.status !== "active") return null;
  return item;
}
