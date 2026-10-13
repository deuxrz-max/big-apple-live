import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, accountProfiles, socialCreditPurchases, socialLedger, socialSettings, socialWallets } from "@workspace/db";
import { RoomError, roomStore } from "../room-store";
import { lockAccounts, requireAccount } from "./core";
import { monthlyPurchaseBadgeSummary } from "./monthly-credit-badges";
import { claimRoomEntranceEffect } from "../room-entrance-effects";
import { hasOwnerTierTestAccess } from "./owner-entrance-effects-policy";

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

  const before = await monthlyPurchaseBadgeSummary(accountId, confirmedAt);
  const saved = await db.transaction(async tx => {
    await lockAccounts(tx, [accountId]);
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
      return { duplicate: true };
    }

    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${credits}` })
      .where(eq(socialWallets.accountId, accountId));
    await tx.insert(socialLedger).values({
      accountId, delta: credits, kind: "credit_purchase",
      description: `Confirmed credit purchase · ${credits.toLocaleString("en-US")} credits`,
      requestKey: randomUUID(), refKey: `credit-purchase:${provider}:${providerPurchaseId}`,
    });
    return { duplicate: false };
  });

  const after = await monthlyPurchaseBadgeSummary(accountId, confirmedAt);
  const newlyReachedHigherTier = after && (!before || after.tier.rank > before.tier.rank);
  const activeRoomIds = roomStore.activeRoomIdsForAccount(accountId);
  const [entrancePreferences] = await db.select({
    enabled: socialSettings.entranceEffectsEnabled,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1);
  const ownerPreview = profileFlags ? hasOwnerTierTestAccess(profileFlags, process.env.NODE_ENV) : false;
  if (!ownerPreview && entrancePreferences?.enabled !== false
    && !saved.duplicate && newlyReachedHigherTier && activeRoomIds.length > 0) {
    const effect = await claimRoomEntranceEffect(accountId, after.tier.entranceEffectId, confirmedAt.getTime());
    if (effect) {
      for (const roomId of activeRoomIds) {
        try {
          roomStore.publishRoomEntranceEffect(roomId, accountId, effect, after.tier.durationMs);
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
