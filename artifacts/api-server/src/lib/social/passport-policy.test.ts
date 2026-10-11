import assert from "node:assert/strict";
import test from "node:test";
import type { StreamerPassportLinkRow } from "@workspace/db";
import {
  parsePlatformValue,
  privatePassportEntry,
  publicPassportEntry,
  reviewState,
  STREAMER_PASSPORT_PLATFORMS,
  verificationCode,
} from "./passport-policy";

const row: StreamerPassportLinkRow = {
  id: "3c1fe021-5d60-40f6-8f15-36bab0b40ed6",
  accountId: "passport-test-account",
  platform: "tiktok",
  handle: "sample_creator",
  profileUrl: "https://www.tiktok.com/@sample_creator",
  verificationCode: "ST-AB12CD34",
  verificationStatus: "requested",
  addedAt: new Date("2026-10-01T12:00:00.000Z"),
  requestedAt: new Date("2026-10-02T12:00:00.000Z"),
  verifiedAt: null,
  verifiedBy: null,
};

test("catalog exposes exactly the seven supported platform IDs", () => {
  assert.deepEqual(STREAMER_PASSPORT_PLATFORMS.map(platform => platform.id),
    ["liveme", "tiktok", "bigo", "instagram", "facebook", "youtube", "twitch"]);
});

test("handles normalize into platform profile URLs without fetching platform content", () => {
  assert.deepEqual(parsePlatformValue("tiktok", "@sample_creator").handle, "sample_creator");
  assert.equal(parsePlatformValue("tiktok", "@sample_creator").profileUrl, "https://www.tiktok.com/@sample_creator");
  assert.equal(parsePlatformValue("instagram", "sample.creator").profileUrl, "https://www.instagram.com/sample.creator/");
  assert.equal(parsePlatformValue("bigo", "creator-01").profileUrl, "https://www.bigo.tv/creator-01");
});

test("only HTTPS profile URLs on the selected platform are accepted", () => {
  assert.equal(parsePlatformValue("twitch", "https://www.twitch.tv/streamer").handle, "streamer");
  for (const value of [
    "http://www.twitch.tv/streamer",
    "https://twitch.tv.evil.example/streamer",
    "https://www.instagram.com.evil.example/creator",
    "https://user:pass@www.twitch.tv/streamer",
    "https://www.twitch.tv/streamer?redirect=https://evil.example",
    "https://www.twitch.tv/streamer#section",
  ]) {
    assert.throws(() => parsePlatformValue("twitch", value));
  }
});

test("unsupported platforms and malformed handles are rejected", () => {
  assert.throws(() => parsePlatformValue("kick", "streamer"));
  assert.throws(() => parsePlatformValue("twitch", "name with spaces"));
  assert.throws(() => parsePlatformValue("twitch", "x".repeat(81)));
  assert.throws(() => parsePlatformValue("twitch", ""));
});

test("private owner projection includes the code but public passport projection never does", () => {
  const privateView = privatePassportEntry(row)!;
  const publicView = publicPassportEntry(row)!;
  assert.equal(privateView.verificationCode, row.verificationCode);
  assert.equal(publicView.verified, false);
  assert.equal(Object.hasOwn(publicView, "verificationCode"), false);
  assert.equal(Object.hasOwn(publicView, "verificationStatus"), false);
});

test("verification codes are short and random", () => {
  const first = verificationCode();
  const second = verificationCode();
  assert.match(first, /^ST-[0-9A-F]{8}$/);
  assert.notEqual(first, second);
});

test("manual review records moderator ownership checks and rejection clears verification", () => {
  const when = new Date("2026-10-10T10:00:00.000Z");
  assert.deepEqual(reviewState("approve", "trusted-moderator", when), {
    verificationStatus: "verified", verifiedAt: when, verifiedBy: "trusted-moderator",
  });
  assert.deepEqual(reviewState("reject", "trusted-moderator", when), {
    verificationStatus: "unverified", requestedAt: null, verifiedAt: null, verifiedBy: null,
  });
});
