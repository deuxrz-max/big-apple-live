import { test } from "node:test";
import assert from "node:assert/strict";
import { selectExactLiveYouTubeVideo, selectPlayableYouTubeVideos } from "./youtube-video-selection";

test("automatic Beam TV selection excludes non-embeddable, age-restricted and live videos", () => {
  const candidates = [
    { videoId: "dQw4w9WgXcQ", title: "Allowed", channelTitle: "Channel A", description: null },
    { videoId: "5qap5aO4i9A", title: "Not embeddable", channelTitle: "Channel B", description: null },
    { videoId: "M7lc1UVf-VE", title: "Age restricted", channelTitle: "Channel C", description: null },
    { videoId: "aqz-KE-bpKQ", title: "Live now", channelTitle: "Channel D", description: null, liveBroadcastContent: "live" },
    { videoId: "ScMzIvxBSi4", title: "Upcoming", channelTitle: "Channel E", description: null, liveBroadcastContent: "upcoming" },
    { videoId: "invalid", title: "Invalid ID", channelTitle: "Channel F", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    { videoId: "dQw4w9WgXcQ", durationMs: 240_000, embeddable: true },
    { videoId: "5qap5aO4i9A", durationMs: 240_000, embeddable: false },
    { videoId: "M7lc1UVf-VE", durationMs: 240_000, embeddable: true, ytRating: "ytAgeRestricted" },
    { videoId: "aqz-KE-bpKQ", durationMs: 240_000, embeddable: true },
    { videoId: "ScMzIvxBSi4", durationMs: 240_000, embeddable: true },
    { videoId: "invalid", durationMs: 240_000, embeddable: true },
  ]);

  assert.deepEqual(result.videos.map(video => video.videoId), ["dQw4w9WgXcQ"]);
  assert.deepEqual(result.durationMsByVideoId, { dQw4w9WgXcQ: 240_000 });
});

test("CNN News live selection accepts only the exact embeddable official live stream", () => {
  const options = {
    channelId: "UCupvZG-5ko_eiXAupbDfxWw",
    channelTitle: "CNN",
    streamTitle: "CNN Headlines: 24/7 Live News",
    segmentDurationMs: 15 * 60_000,
  };
  const candidate = {
    videoId: "GotlA1KKWoo",
    title: "CNN Headlines: 24/7 Live News",
    channelTitle: "CNN",
    channelId: options.channelId,
    description: "The latest headlines.",
    liveBroadcastContent: "live",
  };
  const accepted = selectExactLiveYouTubeVideo([candidate], [
    { videoId: candidate.videoId, durationMs: null, embeddable: true },
  ], options);
  assert.equal(accepted?.video.videoId, candidate.videoId);
  assert.equal(accepted?.durationMs, 15 * 60_000);

  assert.equal(selectExactLiveYouTubeVideo([{ ...candidate, title: "Other CNN live" }], [
    { videoId: candidate.videoId, durationMs: null, embeddable: true },
  ], options), null);
  assert.equal(selectExactLiveYouTubeVideo([{ ...candidate, channelId: "UCnotCNN" }], [
    { videoId: candidate.videoId, durationMs: null, embeddable: true },
  ], options), null);
  assert.equal(selectExactLiveYouTubeVideo([{
    ...candidate, liveBroadcastContent: "upcoming",
  }], [{ videoId: candidate.videoId, durationMs: null, embeddable: true }], options), null);
  assert.equal(selectExactLiveYouTubeVideo([candidate], [
    { videoId: candidate.videoId, durationMs: null, embeddable: false },
  ], options), null);
  assert.equal(selectExactLiveYouTubeVideo([candidate], [
    { videoId: candidate.videoId, durationMs: null, embeddable: true, ytRating: "ytAgeRestricted" },
  ], options), null);
});

test("World News selection only accepts configured trusted channel names", () => {
  const candidates = [
    { videoId: "abc12345678", title: "World update", channelTitle: "BBC News", description: null },
    { videoId: "def12345678", title: "Unverified upload", channelTitle: "Daily World Update", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    { videoId: "abc12345678", durationMs: 60_000, embeddable: true },
    { videoId: "def12345678", durationMs: 60_000, embeddable: true },
  ], ["BBC News", "Reuters"]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["abc12345678"]);
});

test("Kids selection only accepts the approved family-channel list", () => {
  const candidates = [
    { videoId: "abc12345678", title: "Nursery rhyme", channelTitle: "Super Simple Songs - Kids Songs", description: null },
    { videoId: "def12345678", title: "Cartoon compilation", channelTitle: "Random Cartoons", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    { videoId: "abc12345678", durationMs: 90_000, embeddable: true },
    { videoId: "def12345678", durationMs: 90_000, embeddable: true },
  ], ["Super Simple Songs - Kids Songs", "PBS KIDS"]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["abc12345678"]);
});
