import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportedEntranceEffectContentType } from "../src/chat/entrance-effect-assets";

test("entrance effect discovery rejects SPA fallback HTML for absent files", () => {
  assert.equal(isSupportedEntranceEffectContentType("lottie", "text/html"), false);
  assert.equal(isSupportedEntranceEffectContentType("video", "text/html"), false);
  assert.equal(isSupportedEntranceEffectContentType("image", "text/html"), false);
});

test("entrance effect discovery accepts supported video, image, and Lottie MIME types", () => {
  assert.equal(isSupportedEntranceEffectContentType("lottie", "application/json; charset=utf-8"), true);
  assert.equal(isSupportedEntranceEffectContentType("video", "video/mp4"), true);
  assert.equal(isSupportedEntranceEffectContentType("video", "video/webm"), true);
  assert.equal(isSupportedEntranceEffectContentType("image", "image/gif"), true);
  assert.equal(isSupportedEntranceEffectContentType("image", "image/webp"), true);
  assert.equal(isSupportedEntranceEffectContentType("image", "image/apng"), true);
});
