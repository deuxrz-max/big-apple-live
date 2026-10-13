import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseAccountEntranceEffect,
  chooseOwnerEntranceEffect,
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

test("owner entrance effects never stack and prioritize Lion before the highest enabled tier", () => {
  assert.equal(chooseOwnerEntranceEffect({
    lionEnabled: true,
    enabledTierIds: ["monthly-tier-2", "monthly-tier-5"],
  }), "lion-entrance");
  assert.equal(chooseOwnerEntranceEffect({
    lionEnabled: false,
    enabledTierIds: ["monthly-tier-2", "monthly-tier-4"],
  }), "monthly-tier-4");
  assert.equal(chooseOwnerEntranceEffect({ lionEnabled: false, enabledTierIds: [] }), null);
});

test("ordinary badge owners get only their own tier effect, and can disable it", () => {
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: true,
    lionEnabled: true,
    enabledTierIds: ["monthly-tier-5"],
    ownedTierEffectId: "monthly-tier-3",
    ownerAccount: false,
  }), "monthly-tier-3");
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: false,
    lionEnabled: true,
    enabledTierIds: [],
    ownedTierEffectId: "monthly-tier-3",
    ownerAccount: false,
  }), null);
  assert.equal(chooseAccountEntranceEffect({
    ownerPreview: false,
    enabled: true,
    lionEnabled: true,
    enabledTierIds: [],
    ownedTierEffectId: null,
    ownerAccount: true,
  }), "lion-entrance");
});
