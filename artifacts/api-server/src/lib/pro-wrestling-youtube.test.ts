import { test } from "node:test";
import assert from "node:assert/strict";
import { communityWrestlingSearchPolicy } from "./community-config";
import { searchOfficialProWrestlingVideos } from "./pro-wrestling-youtube";

test("Pro Wrestling queries only the four official channels and globally orders embeddable videos newest first", async () => {
  const originalFetch = globalThis.fetch;
  const requested: URL[] = [];
  const policy = communityWrestlingSearchPolicy("KIDS01")!;
  const channels = new Map(policy.channels.map(channel => [channel.channelId, channel]));
  const channelVideo = new Map(policy.channels.map((channel, index) => [
    channel.channelId,
    {
      videoId: ["AEWvid00001", "WWEvid00001", "TNAvid00001", "ROHvid00001"][index]!,
      publishedAt: [
        "2026-10-12T12:00:00Z",
        "2026-10-13T12:00:00Z",
        "2026-10-11T12:00:00Z",
        "2026-10-14T12:00:00Z",
      ][index]!,
      channel,
    },
  ]));
  globalThis.fetch = (async input => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    requested.push(url);
    const endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "search") {
      const channelId = url.searchParams.get("channelId")!;
      const entry = channelVideo.get(channelId)!;
      return new Response(JSON.stringify({ items: [
        {
          id: { videoId: entry.videoId },
          snippet: {
            title: `${entry.channel.channelTitle} match highlights`,
            channelId,
            channelTitle: entry.channel.channelTitle,
            description: "Official highlights.",
            publishedAt: entry.publishedAt,
            liveBroadcastContent: "none",
          },
        },
        ...(entry.channel.channelTitle === "WWE" ? [{
          id: { videoId: "WWEgame0001" },
          snippet: {
            title: "WWE 2K gameplay showcase",
            channelId,
            channelTitle: "WWE",
            description: "Game footage.",
            publishedAt: entry.publishedAt,
            liveBroadcastContent: "none",
          },
        }] : []),
        {
          id: { videoId: "FanEdit0001" },
          snippet: {
            title: "Fan edit",
            channelId: "UCfanmade0000000000000000",
            channelTitle: "Fan Channel",
            publishedAt: entry.publishedAt,
          },
        },
      ] }), { status: 200 });
    }

    const ids = url.searchParams.get("id")!.split(",");
    return new Response(JSON.stringify({ items: ids.map(videoId => {
      const entry = [...channelVideo.values()].find(item => item.videoId === videoId)!;
      return {
        id: videoId,
        snippet: {
          channelId: entry.channel.channelId,
          defaultAudioLanguage: "en-US",
          thumbnails: { high: { width: 1280, height: 720 } },
        },
        contentDetails: { duration: "PT5M30S", contentRating: {} },
        status: { embeddable: true },
      };
    }) }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await searchOfficialProWrestlingVideos("unit-test-key", {
      ...policy,
      query: "official wrestling test queue",
    });
    assert.equal(requested.filter(url => url.pathname.endsWith("/search")).length, 4);
    for (const url of requested.filter(item => item.pathname.endsWith("/search"))) {
      assert.equal(url.searchParams.get("order"), "date");
      assert.equal(url.searchParams.get("safeSearch"), "none");
      assert.equal(url.searchParams.get("videoEmbeddable"), "true");
      assert.equal(url.searchParams.get("relevanceLanguage"), "en");
      assert.equal(url.searchParams.get("regionCode"), "US");
      assert.equal(url.searchParams.get("videoDuration"), "medium");
      assert.ok(channels.has(url.searchParams.get("channelId")!));
    }
    assert.deepEqual(result.videos.map(video => video.videoId), [
      "ROHvid00001",
      "WWEvid00001",
      "AEWvid00001",
      "TNAvid00001",
    ]);
    assert.deepEqual(new Set(result.videos.map(video => video.channelTitle)),
      new Set(["All Elite Wrestling", "WWE", "TNA Wrestling", "Ring of Honor Wrestling"]));
    assert.equal(result.videos.some(video => video.videoId === "FanEdit0001"), false);
    assert.equal(result.videos.some(video => video.videoId === "WWEgame0001"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
