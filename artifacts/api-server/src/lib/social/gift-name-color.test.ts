import assert from "node:assert/strict";
import test from "node:test";
import {
  GIFT_NAME_COLOR_TIERS,
  GIFT_NAME_COLOR_STEP_CREDITS,
  giftNameColorForSentCredits,
  giftNameTierForSentCredits,
} from "./gift-name-color";

test("each 10,000 sent-credit boundary selects the requested name color", () => {
  assert.equal(GIFT_NAME_COLOR_TIERS.length, 19);
  assert.equal(GIFT_NAME_COLOR_STEP_CREDITS, 10_000);
  for (const [index, tier] of GIFT_NAME_COLOR_TIERS.entries()) {
    assert.equal(giftNameColorForSentCredits(index * GIFT_NAME_COLOR_STEP_CREDITS), tier.color, tier.name);
    if (index > 0) {
      assert.equal(
        giftNameColorForSentCredits(index * GIFT_NAME_COLOR_STEP_CREDITS - 1),
        GIFT_NAME_COLOR_TIERS[index - 1]!.color,
        `${tier.name} starts exactly at its threshold`,
      );
    }
  }
});

test("negative and invalid totals start at white, and the top tier does not cycle", () => {
  assert.equal(giftNameColorForSentCredits(-1), "#FFFFFF");
  assert.equal(giftNameColorForSentCredits(Number.NaN), "#FFFFFF");
  assert.equal(giftNameColorForSentCredits(1_000_000), "#09B0EC");
  assert.equal(giftNameTierForSentCredits(180_000).name, "Electric Blue");
});

