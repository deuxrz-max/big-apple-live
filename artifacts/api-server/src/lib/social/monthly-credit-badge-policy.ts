import { MONTHLY_CREDIT_BADGE_TIERS, type MonthlyCreditBadgeTier } from "./monthly-credit-badge-config";

export const MONTHLY_BADGE_ACTIVE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type MonthlyCreditBadgeSummary = {
  tier: MonthlyCreditBadgeTier;
  earnedAt: Date;
  expiresAt: Date;
  monthKey: string;
  monthlyCredits: number;
};

const monthKeyFor = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export function evaluateMonthlyPurchaseBadges(
  rows: Array<{ accountId: string; credits: number; confirmedAt: Date }>,
  now: Date,
) {
  const monthTotals = new Map<string, { total: number; earnedAtByTier: Map<string, Date> }>();
  const sorted = rows
    .filter(row => row.confirmedAt.getTime() <= now.getTime())
    .sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
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

  const candidatesByAccount = new Map<string, Map<string, MonthlyCreditBadgeSummary>>();
  for (const accountId of new Set(rows.map(row => row.accountId))) {
    const byTier = new Map<string, MonthlyCreditBadgeSummary>();
    for (const [monthId, month] of monthTotals) {
      if (!monthId.startsWith(`${accountId}:`)) continue;
      const monthKey = monthId.slice(accountId.length + 1);
      for (const tier of MONTHLY_CREDIT_BADGE_TIERS) {
        const earnedAt = month.earnedAtByTier.get(tier.id);
        if (!earnedAt) continue;
        const expiresAt = new Date(earnedAt.getTime() + MONTHLY_BADGE_ACTIVE_DURATION_MS);
        if (expiresAt.getTime() <= now.getTime()) continue;
        const previous = byTier.get(tier.id);
        if (!previous || previous.earnedAt.getTime() < earnedAt.getTime()) {
          byTier.set(tier.id, {
            tier,
            earnedAt,
            expiresAt,
            monthKey,
            monthlyCredits: month.total,
          });
        }
      }
    }
    candidatesByAccount.set(accountId, byTier);
  }

  const result = new Map<string, MonthlyCreditBadgeSummary[]>();
  for (const accountId of new Set(rows.map(row => row.accountId))) {
    result.set(accountId, [...(candidatesByAccount.get(accountId)?.values() ?? [])]
      .sort((a, b) => b.tier.rank - a.tier.rank));
  }
  return { result };
}
