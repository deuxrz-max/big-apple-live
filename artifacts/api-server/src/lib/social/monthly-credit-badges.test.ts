import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMonthlyPurchaseBadges } from "./monthly-credit-badge-policy";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";

test("purchase badge tiers use only monthly purchase totals and keep the highest active tier", () => {
  assert.deepEqual(MONTHLY_CREDIT_BADGE_TIERS.map(tier => tier.monthlyCredits),
    [1_000, 5_000, 10_000, 25_000, 50_000]);
  const guardianTier = MONTHLY_CREDIT_BADGE_TIERS.find(tier => tier.id === "monthly-tier-2");
  assert.equal(guardianTier?.name, "Guardian of the Den");
  assert.equal(guardianTier?.badgeImage, "/badges/monthly-credit-tiers/tier2.png");
  assert.equal(guardianTier?.entranceEffectFolder, "/entrance-effects/monthly-credit-tiers/tier2");
  assert.equal(guardianTier?.durationMs, 6_500);
  const rows = [
    { accountId: "split", credits: 600, confirmedAt: new Date("2090-01-02T12:00:00Z") },
    { accountId: "split", credits: 400, confirmedAt: new Date("2090-01-20T12:00:00Z") },
    { accountId: "split", credits: 4_000, confirmedAt: new Date("2090-01-25T12:00:00Z") },
    { accountId: "split", credits: 10_000, confirmedAt: new Date("2090-02-03T12:00:00Z") },
    { accountId: "gift-only", credits: 999, confirmedAt: new Date("2090-02-10T12:00:00Z") },
  ];
  const { result } = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-15T00:00:00Z"));
  const split = result.get("split");
  assert.equal(split?.tier.id, "monthly-tier-3");
  assert.equal(split?.monthKey, "2090-02");
  assert.equal(split?.monthlyCredits, 10_000, "totals never carry over between calendar months");
  assert.equal(split?.earnedAt.toISOString(), "2090-02-03T12:00:00.000Z");
  assert.equal(split?.expiresAt.toISOString(), "2090-04-01T00:00:00.000Z");
  assert.equal(result.get("gift-only"), null, "gift and other non-purchase credits are absent from this input");
});

test("a previous-month badge remains through the following month then expires", () => {
  const rows = [{ accountId: "person", credits: 50_000, confirmedAt: new Date("2090-01-15T00:00:00Z") }];
  const active = evaluateMonthlyPurchaseBadges(rows, new Date("2090-02-28T23:59:59.999Z")).result.get("person");
  assert.equal(active?.tier.id, "monthly-tier-5");
  assert.equal(active?.expiresAt.toISOString(), "2090-03-01T00:00:00.000Z");
  const expired = evaluateMonthlyPurchaseBadges(rows, new Date("2090-03-01T00:00:00Z")).result.get("person");
  assert.equal(expired, null);
});
