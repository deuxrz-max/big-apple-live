import assert from "node:assert/strict";
import test from "node:test";
import {
  NAME_COLOR_TIERS,
  NAME_COLOR_STEP_COINS,
  nameColorTierForLifetimeCoins,
} from "./gift-name-color";

test("each 10,000 lifetime-purchased-coin boundary selects the existing name color", () => {
  assert.equal(NAME_COLOR_TIERS.length, 19);
  assert.equal(NAME_COLOR_STEP_COINS, 10_000);
  for (const [index, tier] of NAME_COLOR_TIERS.entries()) {
    assert.equal(nameColorTierForLifetimeCoins(index * NAME_COLOR_STEP_COINS).color, tier.color, tier.name);
    if (index > 0) {
      assert.equal(
        nameColorTierForLifetimeCoins(index * NAME_COLOR_STEP_COINS - 1).color,
        NAME_COLOR_TIERS[index - 1]!.color,
        `${tier.name} starts exactly at its threshold`,
      );
    }
  }
});

test("progress uses the next lifetime purchase threshold and never cycles at the top", () => {
  assert.deepEqual(nameColorTierForLifetimeCoins(0), {
    tierIndex: 0,
    tierName: "Pure White",
    color: "#FFFFFF",
    lifetimeCoinsPurchased: 0,
    coinsToNextTier: 10_000,
    nextTierName: "Light Gray",
    nextTierThreshold: 10_000,
  });
  const progress = nameColorTierForLifetimeCoins(34_500);
  assert.equal(progress.tierName, "Gold");
  assert.equal(progress.coinsToNextTier, 5_500);
  assert.equal(progress.nextTierName, "Butter Yellow");
  const top = nameColorTierForLifetimeCoins(180_000);
  assert.equal(top.tierName, "Electric Blue");
  assert.equal(top.coinsToNextTier, 0);
  assert.equal(top.nextTierName, null);
  assert.equal(top.color, "#09B0EC");
});

test("negative and invalid purchase totals safely start at white", () => {
  assert.equal(nameColorTierForLifetimeCoins(-1).color, "#FFFFFF");
  assert.equal(nameColorTierForLifetimeCoins(Number.NaN).color, "#FFFFFF");
  assert.equal(nameColorTierForLifetimeCoins(1_000_000).tierName, "Electric Blue");
});

