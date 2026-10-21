import assert from "node:assert/strict";
import test from "node:test";
import { isLiveStreamEventVisible } from "../src/chat/liveChatBlockPolicy";

const blocked = new Set(["blockeduser"]);

test("a personal block hides the blocked person's livestream text from this viewer", () => {
  assert.equal(isLiveStreamEventVisible("message", "BlockedUser", blocked), false);
  assert.equal(isLiveStreamEventVisible("message", "AnotherUser", blocked), true);
});

test("a personal block does not hide the blocked person's livestream gift effect", () => {
  assert.equal(isLiveStreamEventVisible("gift", "BlockedUser", blocked), true);
});
