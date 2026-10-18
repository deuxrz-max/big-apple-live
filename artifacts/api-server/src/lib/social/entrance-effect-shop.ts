import { and, eq, sql } from "drizzle-orm";
import {
  accountRoomEntranceEffects, db, giftStudioAssets, socialLedger, socialSettings, socialWallets,
} from "@workspace/db";
import { RoomError } from "../room-store";
import { requireAdult } from "../community";
import { getActiveGiftStudioMedia } from "../gift-studio";
import { getGiftCatalogItem, listGiftCatalogForOwner } from "../gift-studio-catalog";
import { hasDevelopmentUnlimitedCredits, planCreditSpend } from "./credits-policy";
import { ensureSocial, lockAccounts, replay, requireAccount, wallet } from "./core";

const catalogEffectId = /^(good-vibes|big-love|standing-ovation|heart|spirit-pup|moonfox|cosmic-encore|fireworks|rose-shower|whip|studio-[0-9a-f-]{36})$/i;

export async function listEntranceEffectShop(accountId: string) {
  await requireAccount(accountId);
  await requireAdult(accountId);
  await ensureSocial(accountId);
  const [catalog, ownedRows, [settings]] = await Promise.all([
    listGiftCatalogForOwner(),
    db.select({ effectId: accountRoomEntranceEffects.effectId })
      .from(accountRoomEntranceEffects).where(eq(accountRoomEntranceEffects.accountId, accountId)),
    db.select({ equipped: socialSettings.equippedEntranceEffectId })
      .from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1),
  ]);
  const owned = new Set(ownedRows.map((row) => row.effectId));
  const products = catalog.filter((item) =>
    (item.productType === "entrance-effect" && item.status === "active") || owned.has(item.id),
  );
  const items = await Promise.all(products.map(async (item) => {
    const { media } = await getActiveGiftStudioMedia(item.id);
    return {
      id: item.id,
      name: item.name,
      cost: item.cost,
      availableForPurchase: item.productType === "entrance-effect" && item.status === "active" && item.animationAvailable,
      owned: owned.has(item.id),
      equipped: settings?.equipped === item.id,
      media: media ? {
        versionId: media.versionId,
        webmUrl: media.webmUrl,
        safariUrl: media.safariUrl,
        durationMs: media.durationMs,
      } : null,
    };
  }));
  return { items };
}

export async function purchaseEntranceEffect(accountId: string, effectId: string, requestId: string) {
  if (!catalogEffectId.test(effectId)) throw new RoomError(400, "Choose a valid entrance effect.");
  const buyer = await requireAccount(accountId);
  await requireAdult(accountId);
  const item = await getGiftCatalogItem(effectId);
  if (!item || item.productType !== "entrance-effect" || item.status !== "active" || !item.animationAvailable) {
    throw new RoomError(404, "This entrance effect is no longer available to buy.");
  }
  const result = await db.transaction(async (tx) => {
    await lockAccounts(tx, [accountId]);
    const reference = `entrance-effect:${effectId}`;
    if (await replay(tx, accountId, requestId, reference)) {
      return { purchased: false, wallet: await wallet(accountId, tx, buyer.username) };
    }
    const [owned] = await tx.select({ effectId: accountRoomEntranceEffects.effectId })
      .from(accountRoomEntranceEffects)
      .where(and(eq(accountRoomEntranceEffects.accountId, accountId), eq(accountRoomEntranceEffects.effectId, effectId)))
      .limit(1);
    if (owned) return { purchased: false, wallet: await wallet(accountId, tx, buyer.username) };

    const current = await wallet(accountId, tx, buyer.username);
    const unlimited = hasDevelopmentUnlimitedCredits(buyer.username);
    const spend = planCreditSpend(current.balance, item.cost, unlimited);
    if (!spend.allowed) throw new RoomError(409, "You need more coins to buy this entrance effect.");
    if (spend.debit > 0) {
      await tx.update(socialWallets)
        .set({ balance: sql`${socialWallets.balance} - ${spend.debit}` })
        .where(eq(socialWallets.accountId, accountId));
    }
    await tx.insert(socialLedger).values({
      accountId,
      delta: -(unlimited ? item.cost : spend.debit),
      kind: "purchase",
      description: `${item.name} entrance effect${unlimited ? " (development unlimited coins)" : ""}`,
      requestKey: requestId,
      refKey: reference,
    });
    await tx.insert(accountRoomEntranceEffects).values({ accountId, effectId }).onConflictDoNothing();
    return { purchased: true, wallet: await wallet(accountId, tx, buyer.username) };
  });
  return { effectId, ...result };
}

export async function equipEntranceEffect(accountId: string, effectId: string | null) {
  await requireAccount(accountId);
  await requireAdult(accountId);
  if (effectId !== null) {
    if (!catalogEffectId.test(effectId)) throw new RoomError(400, "Choose a valid entrance effect.");
    const [owned] = await db.select({ id: accountRoomEntranceEffects.effectId })
      .from(accountRoomEntranceEffects)
      .where(and(eq(accountRoomEntranceEffects.accountId, accountId), eq(accountRoomEntranceEffects.effectId, effectId)))
      .limit(1);
    if (!owned) throw new RoomError(403, "Buy this entrance effect before equipping it.");
    const item = await getGiftCatalogItem(effectId);
    if (!item || !item.animationAvailable) throw new RoomError(404, "This effect has no active animation right now.");
    if (effectId.startsWith("studio-")) {
      const [activeVersion] = await db.select({ id: giftStudioAssets.id })
        .from(giftStudioAssets)
        .where(and(eq(giftStudioAssets.giftId, effectId), eq(giftStudioAssets.status, "active")))
        .limit(1);
      if (!activeVersion) throw new RoomError(404, "This effect has no active animation right now.");
    }
  }
  await ensureSocial(accountId);
  await db.transaction(async (tx) => {
    await lockAccounts(tx, [accountId]);
    await tx.update(socialSettings).set({
      equippedEntranceEffectId: effectId,
      updatedAt: new Date(),
    }).where(eq(socialSettings.accountId, accountId));
  });
  return { effectId };
}
