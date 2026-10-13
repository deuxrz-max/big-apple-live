import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { db, socialCreditPurchases } from "@workspace/db";
import { evaluateMonthlyPurchaseBadges, type MonthlyCreditBadgeSummary } from "./monthly-credit-badge-policy";
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
