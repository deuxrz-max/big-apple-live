import assert from "node:assert/strict";
import test from "node:test";
import { NAME_COLOR_TIERS, existingUsernameColor, nameColorTierForLifetimeCoins } from "./gift-name-color";

test("all 19 original colors and exact 10,000-coin boundaries, including existing totals", () => {
  const names = ["Pure White", "Light Gray", "Silver", "Gold", "Pale Khaki", "Yellow",
    "Cyan", "Powder Blue", "Bright Lime Green", "Mint Green", "Hot Pink",
    "Light Bubblegum Pink", "Lavender", "Magenta", "Peach", "Sky Blue", "Orange", "Beige", "Bright Blue"];
  assert.equal(NAME_COLOR_TIERS.length, 19);
  NAME_COLOR_TIERS.forEach((tier, i) => {
    const threshold = i * 10_000;
    assert.equal(tier.threshold, threshold);
    assert.equal(tier.name, names[i]);
    assert.equal(tier.color, existingUsernameColor(threshold), "reuse the original exact color code");
    if (i > 0) assert.equal(nameColorTierForLifetimeCoins(threshold - 1).tierIndex, i - 1);
    assert.equal(nameColorTierForLifetimeCoins(threshold).tierIndex, i);
    assert.equal(nameColorTierForLifetimeCoins(threshold + 1).tierIndex, i);
    assert.equal(nameColorTierForLifetimeCoins(threshold).tierName, names[i]);
    assert.equal(nameColorTierForLifetimeCoins(threshold).nextTierThreshold, i < 18 ? threshold + 10_000 : null);
  });
});
test("pure-white default below 10,000, exact progress, and a non-cycling blue top level", () => {
  for (const total of [0, -1, Number.NaN, 9_999]) {
    assert.equal(nameColorTierForLifetimeCoins(total).tierIndex, 0);
    assert.equal(nameColorTierForLifetimeCoins(total).color, "#FFFFFF");
  }
  const below = nameColorTierForLifetimeCoins(9_999);
  assert.equal(below.coinsToNextTier, 1);
  assert.equal(below.nextTierName, "Light Gray");
  const top = nameColorTierForLifetimeCoins(2_000_000);
  assert.equal(top.tierName, "Bright Blue");
  assert.equal(top.color, "#09B0EC");
  assert.equal(top.nextTierName, null);
  assert.equal(top.coinsToNextTier, 0);
  assert.notEqual(NAME_COLOR_TIERS[10].color, NAME_COLOR_TIERS[13].color);
});
test("legacy username colors remain independent from gifting-logo progress", () => {
  assert.equal(existingUsernameColor(0), "#FFFFFF");
  assert.equal(existingUsernameColor(20_000), "#C0C0C0");
  assert.equal(existingUsernameColor(100_000), "#FF0099");
  assert.equal(existingUsernameColor(180_000), "#09B0EC");
  assert.equal(nameColorTierForLifetimeCoins(20_000).color, "#C0C0C0");
});
