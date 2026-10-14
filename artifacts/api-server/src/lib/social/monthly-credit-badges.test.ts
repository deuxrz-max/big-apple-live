import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMonthlyPurchaseBadges, MONTHLY_BADGE_ACTIVE_DURATION_MS } from "./monthly-credit-badge-policy";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";

test("each threshold crossed in a UTC calendar month earns a separate 30-day badge", () => {
  assert.deepEqual(MONTHLY_CREDIT_BADGE_TIERS.map(tier => tier.monthlyCredits),
    [1_000, 5_000, 10_000, 25_000, 50_000]);
  assert.equal(MONTHLY_BADGE_ACTIVE_DURATION_MS, 30 * 24 * 60 * 60 * 1000);
  const guardianTier = MONTHLY_CREDIT_BADGE_TIERS.find(tier => tier.id === "monthly-tier-2");
  assert.equal(guardianTier?.name, "Guardian of the Den");
  assert.equal(guardianTier?.badgeImage, "/badges/monthly-credit-tiers/tier2.png");
  assert.equal(guardianTier?.entranceEffectFolder, "/entrance-effects/monthly-credit-tiers/tier2");
  assert.equal(guardianTier?.durationMs, 6_083);
  const rows = [
    { accountId: "split", credits: 600, confirmedAt: new Date("2090-01-02T12:00:00Z") },
    { accountId: "split", credits: 400, confirmedAt: new Date("2090-01-20T12:00:00Z") },
    { accountId: "split", credits: 4_000, confirmedAt: new Date("2090-01-25T12:00:00Z") },
    { accountId: "split", credits: 10_000, confirmedAt: new Date("2090-02-03T12:00:00Z") },
    { accountId: "gift-only", credits: 999, confirmedAt: new Date("2090-02-10T12:00:00Z") },
  ];
  const { result } = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-15T00:00:00Z"));
  const split = result.get("split");
  assert.deepEqual(split?.map(badge => badge.tier.id), ["monthly-tier-3", "monthly-tier-2", "monthly-tier-1"]);
  assert.equal(split?.[0]?.monthKey, "2090-02");
  assert.equal(split?.[0]?.monthlyCredits, 10_000, "totals never carry over between calendar months");
  assert.equal(split?.[0]?.earnedAt.toISOString(), "2090-02-03T12:00:00.000Z");
  assert.equal(split?.[0]?.expiresAt.toISOString(), "2090-03-05T12:00:00.000Z");
  assert.equal(split?.[1]?.earnedAt.toISOString(), "2090-02-03T12:00:00.000Z");
  assert.equal(result.get("gift-only")?.length, 0, "gift and other non-purchase credits are absent from this input");
});

test("badges expire exactly 30 days after award; re-earning restarts only that tier", () => {
  const rows = [
    { accountId: "person", credits: 50_000, confirmedAt: new Date("2090-01-15T00:00:00Z") },
    { accountId: "person", credits: 1_000, confirmedAt: new Date("2090-02-10T00:00:00Z") },
  ];
  const beforeExpiry = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-13T23:59:59.999Z")).result.get("person")!;
  const tier1Before = beforeExpiry.find(badge => badge.tier.id === "monthly-tier-1");
  assert.equal(tier1Before?.earnedAt.toISOString(), "2090-02-10T00:00:00.000Z");
  assert.equal(tier1Before?.expiresAt.toISOString(), "2090-03-12T00:00:00.000Z");
  assert.equal(beforeExpiry.some(badge => badge.tier.id === "monthly-tier-5"), true);

  const atExpiry = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-14T00:00:00Z")).result.get("person")!;
  assert.equal(atExpiry.some(badge => badge.tier.id === "monthly-tier-1"), true, "tier 1 was re-earned in February");
  assert.equal(atExpiry.some(badge => badge.tier.id === "monthly-tier-2"), false, "January tier 2 expires at its exact 30-day mark");
  assert.equal(atExpiry.some(badge => badge.tier.id === "monthly-tier-5"), false, "higher January tiers expire independently");

  const afterExpiry = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-15T00:00:00Z")).result.get("person")!;
  assert.deepEqual(afterExpiry.map(badge => badge.tier.id), ["monthly-tier-1"]);
});
