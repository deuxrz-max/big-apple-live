import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accountProfiles, db, socialCreditPurchases, socialLedger, socialWallets } from "@workspace/db";
import { RoomError } from "../room-store";
import { lockAccounts, requireAccount } from "./core";

/**
 * Applies only a provider-verified purchase. Purchase-tier badges and entrance
 * effects have been retired; purchase records and purchased coin balances remain.
 */
export async function recordConfirmedCreditPurchase(
  accountId: string,
  provider: string,
  providerPurchaseId: string,
  credits: number,
  confirmedAt = new Date(),
) {
  await requireAccount(accountId);
  const [profileFlags] = await db.select({ isTestAccount: accountProfiles.isTestAccount })
    .from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
  if (profileFlags?.isTestAccount) throw new RoomError(403, "Test accounts cannot buy coins.");
  if (!/^[a-z][a-z0-9_-]{1,39}$/i.test(provider)
    || !providerPurchaseId.trim() || providerPurchaseId.length > 255
    || !Number.isSafeInteger(credits) || credits < 1
    || !Number.isFinite(confirmedAt.getTime())) {
    throw new RoomError(400, "Invalid confirmed coin-purchase record");
  }

  const inserted = await db.transaction(async tx => {
    await lockAccounts(tx, [accountId]);
    const [purchase] = await tx.insert(socialCreditPurchases).values({
      accountId, provider, providerPurchaseId, credits, confirmedAt,
    }).onConflictDoNothing().returning({ id: socialCreditPurchases.id });
    if (!purchase) {
      const [existing] = await tx.select().from(socialCreditPurchases).where(and(
        eq(socialCreditPurchases.provider, provider),
        eq(socialCreditPurchases.providerPurchaseId, providerPurchaseId),
      ));
      if (!existing || existing.accountId !== accountId || existing.credits !== credits) {
        throw new RoomError(409, "This payment reference was already applied to a different purchase");
      }
      return false;
    }
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${credits}` })
      .where(eq(socialWallets.accountId, accountId));
    await tx.insert(socialLedger).values({
      accountId, delta: credits, kind: "credit_purchase",
      description: `Confirmed coin purchase · ${credits.toLocaleString("en-US")} coins`,
      requestKey: randomUUID(), refKey: `credit-purchase:${provider}:${providerPurchaseId}`,
    });
    return true;
  });

  return {
    credited: inserted,
    balance: (await db.select({ balance: socialWallets.balance }).from(socialWallets)
      .where(eq(socialWallets.accountId, accountId)))[0]?.balance ?? 0,
    badgeId: null,
    nameColorTierUp: null,
  };
}
