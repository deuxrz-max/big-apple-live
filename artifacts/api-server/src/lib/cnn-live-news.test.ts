import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommunityLiveStreamPolicy } from "./community-config";
import { resolveYouTubeChannelId, searchCnnLiveStream } from "./cnn-live-news";

const channelId = "UCupvZG-5ko_eiXAupbDfxWw";

test("CNN live lookup uses the official channel, exact title, embeddability and a 15-minute segment", async () => {
  const originalFetch = globalThis.fetch;
  const requested: URL[] = [];
  globalThis.fetch = (async input => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    requested.push(url);
    const endpoint = url.pathname.split("/").at(-1);
    const payload = endpoint === "channels"
      ? { items: [{ id: channelId, snippet: { title: "CNN" } }] }
      : endpoint === "search"
        ? { items: [{
          id: { videoId: "GotlA1KKWoo" },
          snippet: {
            title: "CNN Headlines: 24/7 Live News",
            channelTitle: "CNN",
            channelId,
            description: "The latest headlines.",
            liveBroadcastContent: "live",
          },
        }] }
        : { items: [{
          id: "GotlA1KKWoo",
          snippet: {
            channelId,
            defaultAudioLanguage: "en-US",
            thumbnails: { high: { width: 1280, height: 720 } },
          },
          contentDetails: { contentRating: {} },
          status: { embeddable: true },
        }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;

  try {
    const policy: CommunityLiveStreamPolicy = {
      channelHandle: "@CNN",
      channelTitle: "CNN",
      streamTitle: "CNN Headlines: 24/7 Live News",
      liveSearchQuery: "CNN Headlines: 24/7 Live News unit test",
      fallbackSearch: "CNN latest news",
      segmentDurationMs: 15 * 60_000,
    };
    const resolvedChannel = await resolveYouTubeChannelId("unit-test-key", policy.channelHandle, policy.channelTitle);
    const video = await searchCnnLiveStream("unit-test-key", resolvedChannel, policy);

    assert.equal(resolvedChannel, channelId);
    assert.deepEqual(video, {
      videoId: "GotlA1KKWoo",
      title: "CNN Headlines: 24/7 Live News",
      channelTitle: "CNN",
      description: "The latest headlines.",
    });
    const searchUrl = requested.find(url => url.pathname.endsWith("/search"));
    assert.equal(searchUrl?.searchParams.get("eventType"), "live");
    assert.equal(searchUrl?.searchParams.get("channelId"), channelId);
    assert.equal(searchUrl?.searchParams.get("videoEmbeddable"), "true");
    assert.equal(searchUrl?.searchParams.get("safeSearch"), "strict");
    assert.equal(searchUrl?.searchParams.get("relevanceLanguage"), "en");
    assert.equal(searchUrl?.searchParams.get("regionCode"), "US");
    assert.equal(searchUrl?.searchParams.get("videoDuration"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CNN lookup rejects a similarly named channel and refuses non-embeddable or restricted live streams", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "wrong-channel" | "restricted" = "wrong-channel";
  globalThis.fetch = (async input => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const endpoint = url.pathname.split("/").at(-1);
    const payload = endpoint === "channels"
      ? { items: [{ id: channelId, snippet: { title: "CNN Fan Channel" } }] }
      : endpoint === "search"
        ? { items: [{
          id: { videoId: "GotlA1KKWoo" },
          snippet: {
            title: "CNN Headlines: 24/7 Live News",
            channelTitle: "CNN",
            channelId,
            liveBroadcastContent: "live",
          },
        }] }
        : { items: [{
          id: "GotlA1KKWoo",
          contentDetails: { contentRating: mode === "restricted" ? { ytRating: "ytAgeRestricted" } : {} },
          status: { embeddable: mode !== "restricted" },
        }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      resolveYouTubeChannelId("unit-test-key", "@CNN-fan", "CNN"),
      /official YouTube channel could not be found/,
    );

    const policy: CommunityLiveStreamPolicy = {
      channelHandle: "@CNN",
      channelTitle: "CNN",
      streamTitle: "CNN Headlines: 24/7 Live News",
      liveSearchQuery: "CNN live restricted test",
      fallbackSearch: "CNN latest news",
      segmentDurationMs: 15 * 60_000,
    };
    mode = "restricted";
    assert.equal(await searchCnnLiveStream("unit-test-key", channelId, policy), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
