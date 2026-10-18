import { and, eq } from "drizzle-orm";
import {
  db,
  developerGiftMotions,
  giftStudioAssets,
  socialGiftCatalogSettings,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { SocialGiftCatalogSettings } from "@workspace/db";
import { RoomError } from "./room-store";
import { GIFTS } from "./social/catalog";
import { isRoomGift } from "./social/room-gift-policy";

const DEFAULT_GIFTS = new Map(GIFTS.map((gift) => [gift.id, gift] as const));
type GiftCatalogStatus = "active" | "inactive" | "deleted";
export type GiftStudioProductType = "gift" | "entrance-effect";

export function giftNameFromSettings(settings: unknown, giftId: string): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_GIFTS.get(giftId as (typeof GIFTS)[number]["id"])?.name ?? giftId;
  }
  const name = (settings as Record<string, unknown>).draftName;
  return typeof name === "string" && name.trim()
    ? name.trim().slice(0, 60)
    : DEFAULT_GIFTS.get(giftId as (typeof GIFTS)[number]["id"])?.name ?? giftId;
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
    productType: (config?.productType ?? "gift") as GiftStudioProductType,
    status: (config?.status ?? "active") as GiftCatalogStatus,
    roomGift: (config?.productType ?? "gift") === "gift" && isRoomGift(gift.id),
    animationAvailable: true,
  };
}

export async function listGiftCatalogForOwner() {
  const data = await activeGiftData();
  const builtIns = GIFTS.map((gift) => catalogRecord(
    gift,
    data.settings.get(gift.id),
    data.activeNames.get(gift.id),
  ));
  const builtInIds = new Set<string>(GIFTS.map((gift) => gift.id));
  const custom = [...data.settings.values()]
    .filter((config) => !builtInIds.has(config.giftId))
    .map((config) => ({
      id: config.giftId,
      name: data.activeNames.get(config.giftId) ?? config.displayName?.trim() ?? config.giftId,
      cost: config.cost ?? 1,
      productType: (config.productType ?? "gift") as GiftStudioProductType,
      status: config.status as GiftCatalogStatus,
      roomGift: (config.productType ?? "gift") === "gift",
      animationAvailable: data.activeNames.has(config.giftId),
    }));
  return [...builtIns, ...custom];
}

export async function getGiftCatalogItem(giftId: string) {
  const [motionGift] = await db.select({
    giftId: developerGiftMotions.giftId,
    name: developerGiftMotions.name,
    cost: developerGiftMotions.cost,
    active: developerGiftMotions.active,
  }).from(developerGiftMotions)
    .where(eq(developerGiftMotions.giftId, giftId))
    .limit(1);
  if (motionGift) {
    return {
      id: motionGift.giftId,
      name: motionGift.name,
      cost: motionGift.cost,
      productType: "gift" as const,
      status: motionGift.active ? "active" as const : "deleted" as const,
      roomGift: true,
      animationAvailable: true,
    };
  }
  const gift = DEFAULT_GIFTS.get(giftId as (typeof GIFTS)[number]["id"]);
  const data = await activeGiftData();
  if (gift && gift.id === giftId) {
    return catalogRecord(gift, data.settings.get(giftId), data.activeNames.get(giftId));
  }
  const config = data.settings.get(giftId);
  if (!config) return null;
  return {
    id: config.giftId,
    name: data.activeNames.get(giftId) ?? config.displayName?.trim() ?? giftId,
    cost: config.cost ?? 1,
    productType: (config.productType ?? "gift") as GiftStudioProductType,
    status: config.status as GiftCatalogStatus,
    roomGift: (config.productType ?? "gift") === "gift",
    animationAvailable: data.activeNames.has(giftId),
  };
}

export async function giftCatalogWithActiveNames() {
  const catalog = await listGiftCatalogForOwner();
  return catalog.filter((gift) =>
    !/^motion-[0-9a-f-]{36}$/.test(gift.id)
      && gift.status === "active"
      && gift.productType === "gift"
      && gift.animationAvailable,
  ).map(({ id, name, cost }) => ({ id, name, cost }));
}

export function mergeActiveGiftNames(activeNames: Map<string, string>) {
  return GIFTS.map((gift) => ({ ...gift, name: activeNames.get(gift.id) ?? gift.name }));
}

export async function activeGiftNames(giftIds: string[]): Promise<Map<string, string>> {
  const catalog = await listGiftCatalogForOwner();
  const selected = new Set(giftIds);
  const names = new Map(catalog.filter((gift) => selected.has(gift.id)).map((gift) => [gift.id, gift.name]));
  if (giftIds.length) {
    const motionRows = await db.select({ id: developerGiftMotions.giftId, name: developerGiftMotions.name })
      .from(developerGiftMotions).where(inArray(developerGiftMotions.giftId, giftIds));
    for (const row of motionRows) names.set(row.id, row.name);
  }
  return names;
}

export async function activeGiftDisplayName(giftId: string) {
  return (await getGiftCatalogItem(giftId))?.name ?? DEFAULT_GIFTS.get(giftId as (typeof GIFTS)[number]["id"])?.name ?? giftId;
}

export async function updateGiftCatalogItem(input: {
  giftId: string;
  name?: string;
  cost?: number;
  status?: GiftCatalogStatus;
  productType?: GiftStudioProductType;
}) {
  const gift = await getGiftCatalogItem(input.giftId);
  if (!gift) throw new RoomError(404, "Gift catalog item not found.");
  if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 60)) {
    throw new RoomError(400, "Names must be 1 to 60 characters.");
  }
  if (input.cost !== undefined && (!Number.isSafeInteger(input.cost) || input.cost < 1)) {
    throw new RoomError(400, "Prices must be whole positive coin amounts.");
  }

  await db.transaction(async (tx) => {
    const values: typeof socialGiftCatalogSettings.$inferInsert = {
      giftId: gift.id,
      ...(input.name !== undefined ? { displayName: input.name.trim() } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.productType !== undefined ? { productType: input.productType } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    };
    const set = {
      ...(input.name !== undefined ? { displayName: input.name.trim() } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.productType !== undefined ? { productType: input.productType } : {}),
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
  if (/^motion-[0-9a-f-]{36}$/.test(giftId)) return null;
  const item = await getGiftCatalogItem(giftId);
  if (!item || item.status !== "active" || item.productType !== "gift" || !item.animationAvailable) return null;
  return item;
}
