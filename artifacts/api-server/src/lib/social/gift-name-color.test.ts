import assert from "node:assert/strict";
import test from "node:test";
import { NAME_COLOR_TIERS, existingUsernameColor, nameColorTierForLifetimeCoins } from "./gift-name-color";

test("all seven gifting levels use exact cumulative thresholds and colors", () => {
  const expected = [
    ["Default", "#FFFFFF", 0],
    ["Green", "#00FF00", 20_000],
    ["Pink", "#FF0099", 100_000],
    ["Purple", "#B39CD0", 250_000],
    ["Yellow", "#FFFF00", 400_000],
    ["Platinum", "#C0C0C0", 550_000],
    ["Magenta", "#FF00FF", 800_000],
  ] as const;
  assert.equal(NAME_COLOR_TIERS.length, 7);
  NAME_COLOR_TIERS.forEach((tier, i) => {
    const [name, color, threshold] = expected[i]!;
    assert.equal(tier.threshold, threshold);
    assert.equal(tier.name, name);
    assert.equal(tier.color, color);
    if (i > 0) assert.equal(nameColorTierForLifetimeCoins(threshold - 1).tierIndex, i - 1);
    assert.equal(nameColorTierForLifetimeCoins(threshold).tierIndex, i);
    assert.equal(nameColorTierForLifetimeCoins(threshold + 1).tierIndex, i);
    assert.equal(nameColorTierForLifetimeCoins(threshold).tierName, name);
    assert.equal(nameColorTierForLifetimeCoins(threshold).color, color);
    assert.equal(nameColorTierForLifetimeCoins(threshold).nextTierThreshold,
      expected[i + 1]?.[2] ?? null);
  });
});
test("white default before 20,000, exact progress, and a non-cycling Magenta top level", () => {
  for (const total of [0, -1, Number.NaN, 19_999]) {
    assert.equal(nameColorTierForLifetimeCoins(total).tierIndex, 0);
    assert.equal(nameColorTierForLifetimeCoins(total).color, "#FFFFFF");
  }
  const below = nameColorTierForLifetimeCoins(19_999);
  assert.equal(below.coinsToNextTier, 1);
  assert.equal(below.nextTierName, "Green");
  const top = nameColorTierForLifetimeCoins(2_000_000);
  assert.equal(top.tierName, "Magenta");
  assert.equal(top.color, "#FF00FF");
  assert.equal(top.nextTierName, null);
  assert.equal(top.coinsToNextTier, 0);
  assert.notEqual(NAME_COLOR_TIERS[2].color, NAME_COLOR_TIERS[6].color);
});
test("legacy username colors remain independent from gifting-logo progress", () => {
  assert.equal(existingUsernameColor(0), "#FFFFFF");
  assert.equal(existingUsernameColor(20_000), "#C0C0C0");
  assert.equal(existingUsernameColor(100_000), "#FF0099");
  assert.equal(existingUsernameColor(180_000), "#09B0EC");
  assert.equal(nameColorTierForLifetimeCoins(20_000).color, "#00FF00");
});
