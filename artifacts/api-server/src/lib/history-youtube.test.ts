import test from "node:test";
import assert from "node:assert/strict";
import { searchOfficialHistoryVideos } from "./history-youtube";

const channelId = "UC9MAhZQQd9egwWCxrwSIsJQ";
const policy = {
  channelHandle: "@history-fixture",
  channelTitle: "HISTORY",
  query: "full episodes The Men Who Built America documentary",
  cacheTtlMs: 60_000,
};

test("History searches resolve the official handle, keep long official English landscape videos, and cache results", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  const makeSnippet = (title: string, width = 1280, height = 720) => ({
    title,
    channelTitle: "HISTORY",
    channelId,
    description: "Full episode from the official channel",
    liveBroadcastContent: "none",
    defaultLanguage: "en",
    defaultAudioLanguage: "en",
    thumbnails: { high: { width, height } },
  });
  const candidates = [
    { id: { videoId: "HIST0000001" }, snippet: makeSnippet("The Men Who Built America Full Episode") },
    { id: { videoId: "HIST0000002" }, snippet: makeSnippet("History Full Episode: Ancient Empires") },
    { id: { videoId: "HIST0000003" }, snippet: makeSnippet("HISTORY #shorts") },
    { id: { videoId: "HIST0000004" }, snippet: makeSnippet("History Full Episode Portrait", 720, 1280) },
    { id: { videoId: "HIST0000005" }, snippet: { ...makeSnippet("Historia completa"), defaultAudioLanguage: "es" } },
    { id: { videoId: "HIST0000006" }, snippet: makeSnippet("История мира") },
    { id: { videoId: "HIST0000007" }, snippet: { ...makeSnippet("HISTORY Live"), liveBroadcastContent: "live" } },
    { id: { videoId: "HIST0000008" }, snippet: { ...makeSnippet("HISTORY from another channel"), channelId: "UC0000000000000000000000" } },
  ];
  const candidateSnippetById = new Map(candidates.map(item => [
    item.id.videoId,
    item.snippet,
  ]));
  const durations: Record<string, string> = {
    HIST0000001: "PT1H19M50S",
    HIST0000002: "PT35M",
    HIST0000003: "PT1H",
    HIST0000004: "PT40M",
    HIST0000005: "PT45M",
    HIST0000006: "PT45M",
    HIST0000007: "PT1H",
    HIST0000008: "PT1H",
  };
  const ids = Object.keys(durations);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/channels")) {
      return Response.json({ items: [{
        id: channelId,
        snippet: { title: "HISTORY", customUrl: "@history-fixture" },
      }] });
    }
    if (url.pathname.endsWith("/search")) return Response.json({ items: candidates });
    return Response.json({ items: ids.map(id => ({
      id,
      snippet: candidateSnippetById.get(id),
      contentDetails: {
      duration: id === "HIST0000003" ? "PT3M" : durations[id],
        contentRating: {},
      },
      status: { embeddable: true },
    })) });
  }) as typeof fetch;

  try {
    const result = await searchOfficialHistoryVideos("test-key-never-logged", policy);
    assert.deepEqual(result.videoIds, ["HIST0000001", "HIST0000002"]);
    assert.deepEqual(result.titles, [
      "The Men Who Built America Full Episode",
      "History Full Episode: Ancient Empires",
    ]);
    assert.equal(result.durationMsByVideoId.HIST0000001, 4_790_000);
    assert.equal(requests.length, 3);
    const searchUrl = requests.find(url => url.pathname.endsWith("/search"))!;
    assert.equal(searchUrl.searchParams.get("forHandle"), null);
    assert.equal(searchUrl.searchParams.get("channelId"), channelId);
    assert.equal(searchUrl.searchParams.get("videoDuration"), "long");
    assert.equal(searchUrl.searchParams.get("safeSearch"), "none");
    assert.equal(searchUrl.searchParams.get("order"), "date");
    assert.equal(searchUrl.searchParams.get("relevanceLanguage"), "en");
    assert.equal(searchUrl.searchParams.get("regionCode"), "US");
    await searchOfficialHistoryVideos("test-key-never-logged", policy);
    assert.equal(requests.length, 3, "repeat search uses cached official-channel results");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
