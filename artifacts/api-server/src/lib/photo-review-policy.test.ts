import test from "node:test";
import assert from "node:assert/strict";
import { hasPhotoReviewAccess } from "./photo-review-policy";

test("adult owner and moderators can review photos, but other accounts cannot", () => {
  assert.equal(hasPhotoReviewAccess({ adultConfirmed: true, owner: true, moderator: false }), true);
  assert.equal(hasPhotoReviewAccess({ adultConfirmed: true, owner: false, moderator: true }), true);
  assert.equal(hasPhotoReviewAccess({ adultConfirmed: true, owner: false, moderator: false }), false);
  assert.equal(hasPhotoReviewAccess({ adultConfirmed: false, owner: true, moderator: false }), false);
});
