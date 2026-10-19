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
import { filterSendableGifts, isSendableGift } from "./gift-availability";

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
    db.select({ id: giftStudioAssets.id, giftId: giftStudioAssets.giftId, settings: giftStudioAssets.settings })
      .from(giftStudioAssets)
      .where(eq(giftStudioAssets.status, "active")),
  ]);
  return {
    settings: new Map(settings.map((row) => [row.giftId, row] as const)),
    activeNames: new Map(activeAssets.flatMap((row) => row.giftId
      ? [[row.giftId, giftNameFromSettings(row.settings, row.giftId)] as const]
      : [])),
    activeAssets: new Map(activeAssets.flatMap((row) => row.giftId
      ? [[row.giftId, { id: row.id, settings: row.settings }] as const]
      : [])),
  };
}

function catalogRecord(
  gift: (typeof GIFTS)[number],
  config: SocialGiftCatalogSettings | undefined,
  activeName: string | undefined,
  activeAsset?: { id: string; settings: Record<string, unknown> },
) {
  const iconStatus = activeAsset?.settings.iconStatus;
  const status = (config?.status ?? "active") as GiftCatalogStatus;
  return {
    id: gift.id,
    name: activeName ?? (config?.displayName?.trim() || gift.name),
    cost: config?.cost ?? gift.cost,
    productType: (config?.productType ?? "gift") as GiftStudioProductType,
    status,
    roomGift: (config?.productType ?? "gift") === "gift" && isRoomGift(gift.id),
    animationAvailable: true,
    iconUrl: activeAsset && status !== "deleted"
      ? `/api/social/gift-studio/icons/${activeAsset.id}?v=${encodeURIComponent(String(activeAsset.settings.iconRevision ?? 1))}`
      : null,
    iconStatus: activeAsset && (iconStatus === "transparent" || iconStatus === "fallback" || iconStatus === "manual-transparent" || iconStatus === "manual-fallback")
      ? iconStatus
      : activeAsset ? "fallback" : "builtin",
  };
}

export async function listGiftCatalogForOwner() {
  const data = await activeGiftData();
  const builtIns = GIFTS.map((gift) => catalogRecord(
    gift,
    data.settings.get(gift.id),
    data.activeNames.get(gift.id),
    data.activeAssets.get(gift.id),
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
      iconUrl: config.status !== "deleted" && data.activeAssets.has(config.giftId)
        ? `/api/social/gift-studio/icons/${data.activeAssets.get(config.giftId)!.id}?v=${encodeURIComponent(String(data.activeAssets.get(config.giftId)!.settings.iconRevision ?? 1))}`
        : null,
      iconStatus: (() => {
        const activeAsset = data.activeAssets.get(config.giftId);
        const status = activeAsset?.settings.iconStatus;
        return activeAsset && (status === "transparent" || status === "fallback" || status === "manual-transparent" || status === "manual-fallback")
          ? status
          : activeAsset ? "fallback" : "builtin";
      })(),
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
    const [config] = await db.select().from(socialGiftCatalogSettings)
      .where(eq(socialGiftCatalogSettings.giftId, giftId)).limit(1);
    return {
      id: motionGift.giftId,
      name: config?.displayName?.trim() || motionGift.name,
      cost: config?.cost ?? motionGift.cost,
      productType: (config?.productType ?? "gift") as GiftStudioProductType,
      status: (config?.status ?? (motionGift.active ? "active" : "deleted")) as GiftCatalogStatus,
      roomGift: true,
      animationAvailable: true,
      iconUrl: null,
      iconStatus: "builtin" as const,
    };
  }
  const gift = DEFAULT_GIFTS.get(giftId as (typeof GIFTS)[number]["id"]);
  const data = await activeGiftData();
  if (gift && gift.id === giftId) {
    return catalogRecord(gift, data.settings.get(giftId), data.activeNames.get(giftId), data.activeAssets.get(giftId));
  }
  const config = data.settings.get(giftId);
  if (!config) return null;
  const status = (config.status ?? "active") as GiftCatalogStatus;
  return {
    id: config.giftId,
    name: data.activeNames.get(giftId) ?? config.displayName?.trim() ?? giftId,
    cost: config.cost ?? 1,
    productType: (config.productType ?? "gift") as GiftStudioProductType,
    status,
    roomGift: (config.productType ?? "gift") === "gift",
    animationAvailable: data.activeNames.has(giftId),
    iconUrl: status !== "deleted" && data.activeAssets.has(giftId)
      ? `/api/social/gift-studio/icons/${data.activeAssets.get(giftId)!.id}?v=${encodeURIComponent(String(data.activeAssets.get(giftId)!.settings.iconRevision ?? 1))}`
      : null,
    iconStatus: (() => {
      const activeAsset = data.activeAssets.get(giftId);
      const status = activeAsset?.settings.iconStatus;
      return activeAsset && (status === "transparent" || status === "fallback" || status === "manual-transparent" || status === "manual-fallback")
        ? status
        : activeAsset ? "fallback" : "builtin";
    })(),
  };
}

export async function giftCatalogWithActiveNames() {
  const catalog = await listGiftCatalogForOwner();
  return filterSendableGifts(catalog)
    .filter(gift => !/^motion-[0-9a-f-]{36}$/.test(gift.id))
    .map(({ id, name, cost, iconUrl, iconStatus }) => ({ id, name, cost, iconUrl, iconStatus }));
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

    if (input.name !== undefined || input.status !== undefined) {
      const activeRows = await tx.select({ id: giftStudioAssets.id, settings: giftStudioAssets.settings })
        .from(giftStudioAssets)
        .where(and(eq(giftStudioAssets.giftId, gift.id), eq(giftStudioAssets.status, "active")));
      await Promise.all(activeRows.map((row) => tx.update(giftStudioAssets)
        .set({ settings: {
          ...row.settings,
          ...(input.name !== undefined ? { draftName: input.name.trim() } : {}),
          ...(input.status !== undefined
            ? { iconRevision: Number(row.settings.iconRevision ?? 0) + 1 }
            : {}),
        } })
        .where(eq(giftStudioAssets.id, row.id))));
    }
  });

  return getGiftCatalogItem(gift.id);
}

export async function getSendableGiftCatalogItem(giftId: string) {
  if (/^motion-[0-9a-f-]{36}$/.test(giftId)) return null;
  const item = await getGiftCatalogItem(giftId);
  if (!isSendableGift(item)) return null;
  return item;
}
