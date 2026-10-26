import { db, socialCreditPurchases, socialLedger } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { existingUsernameColor, nameColorTierForLifetimeCoins, type NameColorTierSummary } from "./gift-name-color";

const developmentPurchaseTotalOverrides = new Map<string, number>();

/**
 * Preview-only override used by the owner to test gifting-logo levels without
 * creating purchase, wallet, ledger, or gift-history records.
 */
export function setNameColorPurchaseTotalOverride(accountId: string, totalCoins: number | null) {
  if (process.env.NODE_ENV !== "development") throw new Error("Name-color test overrides are development-only");
  if (totalCoins === null) developmentPurchaseTotalOverrides.delete(accountId);
  else developmentPurchaseTotalOverrides.set(accountId, Math.max(0, Math.floor(totalCoins)));
}

export function nameColorPurchaseTotalOverride(accountId: string): number | null {
  if (process.env.NODE_ENV !== "development") return null;
  return developmentPurchaseTotalOverrides.get(accountId) ?? null;
}

export async function nameColorProfilesForAccounts(
  accountIds: readonly string[],
  executor: Pick<typeof db, "select"> = db,
) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return new Map<string, NameColorTierSummary>();

  // Purchases preserve the existing username appearance ONLY; they never advance gifting.
  const [rows, giftRows] = await Promise.all([executor.select({
    accountId: socialCreditPurchases.accountId,
    totalCoins: sql<string>`coalesce(sum(${socialCreditPurchases.credits}), 0)::text`,
  }).from(socialCreditPurchases)
    .where(inArray(socialCreditPurchases.accountId, ids))
    .groupBy(socialCreditPurchases.accountId),
    executor.select({
      accountId: socialLedger.accountId,
      totalCoins: sql<string>`coalesce(sum(case when ${socialLedger.xpUnits} > 0 then ${socialLedger.xpUnits} else -${socialLedger.delta} end), 0)::text`,
    }).from(socialLedger)
      .where(and(inArray(socialLedger.accountId, ids), eq(socialLedger.kind, "gift_sent")))
      .groupBy(socialLedger.accountId),
  ]);
  const totals = new Map(rows.map(row => [row.accountId, Number(row.totalCoins) || 0]));
  const giftTotals = new Map(giftRows.map(row => [row.accountId, Number(row.totalCoins) || 0]));

  return new Map(ids.map(accountId => {
    const override = nameColorPurchaseTotalOverride(accountId);
    const total = override ?? giftTotals.get(accountId) ?? 0;
    // Keep the established wire fields: tierIndex is now the gifting-logo level,
    // while color remains the independently preserved username color.
    return [accountId, {
      ...nameColorTierForLifetimeCoins(total),
      color: existingUsernameColor(totals.get(accountId) ?? 0),
    }];
  }));
}

export async function nameColorProfileForAccount(accountId: string) {
  return (await nameColorProfilesForAccounts([accountId])).get(accountId)
    ?? nameColorTierForLifetimeCoins(0);
}
