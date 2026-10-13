import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEB_SERIES_HISTORY_DAYS,
  buildRankedWebSeries,
  cleanWebSeriesTitle,
  easternDateKey,
  nextEasternMidnightMs,
  parseWebSeriesEpisodeNumber,
} from "./web-series";

const nowMs = Date.parse("2026-10-13T12:00:00.000Z");

function seriesInput(prefix: string, title: string, count = 3) {
  const items = Array.from({ length: count }, (_, offset) => offset + 1).map(index => ({
    videoId: `${prefix}${String(index).padStart(10, "0")}`,
    title: `${title} - S1 E${index}`,
    channelTitle: "Example Channel",
    channelId: "UC-example",
    description: "Full web series episode.",
    publishedAt: "2026-10-01T12:00:00.000Z",
    liveBroadcastContent: "none",
    defaultLanguage: "en",
    defaultAudioLanguage: "en",
    thumbnailAspectRatios: [16 / 9],
    position: index - 1,
  }));
  const eligibility = items.map(item => ({
    videoId: item.videoId,
    durationMs: 10 * 60_000,
    embeddable: true,
    ytRating: null,
    defaultLanguage: "en",
    defaultAudioLanguage: "en",
    thumbnailAspectRatios: [16 / 9],
    description: "Full web series episode.",
    tags: ["episode"],
  }));
  return { items, eligibility };
}

test("Eastern dates and next midnight follow daylight-saving changes", () => {
  assert.equal(easternDateKey(new Date("2026-11-01T03:59:59.000Z")), "2026-10-31");
  assert.equal(nextEasternMidnightMs(new Date("2026-11-01T03:59:59.000Z")),
    Date.parse("2026-11-01T04:00:00.000Z"));
  assert.equal(easternDateKey(new Date("2026-03-08T05:00:00.000Z")), "2026-03-08");
  assert.equal(nextEasternMidnightMs(new Date("2026-03-08T05:30:00.000Z")),
    Date.parse("2026-03-09T04:00:00.000Z"));
});

test("episode numbers and series titles are normalized for the room heading", () => {
  assert.equal(parseWebSeriesEpisodeNumber("Space Story | Season 2 Episode 4"), 2_004);
  assert.equal(parseWebSeriesEpisodeNumber("Space Story - S1 E3"), 1_003);
  assert.equal(parseWebSeriesEpisodeNumber("Space Story Episode 7"), 7);
  assert.equal(cleanWebSeriesTitle("Moonlight Tales | Full Season 1 Web Series"), "Moonlight Tales");
  assert.equal(cleanWebSeriesTitle("【Go Ahead】ENG DUB | Full Eps | Romantic Drama"), "Go Ahead");
});

test("ranked pools require three screened episodes and exclude the 30-day history", () => {
  const popular = seriesInput("A", "Popular Story");
  const newer = seriesInput("B", "Fresh Story", 4);
  const nonSeries = {
    playlistId: "PL-TOO-SHORT",
    title: "Only Two Episodes",
    channelTitle: "Example Channel",
    items: popular.items.slice(0, 2),
  };
  const allVideos = [...popular.items, ...newer.items];
  const eligibility = [
    ...popular.eligibility,
    ...newer.eligibility.map(item => item.videoId === "B0000000003"
      ? { ...item, description: "Reaction to the episode", tags: ["reaction"] }
      : item),
  ];
  const views = new Map(allVideos.map(item => [
    item.videoId,
    item.videoId.startsWith("A") ? 800_000 : 90_000,
  ]));
  const published = new Map(allVideos.map(item => [item.videoId, Date.parse("2026-10-01T12:00:00.000Z")]));
  const candidates = [
    { playlistId: "PL-POPULAR", title: "Popular Story | Full Episodes", channelTitle: "Example Channel", items: popular.items },
    { playlistId: "PL-FRESH", title: "Fresh Story Web Series", channelTitle: "Example Channel", items: newer.items },
    nonSeries,
  ];
  const ranked = buildRankedWebSeries(
    candidates,
    eligibility,
    views,
    published,
    new Set(),
    new Set(),
    nowMs,
  );
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.seriesTitle, "Popular Story");
  assert.deepEqual(ranked[0]?.episodes.map(item => item.episodeNumber), [1, 2, 3]);
  assert.deepEqual(ranked[0]?.episodes.map(item => item.title), popular.items.map(item => item.title));
  assert.equal(ranked.find(item => item.playlistId === "PL-FRESH")?.episodes.length, 3,
    "reaction content is filtered before the minimum episode count is applied");

  const excludingPopular = buildRankedWebSeries(
    candidates,
    eligibility,
    views,
    published,
    new Set(["PL-POPULAR"]),
    new Set(),
    nowMs,
  );
  assert.equal(excludingPopular[0]?.playlistId, "PL-FRESH",
    `series selected within ${WEB_SERIES_HISTORY_DAYS} days must be skipped`);

  const shortOnly = buildRankedWebSeries(
    [{ ...candidates[0]!, items: popular.items.slice(0, 2) }],
    eligibility,
    views,
    published,
    new Set(),
    new Set(),
    nowMs,
  );
  assert.equal(shortOnly.length, 0);

  const renamedPlaylist = buildRankedWebSeries(
    [{ ...candidates[0]!, playlistId: "PL-POPULAR-ALT" }],
    eligibility,
    views,
    published,
    new Set(),
    new Set(["popular story"]),
    nowMs,
  );
  assert.equal(renamedPlaylist.length, 0, "a series title picked from another playlist is still excluded");
});
