/**
 * Edit this single list to change monthly purchase tiers, badge art, or
 * entrance-effect upload folders. Calendar months are evaluated in UTC.
 */
export const MONTHLY_CREDIT_BADGE_TIERS = [
  {
    id: "monthly-tier-2",
    rank: 2,
    name: "Guardian of the Den",
    monthlyCredits: 5_000,
    badgeImage: "/badges/monthly-credit-tiers/tier2.png",
    entranceEffectId: "monthly-tier-2",
    entranceEffectFolder: "/entrance-effects/monthly-credit-tiers/tier2",
    durationMs: 6_083,
  },
  {
    id: "monthly-tier-3",
    rank: 3,
    name: "Guardian of the Night",
    monthlyCredits: 10_000,
    badgeImage: "/badges/monthly-credit-tiers/tier3.png",
    entranceEffectId: "monthly-tier-3",
    entranceEffectFolder: "/entrance-effects/monthly-credit-tiers/tier3",
    durationMs: 6_083,
  },
  {
    id: "monthly-tier-4",
    rank: 4,
    name: "King of Beasts",
    monthlyCredits: 25_000,
    badgeImage: "/badges/monthly-credit-tiers/tier4.png",
    entranceEffectId: "monthly-tier-4",
    entranceEffectFolder: "/entrance-effects/monthly-credit-tiers/tier4",
    durationMs: 6_083,
  },
] as const;

export type MonthlyCreditBadgeTier = typeof MONTHLY_CREDIT_BADGE_TIERS[number];
