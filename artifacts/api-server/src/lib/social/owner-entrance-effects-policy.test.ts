import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseAccountEntranceEffect,
  hasOwnerTierTestAccess,
  isOwnerAccount,
} from "./owner-entrance-effects-policy";

test("only the non-test Vampsquad account receives preview badge test access", () => {
  assert.equal(isOwnerAccount({ username: "VAMPSQUAD", isTestAccount: false }), true);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: false }, "development"), true);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: false }, "production"), false);
  assert.equal(hasOwnerTierTestAccess({ username: "Vampsquad", isTestAccount: true }, "development"), false);
  assert.equal(hasOwnerTierTestAccess({ username: "another_user", isTestAccount: false }, "development"), false);
});

test("only the equipped owner badge's enabled entrance effect can play", () => {
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
