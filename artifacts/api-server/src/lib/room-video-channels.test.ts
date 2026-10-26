import assert from "node:assert/strict";
import { test } from "node:test";
import { UNIFIED_VIDEO_CHANNELS, combineChannelVideos, unifiedVideoChannel } from "./room-video-channels";

test("three separate channels contain exactly their approved source rooms", () => {
  assert.deepEqual(UNIFIED_VIDEO_CHANNELS.map(channel => [...channel.sourceRoomIds]), [
    ["MUSIC1", "COMEDY", "NEWS01"], ["MOVIES", "WEBSER", "HIST01"], ["SPORTS", "KIDS01"],
  ]);
  assert.equal(unifiedVideoChannel("cafe01")?.label, "The Cafe");
  assert.equal(unifiedVideoChannel("SCREEN")?.label, "The Screening Room");
  assert.equal(unifiedVideoChannel("ARENA1")?.label, "The Arena");
  assert.equal(unifiedVideoChannel("MUSIC1"), undefined, "source pools remain independent");
});

test("all source videos are interleaved, not truncated or lost, with unique IDs", () => {
  const sources = [[{ videoId: "music" }, { videoId: "shared" }, { videoId: "last" }],
    [{ videoId: "comedy" }, { videoId: "shared" }], [{ videoId: "news" }]];
  assert.deepEqual(combineChannelVideos(sources).map(item => item.videoId), ["music", "comedy", "news", "shared", "last"]);
  assert.equal(sources[0].length, 3, "source arrays are not modified");
  assert.deepEqual(combineChannelVideos([]), []);
  assert.equal(combineChannelVideos([Array.from({ length: 1000 }, (_, index) => ({ videoId: String(index) }))]).length, 1000);
});
