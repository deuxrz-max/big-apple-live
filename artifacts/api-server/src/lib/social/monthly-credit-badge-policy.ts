import { MONTHLY_CREDIT_BADGE_TIERS, type MonthlyCreditBadgeTier } from "./monthly-credit-badge-config";

export type MonthlyCreditBadgeSummary = {
  tier: MonthlyCreditBadgeTier;
  earnedAt: Date;
  expiresAt: Date;
  monthKey: string;
  monthlyCredits: number;
};

const startOfUtcMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const monthKeyFor = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const addUtcMonths = (date: Date, count: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));

export function evaluateMonthlyPurchaseBadges(
  rows: Array<{ accountId: string; credits: number; confirmedAt: Date }>,
  now: Date,
) {
  const thisMonth = startOfUtcMonth(now);
  const previousMonth = addUtcMonths(thisMonth, -1);
  const monthTotals = new Map<string, { total: number; earnedAtByTier: Map<string, Date> }>();
  const sorted = [...rows].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
  for (const row of sorted) {
    const key = `${row.accountId}:${monthKeyFor(row.confirmedAt)}`;
    const current = monthTotals.get(key) ?? { total: 0, earnedAtByTier: new Map<string, Date>() };
    current.total += row.credits;
    for (const tier of MONTHLY_CREDIT_BADGE_TIERS) {
      if (current.total >= tier.monthlyCredits && !current.earnedAtByTier.has(tier.id))
        current.earnedAtByTier.set(tier.id, row.confirmedAt);
    }
    monthTotals.set(key, current);
  }

  const result = new Map<string, MonthlyCreditBadgeSummary | null>();
  for (const accountId of new Set(rows.map(row => row.accountId))) {
    const candidates: MonthlyCreditBadgeSummary[] = [];
    for (const monthStart of [previousMonth, thisMonth]) {
      const month = monthTotals.get(`${accountId}:${monthKeyFor(monthStart)}`);
      if (!month) continue;
      const tier = [...MONTHLY_CREDIT_BADGE_TIERS].reverse().find(candidate => month.total >= candidate.monthlyCredits);
      if (!tier) continue;
      const earnedAt = month.earnedAtByTier.get(tier.id);
      if (!earnedAt) continue;
      candidates.push({
        tier,
        earnedAt,
        expiresAt: addUtcMonths(monthStart, 2),
        monthKey: monthKeyFor(monthStart),
        monthlyCredits: month.total,
      });
    }
    candidates.sort((a, b) => b.tier.rank - a.tier.rank || b.monthKey.localeCompare(a.monthKey));
    const candidate = candidates[0];
    result.set(accountId, candidate && candidate.expiresAt > now ? candidate : null);
  }
  return { result };
}
