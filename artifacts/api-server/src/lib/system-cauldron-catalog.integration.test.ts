import assert from "node:assert/strict";
import { test, after } from "node:test";
import { inArray } from "drizzle-orm";
import { db, pool, giftStudioAssets } from "@workspace/db";
import { getGiftCatalogItem, giftCatalogWithActiveNames, listGiftCatalogForOwner } from "./gift-studio-catalog";
import {
  getActiveGiftStudioMedia, listGiftStudioVersions, giftStudioMediaFile, giftStudioIconFile,
  setGiftStudioVersionActive, deleteGiftStudioVersion, assignGiftStudioVersionToGift,
} from "./gift-studio";
import { CAULDRON_VERSION_ID, CAULDRON_OVERFLOW_VERSION_ID } from "./system-cauldron-assets";

// Read-only integration check: never creates accounts, sends gifts or changes assets.
test("development: assets remain stored but neither catalog nor direct lookup offers them", {
  skip: process.env.NODE_ENV !== "development",
}, async () => {
  const ids = [CAULDRON_VERSION_ID, CAULDRON_OVERFLOW_VERSION_ID];
  const assets = await db.select({ id: giftStudioAssets.id, status: giftStudioAssets.status, ownerId: giftStudioAssets.ownerId })
    .from(giftStudioAssets).where(inArray(giftStudioAssets.id, ids));
  assert.equal(assets.length, 2, "retain both uploaded assets");
  const catalog = await listGiftCatalogForOwner();
  const gifts = await giftCatalogWithActiveNames();
  assert.ok(catalog.length > 0 && gifts.length > 0, "unrelated catalog remains available");
  for (const id of ids) {
    const giftId = `studio-${id}`;
    assert.equal(catalog.some(item => item.id === giftId), false, "no selectable entrance/catalog product");
    assert.equal(gifts.some(item => item.id === giftId), false, "no sendable gift");
    assert.equal(await getGiftCatalogItem(giftId), null, "direct purchase/send lookup denied");
    assert.deepEqual(await getActiveGiftStudioMedia(giftId), { media: null }, "no user entrance playback");
  }
  for (const asset of assets) {
    const library = await listGiftStudioVersions(asset.ownerId);
    assert.equal(library.items.some(item => ids.includes(item.id)), false, "no system assets in Studio previews");
    await assert.rejects(setGiftStudioVersionActive(asset.ownerId, asset.id, true), /reserved for system use/);
    await assert.rejects(assignGiftStudioVersionToGift(asset.ownerId, asset.id, "heart"), /reserved for system use/);
    await assert.rejects(deleteGiftStudioVersion(asset.ownerId, asset.id), /reserved for system use/);
  }
  const overflow = assets.find(asset => asset.id === CAULDRON_OVERFLOW_VERSION_ID)!;
  for (const variant of ["original", "webm", "safari"] as const) {
    await assert.rejects(giftStudioMediaFile({
      versionId: overflow.id, ownerId: overflow.ownerId, variant,
    }), /Gift media not found/);
    await assert.rejects(giftStudioMediaFile({
      versionId: overflow.id, activeOnly: true, variant,
    }), /Gift media not found/);
  }
  await assert.rejects(giftStudioIconFile({
    versionId: overflow.id, ownerId: overflow.ownerId,
  }), /Gift icon not found/);
  // Assertions above must not alter the uploads or their active/draft states.
  const after = await db.select({ id: giftStudioAssets.id, status: giftStudioAssets.status, ownerId: giftStudioAssets.ownerId })
    .from(giftStudioAssets).where(inArray(giftStudioAssets.id, ids));
  assert.deepEqual(after.sort((a,b) => a.id.localeCompare(b.id)), assets.sort((a,b) => a.id.localeCompare(b.id)));
});
after(async () => { await pool.end(); });
