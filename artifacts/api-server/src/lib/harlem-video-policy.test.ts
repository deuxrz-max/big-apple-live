import assert from "node:assert/strict";
import { test } from "node:test";
import { HARLEM_HASHTAGS, HARLEM_REFRESH_MS, harlemRefreshDue, harlemVideoPlayable } from "./harlem-video-policy";

test("Harlem uses only the three requested hashtag searches", () => {
  assert.deepEqual(HARLEM_HASHTAGS, ["#BiggJah", "#ComedySkits", "#FunnyVideos"]);
});
test("Harlem rejects restricted, unembeddable, missing and unavailable details", () => {
  const video = {
    videoId: "abcdefghijk", title: "Comedy", channelTitle: "Creator", description: null,
    durationMs: 60_000, discoveredAtMs: 0, embeddable: true, ageRestricted: false, availableInUS: true,
  };
  assert.equal(harlemVideoPlayable(video), true);
  for (const patch of [{ embeddable: false }, { embeddable: undefined }, { ageRestricted: true },
    { ageRestricted: undefined }, { availableInUS: false }, { durationMs: 0 }, { videoId: "bad" }]) {
    assert.equal(harlemVideoPlayable({ ...video, ...patch }), false);
  }
});
test("Refresh is daily, with bounded retries after failures", () => {
  const now = HARLEM_REFRESH_MS * 2;
  assert.equal(harlemRefreshDue(null, null, now), true);
  assert.equal(harlemRefreshDue(new Date(now - HARLEM_REFRESH_MS + 1), null, now), false);
  assert.equal(harlemRefreshDue(new Date(now - HARLEM_REFRESH_MS), null, now), true);
  assert.equal(harlemRefreshDue(null, new Date(now - 60_000), now), false);
});
