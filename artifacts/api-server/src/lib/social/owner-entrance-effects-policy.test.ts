import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseAccountEntranceEffect,
  hasOwnerTierTestAccess,
  isOwnerAccount,
  isTierEntranceEffectEnabled,
} from "./owner-entrance-effects-policy";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";

test("only the explicitly allowlisted non-test owner accounts receive owner access", () => {
  assert.equal(isOwnerAccount({ username: "VAMPSQUAD", isTestAccount: false }), true);
  assert.equal(isOwnerAccount({ username: "Vampsquad4", isTestAccount: false }), true);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: false }, "development"), true);
  assert.equal(hasOwnerTierTestAccess({ username: "VAMPSQUAD4", isTestAccount: false }, "development"), true);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: false }, "production"), false);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad4", isTestAccount: false }, "production"), false);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: true }, "development"), false);
  assert.equal(isOwnerAccount({ username: "Vampsquad4", isTestAccount: true }), false);
  assert.equal(hasOwnerTierTestAccess({ username: "another_user", isTestAccount: false }, "development"), false);
});

test("owner tier effect switches default to on but honor an explicit off", () => {
  assert.equal(isTierEntranceEffectEnabled(undefined, "monthly-tier-4"), true);
  assert.equal(isTierEntranceEffectEnabled({}, "monthly-tier-4"), true);
  assert.equal(isTierEntranceEffectEnabled({ "monthly-tier-4": true }, "monthly-tier-4"), true);
  assert.equal(isTierEntranceEffectEnabled({ "monthly-tier-4": false }, "monthly-tier-4"), false);
});

test("retired recharge tiers cannot trigger entrances even from stale saved preferences", () => {
  for (const equippedBadgeId of ["monthly-tier-1", "monthly-tier-5"]) {
    for (const ownerPreview of [false, true]) {
      assert.equal(chooseAccountEntranceEffect({
        ownerPreview, enabled: true, equippedBadgeId,
        lionEnabled: true, enabledTierIds: [equippedBadgeId],
      }), null);
    }
  }
});

test("only the equipped owner badge's enabled entrance effect can play", () => {
  const allEnabledTierIds = MONTHLY_CREDIT_BADGE_TIERS.map(tier => tier.id);
  for (const tier of MONTHLY_CREDIT_BADGE_TIERS) {
    assert.equal(chooseAccountEntranceEffect({
      ownerPreview: true,
      enabled: true,
      equippedBadgeId: tier.id,
      lionEnabled: true,
      enabledTierIds: allEnabledTierIds,
    }), tier.entranceEffectId);
  }
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: true,
    enabled: true,
    equippedBadgeId: "lion-entrance",
    lionEnabled: true,
    enabledTierIds: ["monthly-tier-2", "monthly-tier-5"],
  }), "lion-entrance");
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: true,
    enabled: true,
    equippedBadgeId: "monthly-tier-4",
    lionEnabled: true,
    enabledTierIds: ["monthly-tier-2", "monthly-tier-4"],
  }), "monthly-tier-4");
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: true,
    enabled: true,
    equippedBadgeId: "monthly-tier-3",
    lionEnabled: true,
    enabledTierIds: [],
  }), null);
});

test("ordinary badge owners get only the equipped tier effect and can turn it off", () => {
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: true,
    equippedBadgeId: "monthly-tier-3",
    lionEnabled: true,
    enabledTierIds: [],
  }), "monthly-tier-3");
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: false,
    equippedBadgeId: "monthly-tier-3",
    lionEnabled: true,
    enabledTierIds: [],
  }), null);
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: true,
    equippedBadgeId: null,
    lionEnabled: true,
    enabledTierIds: [],
  }), null);
});
