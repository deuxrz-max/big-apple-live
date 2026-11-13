import assert from "node:assert/strict";
import test from "node:test";
import { filterSendableGifts, isSendableGift, requireSendableGift } from "./gift-availability";

const activeGift = { id: "rose", status: "active", productType: "gift" };

test("only active gifts enter the send panel catalog, even when they have no animation", () => {
  const gifts = [
    activeGift,
    { ...activeGift, id: "inactive", status: "inactive" },
    { ...activeGift, id: "draft", status: "draft" },
    { ...activeGift, id: "retired", status: "deleted" },
    { ...activeGift, id: "entrance", productType: "entrance-effect" },
    { ...activeGift, id: "no-animation", animationAvailable: false },
  ];

  assert.deepEqual(filterSendableGifts(gifts).map(gift => gift.id), ["rose", "no-animation"]);
});

test("turning a gift back on makes it sendable again", () => {
  const inactive = { ...activeGift, status: "inactive" };
  assert.equal(isSendableGift(inactive), false);
  assert.equal(isSendableGift({ ...inactive, status: "active" }), true);
});

test("an unavailable gift is rejected before any send or charge can begin", () => {
  const catalogItem = { ...activeGift, status: "inactive" };
  let charged = 0;
  assert.throws(() => {
    const eligible = requireSendableGift(catalogItem, () => new Error("This gift isn't available right now."));
    charged += eligible.id.length;
  }, /This gift isn't available right now/);
  assert.equal(charged, 0);
});
