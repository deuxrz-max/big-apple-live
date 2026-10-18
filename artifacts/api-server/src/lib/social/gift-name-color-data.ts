import { db, socialCreditPurchases } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { nameColorTierForLifetimeCoins, type NameColorTierSummary } from "./gift-name-color";

const developmentPurchaseTotalOverrides = new Map<string, number>();

/**
 * Preview-only override used by the owner to test name-color tiers without
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

export async function nameColorProfilesForAccounts(accountIds: readonly string[]) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return new Map<string, NameColorTierSummary>();

  const rows = await db.select({
    accountId: socialCreditPurchases.accountId,
    totalCoins: sql<string>`coalesce(sum(${socialCreditPurchases.credits}), 0)::text`,
  }).from(socialCreditPurchases)
    .where(inArray(socialCreditPurchases.accountId, ids))
    .groupBy(socialCreditPurchases.accountId);
  const totals = new Map(rows.map(row => [row.accountId, Number(row.totalCoins) || 0]));

  return new Map(ids.map(accountId => {
    const override = nameColorPurchaseTotalOverride(accountId);
    const total = override ?? totals.get(accountId) ?? 0;
    return [accountId, nameColorTierForLifetimeCoins(total)];
  }));
}

export async function nameColorProfileForAccount(accountId: string) {
  return (await nameColorProfilesForAccounts([accountId])).get(accountId)
    ?? nameColorTierForLifetimeCoins(0);
}
