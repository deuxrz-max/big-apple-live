import { randomUUID } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, accountProfiles, socialCreditPurchases, socialLedger, socialSettings, socialWallets } from "@workspace/db";
import { RoomError, roomStore } from "../room-store";
import { lockAccounts, requireAccount } from "./core";
import { monthlyPurchaseBadgeSummary } from "./monthly-credit-badges";
import { evaluateMonthlyPurchaseBadges } from "./monthly-credit-badge-policy";
import { claimRoomEntranceEffect } from "../room-entrance-effects";
import { accountEntranceEffectSelection } from "./entrance-effect-preferences";

/**
 * Call only after the payment provider's signature and completed transaction
 * have been verified. No public route exposes this operation.
 */
export async function recordConfirmedCreditPurchase(
  accountId: string,
  provider: string,
  providerPurchaseId: string,
  credits: number,
  confirmedAt = new Date(),
) {
  await requireAccount(accountId);
  const [profileFlags] = await db.select({
    isTestAccount: accountProfiles.isTestAccount,
    username: accountProfiles.username,
  })
    .from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
  if (profileFlags?.isTestAccount) throw new RoomError(403, "Test accounts cannot create purchase-tier badges");
  if (!/^[a-z][a-z0-9_-]{1,39}$/i.test(provider)
    || !providerPurchaseId.trim() || providerPurchaseId.length > 255
    || !Number.isSafeInteger(credits) || credits < 1
    || !Number.isFinite(confirmedAt.getTime())) {
    throw new RoomError(400, "Invalid confirmed credit-purchase record");
  }

  const saved = await db.transaction(async tx => {
    await lockAccounts(tx, [accountId]);
    const monthStart = new Date(Date.UTC(confirmedAt.getUTCFullYear(), confirmedAt.getUTCMonth(), 1));
    const purchasesBefore = await tx.select({
      accountId: socialCreditPurchases.accountId,
      credits: socialCreditPurchases.credits,
      confirmedAt: socialCreditPurchases.confirmedAt,
    }).from(socialCreditPurchases).where(and(
      eq(socialCreditPurchases.accountId, accountId),
      gte(socialCreditPurchases.confirmedAt, monthStart),
      lte(socialCreditPurchases.confirmedAt, confirmedAt),
    ));
    const badgesBefore = evaluateMonthlyPurchaseBadges(purchasesBefore, confirmedAt).result.get(accountId) ?? [];
    const [inserted] = await tx.insert(socialCreditPurchases).values({
      accountId, provider, providerPurchaseId, credits, confirmedAt,
    }).onConflictDoNothing().returning({ id: socialCreditPurchases.id });
    if (!inserted) {
      const [existing] = await tx.select().from(socialCreditPurchases).where(and(
        eq(socialCreditPurchases.provider, provider),
        eq(socialCreditPurchases.providerPurchaseId, providerPurchaseId),
      ));
      if (!existing || existing.accountId !== accountId || existing.credits !== credits)
        throw new RoomError(409, "This payment reference was already applied to a different purchase");
      return { duplicate: true, newlyEarned: null };
    }

    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${credits}` })
      .where(eq(socialWallets.accountId, accountId));
    await tx.insert(socialLedger).values({
      accountId, delta: credits, kind: "credit_purchase",
      description: `Confirmed credit purchase · ${credits.toLocaleString("en-US")} credits`,
      requestKey: randomUUID(), refKey: `credit-purchase:${provider}:${providerPurchaseId}`,
    });
    const purchasesAfter = await tx.select({
      accountId: socialCreditPurchases.accountId,
      credits: socialCreditPurchases.credits,
      confirmedAt: socialCreditPurchases.confirmedAt,
    }).from(socialCreditPurchases).where(and(
      eq(socialCreditPurchases.accountId, accountId),
      gte(socialCreditPurchases.confirmedAt, monthStart),
      lte(socialCreditPurchases.confirmedAt, confirmedAt),
    ));
    const badgesAfter = evaluateMonthlyPurchaseBadges(purchasesAfter, confirmedAt).result.get(accountId) ?? [];
    const newlyEarned = badgesAfter.filter(badge => !badgesBefore.some(previous =>
      previous.tier.id === badge.tier.id && previous.earnedAt.getTime() === badge.earnedAt.getTime()))
      .sort((a, b) => b.tier.rank - a.tier.rank)[0] ?? null;
    if (newlyEarned) {
      await tx.update(socialSettings).set({
        equippedBadgeId: newlyEarned.tier.id,
        badgeEquipPreferenceSet: true,
        updatedAt: new Date(),
      }).where(eq(socialSettings.accountId, accountId));
    }
    return { duplicate: false, newlyEarned };
  });

  const after = await monthlyPurchaseBadgeSummary(accountId, confirmedAt);
  const activeRoomIds = roomStore.activeRoomIdsForAccount(accountId);
  if (!saved.duplicate && saved.newlyEarned && activeRoomIds.length > 0) {
    const selectedEffect = await accountEntranceEffectSelection(accountId);
    const effect = selectedEffect?.effectId === saved.newlyEarned.tier.entranceEffectId
      ? await claimRoomEntranceEffect(accountId, selectedEffect.effectId, confirmedAt.getTime())
      : null;
    if (effect && selectedEffect) {
      for (const roomId of activeRoomIds) {
        try {
          roomStore.publishRoomEntranceEffect(roomId, accountId, effect, selectedEffect.durationMs);
        } catch {
          // A session may expire between discovery and publish; remaining rooms still get the event.
        }
      }
    }
  }
  return { credited: !saved.duplicate, balance: (await db.select({ balance: socialWallets.balance })
    .from(socialWallets).where(eq(socialWallets.accountId, accountId)))[0]?.balance ?? 0,
    badgeId: after?.tier.id ?? null };
}
