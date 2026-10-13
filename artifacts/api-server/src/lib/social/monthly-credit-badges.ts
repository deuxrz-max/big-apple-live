import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, accountProfiles, socialCreditPurchases, socialSettings } from "@workspace/db";
import { evaluateMonthlyPurchaseBadges, type MonthlyCreditBadgeSummary } from "./monthly-credit-badge-policy";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";
import { hasOwnerTierTestAccess } from "./owner-entrance-effects-policy";
export { evaluateMonthlyPurchaseBadges } from "./monthly-credit-badge-policy";
export type { MonthlyCreditBadgeSummary } from "./monthly-credit-badge-policy";

const startOfUtcMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const monthKeyFor = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const addUtcMonths = (date: Date, count: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));

export async function monthlyPurchaseBadgeSummaries(accountIds: string[], now = new Date()) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return new Map<string, MonthlyCreditBadgeSummary | null>();
  const currentMonth = startOfUtcMonth(now);
  const previousMonth = addUtcMonths(currentMonth, -1);
  const rows = await db.select({
    accountId: socialCreditPurchases.accountId,
    credits: socialCreditPurchases.credits,
    confirmedAt: socialCreditPurchases.confirmedAt,
  }).from(socialCreditPurchases).where(and(
    inArray(socialCreditPurchases.accountId, ids),
    gte(socialCreditPurchases.confirmedAt, previousMonth),
    lte(socialCreditPurchases.confirmedAt, now),
  )).orderBy(asc(socialCreditPurchases.confirmedAt));
  const { result } = evaluateMonthlyPurchaseBadges(rows, now);
  for (const id of ids) if (!result.has(id)) result.set(id, null);
  return result;
}

export async function monthlyPurchaseBadgeSummary(accountId: string, now = new Date()) {
  return (await monthlyPurchaseBadgeSummaries([accountId], now)).get(accountId) ?? null;
}

/**
 * Badge rendering may use preview-only owner test access. Purchase calculations
 * must continue to use monthlyPurchaseBadgeSummaries(), which reads only receipts.
 */
export async function visibleMonthlyPurchaseBadgeSummaries(accountIds: string[], now = new Date()) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const summaries = await monthlyPurchaseBadgeSummaries(ids, now);
  if (!ids.length || process.env.NODE_ENV !== "development") return summaries;

  const profiles = await db.select({
    accountId: accountProfiles.accountId,
    username: accountProfiles.username,
    isTestAccount: accountProfiles.isTestAccount,
    updatedAt: accountProfiles.updatedAt,
  }).from(accountProfiles).where(inArray(accountProfiles.accountId, ids));
  const owner = profiles.find(profile => hasOwnerTierTestAccess(profile, process.env.NODE_ENV));
  if (!owner) return summaries;

  const [preferences] = await db.select({
    selectedTier: socialSettings.ownerTestBadgeTier,
  }).from(socialSettings).where(eq(socialSettings.accountId, owner.accountId)).limit(1);
  const selectedTier = preferences?.selectedTier ?? 5;
  const tier = MONTHLY_CREDIT_BADGE_TIERS.find(candidate => candidate.rank === selectedTier);
  if (tier) {
    summaries.set(owner.accountId, {
      tier,
      earnedAt: owner.updatedAt,
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
      monthKey: "owner-test",
      monthlyCredits: 0,
    });
  }
  return summaries;
}

export async function visibleMonthlyPurchaseBadgeSummary(accountId: string, now = new Date()) {
  return (await visibleMonthlyPurchaseBadgeSummaries([accountId], now)).get(accountId) ?? null;
}
