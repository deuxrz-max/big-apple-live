import assert from "node:assert/strict";
import test from "node:test";
import { giftingProgress, giftingTier, GIFTING_LEVEL_THRESHOLDS } from "@workspace/beam-identity";
import { NAME_COLOR_TIERS, existingUsernameColor, nameColorTierForLifetimeCoins } from "./gift-name-color";
import { canAccessGiftingExclusive, assertGiftingAccess } from "./gifting-access";

test("all 100 levels and each threshold boundary are inclusive", () => {
  assert.equal(NAME_COLOR_TIERS.length, 101);
  for (let level = 1; level <= 100; level++) {
    const xp = GIFTING_LEVEL_THRESHOLDS[level]!;
    assert.equal(giftingProgress(xp - 1).level, level - 1);
    assert.equal(giftingProgress(xp).level, level);
    assert.equal(giftingProgress(xp + 1).level, level);
    assert.equal(nameColorTierForLifetimeCoins(xp).tierIndex, level);
  }
});
test("supplied running totals, first gift, max level and progress are exact", () => {
  for (const [level, xp] of [[10,4200],[11,5000],[30,51000],[31,55000],[60,339500],
    [61,355000],[90,1491000],[91,1555000],[100,2995500]]) {
    assert.equal(GIFTING_LEVEL_THRESHOLDS[level!], xp);
  }
  for (const value of [-1, 0, Number.NaN, Infinity]) assert.equal(giftingProgress(value).level, 0);
  assert.equal(giftingProgress(1).level, 1);
  assert.equal(giftingProgress(199).currentLevelXp, 199);
  assert.equal(giftingProgress(199).xpForNextLevel, 200);
  assert.equal(giftingProgress(201).currentLevelXp, 1);
  assert.equal(giftingProgress(201).xpForNextLevel, 250);
  assert.equal(giftingProgress(1e9).level, 100);
  assert.equal(giftingProgress(1e9).nextThreshold, null);
});
test("tier colors and unrestricted gift access are independent of purchase appearance", () => {
  for (const [level, name] of [[1,"Bronze"],[10,"Bronze"],[11,"Silver"],[30,"Silver"],
    [31,"Gold"],[60,"Gold"],[61,"Platinum"],[90,"Platinum"],[91,"Deux Wild"],[100,"Deux Wild"]] as const) {
    assert.equal(giftingTier(level).name, name);
  }
  assert.equal(giftingTier(91).color, "#39FF14");
  assert.equal(existingUsernameColor(20_000), "#C0C0C0");
  assert.equal(existingUsernameColor(180_000), "#09B0EC");
  assert.equal(canAccessGiftingExclusive(false, 0), true);
  assert.equal(canAccessGiftingExclusive(true, 0), true);
  assert.equal(canAccessGiftingExclusive(true, 354999), true);
  assert.equal(canAccessGiftingExclusive(true, 355000), true);
  assert.equal(canAccessGiftingExclusive(true, 2995500), true);
});

test("retired exclusivity does not query XP or block any send path", async () => {
  const executor = { select() { throw new Error("must not query XP for retired access restriction"); } };
  await assertGiftingAccess("test-account", { platinumExclusive: true }, executor as never);
  await assertGiftingAccess("test-account", { platinumExclusive: false }, executor as never);
});
