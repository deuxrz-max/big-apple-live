import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectExactLiveYouTubeVideo,
  selectPlayableYouTubeVideos,
  youtubeRegionAllowsCountry,
  youtubeThumbnailAspectRatios,
} from "./youtube-video-selection";

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
    {
      videoId: "dQw4w9WgXcQ", durationMs: 240_000, embeddable: true,
      defaultAudioLanguage: "en-US", thumbnailAspectRatios: [16 / 9],
    },
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
    thumbnailAspectRatios: [16 / 9],
  };
  const accepted = selectExactLiveYouTubeVideo([candidate], [
    {
      videoId: candidate.videoId, durationMs: null, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [16 / 9],
    },
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
    {
      videoId: "abc12345678", durationMs: 240_000, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [16 / 9],
    },
    { videoId: "def12345678", durationMs: 240_000, embeddable: true },
  ], ["BBC News", "Reuters"]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["abc12345678"]);
});

test("Kids selection only accepts the approved family-channel list", () => {
  const candidates = [
    { videoId: "abc12345678", title: "Nursery rhyme", channelTitle: "Super Simple Songs - Kids Songs", description: null },
    { videoId: "def12345678", title: "Cartoon compilation", channelTitle: "Random Cartoons", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    {
      videoId: "abc12345678", durationMs: 240_000, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [16 / 9],
    },
    { videoId: "def12345678", durationMs: 240_000, embeddable: true },
  ], ["Super Simple Songs - Kids Songs", "PBS KIDS"]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["abc12345678"]);
});

test("US region restrictions reject blocked and non-allowed videos", () => {
  assert.equal(youtubeRegionAllowsCountry({ blocked: ["US", "CA"] }), false);
  assert.equal(youtubeRegionAllowsCountry({ allowed: ["CA", "GB"] }), false);
  assert.equal(youtubeRegionAllowsCountry({ allowed: ["US", "CA"] }), true);
  assert.equal(youtubeRegionAllowsCountry({}), true);

  const candidate = {
    videoId: "dQw4w9WgXcQ",
    title: "English landscape music performance",
    channelTitle: "Channel",
    description: null,
    defaultLanguage: "en",
    thumbnailAspectRatios: [16 / 9],
  };
  const screened = selectPlayableYouTubeVideos([candidate], [{
    videoId: candidate.videoId,
    durationMs: 240_000,
    embeddable: true,
    availableInUS: false,
    defaultLanguage: "en",
    thumbnailAspectRatios: [16 / 9],
  }]);
  assert.equal(screened.videos.length, 0);
});

test("all room selections reject known non-English, Shorts, and non-widescreen videos", () => {
  const wide = [16 / 9];
  const candidates = [
    { videoId: "dQw4w9WgXcQ", title: "English video", channelTitle: "A", description: null },
    { videoId: "5qap5aO4i9A", title: "Spanish audio", channelTitle: "A", description: null },
    { videoId: "abc12345678", title: "Hindi movie trailer", channelTitle: "A", description: null },
    { videoId: "M7lc1UVf-VE", title: "Новости сегодня", channelTitle: "A", description: null },
    { videoId: "aqz-KE-bpKQ", title: "Wrestling #Shorts", channelTitle: "A", description: null },
    { videoId: "ScMzIvxBSi4", title: "Portrait video", channelTitle: "A", description: null },
    { videoId: "GotlA1KKWoo", title: "Lucha Libre resumen", channelTitle: "A", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    { videoId: "dQw4w9WgXcQ", durationMs: 240_000, embeddable: true, defaultAudioLanguage: "en-US", thumbnailAspectRatios: wide },
    { videoId: "5qap5aO4i9A", durationMs: 240_000, embeddable: true, defaultAudioLanguage: "es-MX", thumbnailAspectRatios: wide },
    { videoId: "abc12345678", durationMs: 240_000, embeddable: true, thumbnailAspectRatios: wide },
    { videoId: "M7lc1UVf-VE", durationMs: 240_000, embeddable: true, thumbnailAspectRatios: wide },
    { videoId: "aqz-KE-bpKQ", durationMs: 240_000, embeddable: true, thumbnailAspectRatios: wide },
    { videoId: "ScMzIvxBSi4", durationMs: 240_000, embeddable: true, thumbnailAspectRatios: [9 / 16] },
    { videoId: "GotlA1KKWoo", durationMs: 240_000, embeddable: true, thumbnailAspectRatios: wide },
  ]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["dQw4w9WgXcQ"]);
  assert.deepEqual(youtubeThumbnailAspectRatios({
    default: { width: 120, height: 90 },
    high: { width: 1280, height: 720 },
  }), [4 / 3, 16 / 9]);
});

