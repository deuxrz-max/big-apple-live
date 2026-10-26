import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAULDRON_VERSION_ID, CAULDRON_OVERFLOW_VERSION_ID,
  isSystemCauldronProduct, withoutSystemCauldronProducts,
} from "./system-cauldron-assets";

test("both Cauldron assets are reserved regardless of catalog category", () => {
  assert.equal(isSystemCauldronProduct(`studio-${CAULDRON_VERSION_ID}`), true);
  assert.equal(isSystemCauldronProduct(`studio-${CAULDRON_OVERFLOW_VERSION_ID}`), true);
  assert.equal(isSystemCauldronProduct("heart"), false);
  assert.equal(isSystemCauldronProduct("studio-unrelated"), false);
});

test("gift and entrance catalogs remove only the two reserved products", () => {
  for (const productType of ["gift", "entrance-effect"]) {
    const items = [
      { id: `studio-${CAULDRON_VERSION_ID}`, productType },
      { id: "existing-gift", productType },
      { id: `studio-${CAULDRON_OVERFLOW_VERSION_ID}`, productType },
      { id: "another-custom-gift", productType },
    ];
    assert.deepEqual(withoutSystemCauldronProducts(items).map(item => item.id),
      ["existing-gift", "another-custom-gift"]);
    assert.equal(items.length, 4, "filtering must not delete or mutate stored assets");
  }
});