test("duration, title, description and tags all exclude Shorts, with an optional real-dimensions check", () => {
  const wide = [16 / 9];
  const base = {
    channelTitle: "Channel",
    description: null,
    thumbnailAspectRatios: wide,
  };
  const candidates = [
    { ...base, videoId: "dQw4w9WgXcQ", title: "Regular video" },
    { ...base, videoId: "5qap5aO4i9A", title: "Short title: Shorts" },
    { ...base, videoId: "M7lc1UVf-VE", title: "Description marker" },
    { ...base, videoId: "aqz-KE-bpKQ", title: "Tag marker" },
    { ...base, videoId: "ScMzIvxBSi4", title: "Below three minutes" },
    { ...base, videoId: "GotlA1KKWoo", title: "Portrait dimensions" },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    {
      videoId: "dQw4w9WgXcQ", durationMs: 240_000, embeddable: true,
      defaultAudioLanguage: "en", width: 1920, height: 1080,
    },
    {
      videoId: "5qap5aO4i9A", durationMs: 240_000, embeddable: true,
      defaultAudioLanguage: "en",
    },
    {
      videoId: "M7lc1UVf-VE", durationMs: 240_000, embeddable: true,
      description: "Watch this #Shorts clip",
    },
    {
      videoId: "aqz-KE-bpKQ", durationMs: 240_000, embeddable: true,
      tags: ["shorts"],
    },
    {
      videoId: "ScMzIvxBSi4", durationMs: 179_999, embeddable: true,
    },
    {
      videoId: "GotlA1KKWoo", durationMs: 240_000, embeddable: true,
      width: 720, height: 1280,
    },
  ]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["dQw4w9WgXcQ"]);
});

test("automatic picks require English metadata and a landscape thumbnail, and reject Shorts links", () => {
  const candidates = [
    { videoId: "dQw4w9WgXcQ", title: "English episode", channelTitle: "English Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Language not listed", channelTitle: "Channel", description: null },
    { videoId: "M7lc1UVf-VE", title: "全新劇集", channelTitle: "Channel", description: null },
    {
      videoId: "aqz-KE-bpKQ", title: "A landscape title", channelTitle: "Channel",
      description: "https://www.youtube.com/shorts/aqz-KE-bpKQ",
    },
    { videoId: "ScMzIvxBSi4", title: "Square video", channelTitle: "Channel", description: null },
  ];
  const result = selectPlayableYouTubeVideos(candidates, [
    {
      videoId: "dQw4w9WgXcQ", durationMs: 180_000, embeddable: true,
      defaultLanguage: "en-US", thumbnailAspectRatios: [16 / 9],
    },
    {
      videoId: "5qap5aO4i9A", durationMs: 180_000, embeddable: true,
      thumbnailAspectRatios: [16 / 9],
    },
    {
      videoId: "M7lc1UVf-VE", durationMs: 180_000, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [16 / 9],
    },
    {
      videoId: "aqz-KE-bpKQ", durationMs: 180_000, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [16 / 9],
    },
    {
      videoId: "ScMzIvxBSi4", durationMs: 180_000, embeddable: true,
      defaultAudioLanguage: "en", thumbnailAspectRatios: [1],
    },
  ]);
  assert.deepEqual(result.videos.map(video => video.videoId), ["dQw4w9WgXcQ"]);
});
