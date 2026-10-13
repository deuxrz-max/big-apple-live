import type { UniversityVideoBeamTvVideoMetadata } from "@workspace/api-zod";
import type { CommunityLiveStreamPolicy } from "./community-config";
import { RoomError } from "./room-store";
import {
  selectExactLiveYouTubeVideo,
  youtubeThumbnailAspectRatios,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";

type CachedChannel = { channelId: string; expiresAt: number };
type CachedLiveResult = { video: UniversityVideoBeamTvVideoMetadata | null; expiresAt: number };

const channelCache = new Map<string, CachedChannel>();
const liveSearchCache = new Map<string, CachedLiveResult>();
const liveSearchInFlight = new Map<string, Promise<UniversityVideoBeamTvVideoMetadata | null>>();
const CHANNEL_CACHE_MS = 24 * 60 * 60_000;
const LIVE_RESULT_CACHE_MS = 15 * 60_000;

async function youtubeDataJson(
  endpoint: "channels" | "search" | "videos",
  params: URLSearchParams,
  unavailableMessage: string,
): Promise<unknown> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new RoomError(502, unavailableMessage);
  }
  if (!response.ok) {
    throw new RoomError(
      response.status === 403 || response.status === 429 ? 503 : 502,
      "YouTube is unavailable for the News room right now.",
    );
  }
  return response.json().catch(() => null);
}

function recordsFrom(payload: unknown): Record<string, unknown>[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload)
    || !Array.isArray((payload as { items?: unknown }).items)) return [];
  return (payload as { items: unknown[] }).items.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function resolveYouTubeChannelId(
  apiKey: string,
  channelHandle: string,
  expectedChannelTitle: string,
): Promise<string> {
  const cacheKey = `${channelHandle.toLocaleLowerCase("en-US")}|${expectedChannelTitle.toLocaleLowerCase("en-US")}`;
  const cached = channelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.channelId;

  const payload = await youtubeDataJson("channels", new URLSearchParams({
    part: "snippet",
    forHandle: channelHandle,
    key: apiKey,
  }), "CNN's official YouTube channel could not be checked.");
  const channel = recordsFrom(payload).find(item =>
    asText(asObject(item.snippet)?.title)?.trim() === expectedChannelTitle,
  );
  const channelId = asText(channel?.id);
  if (!channelId || !/^[A-Za-z0-9_-]{24}$/.test(channelId)) {
    throw new RoomError(404, "CNN's official YouTube channel could not be found.");
  }
  channelCache.set(cacheKey, { channelId, expiresAt: Date.now() + CHANNEL_CACHE_MS });
  return channelId;
}

export async function searchCnnLiveStream(
  apiKey: string,
  channelId: string,
  policy: CommunityLiveStreamPolicy,
): Promise<UniversityVideoBeamTvVideoMetadata | null> {
  const cacheKey = `${channelId}|${policy.liveSearchQuery.toLocaleLowerCase("en-US")}`;
  const cached = liveSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.video;
  const pending = liveSearchInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const searchPayload = await youtubeDataJson("search", new URLSearchParams({
      part: "snippet",
      type: "video",
      eventType: "live",
      channelId,
      videoEmbeddable: "true",
      safeSearch: "strict",
      relevanceLanguage: "en",
      regionCode: "US",
      maxResults: "10",
      q: policy.liveSearchQuery,
      key: apiKey,
    }), "CNN's live stream could not be searched right now.");

    const candidates: YouTubeVideoCandidate[] = recordsFrom(searchPayload).flatMap(item => {
      const id = asObject(item.id);
      const snippet = asObject(item.snippet);
      const videoId = asText(id?.videoId);
      const title = asText(snippet?.title);
      if (!videoId || !title) return [];
      return [{
        videoId,
        title,
        channelTitle: asText(snippet?.channelTitle),
        channelId: asText(snippet?.channelId),
        description: asText(snippet?.description),
        liveBroadcastContent: asText(snippet?.liveBroadcastContent),
        defaultLanguage: asText(snippet?.defaultLanguage),
        defaultAudioLanguage: asText(snippet?.defaultAudioLanguage),
        thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      }];
    });
    if (candidates.length === 0) {
      liveSearchCache.set(cacheKey, { video: null, expiresAt: Date.now() + LIVE_RESULT_CACHE_MS });
      return null;
    }

    const detailsPayload = await youtubeDataJson("videos", new URLSearchParams({
      part: "snippet,status,contentDetails",
      id: candidates.map(video => video.videoId).join(","),
      key: apiKey,
    }), "CNN's live stream details could not be checked right now.");
    const eligibility: YouTubeVideoEligibility[] = recordsFrom(detailsPayload).flatMap(item => {
      const videoId = asText(item.id);
      const contentDetails = asObject(item.contentDetails);
      const snippet = asObject(item.snippet);
      const status = asObject(item.status);
      const rating = asObject(contentDetails?.contentRating);
      if (!videoId) return [];
      return [{
        videoId,
        durationMs: null,
        embeddable: status?.embeddable === true,
        ytRating: asText(rating?.ytRating),
        defaultLanguage: asText(snippet?.defaultLanguage),
        defaultAudioLanguage: asText(snippet?.defaultAudioLanguage),
        thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      }];
    });
    const selected = selectExactLiveYouTubeVideo(candidates, eligibility, {
      channelId,
      channelTitle: policy.channelTitle,
      streamTitle: policy.streamTitle,
      segmentDurationMs: policy.segmentDurationMs,
    });
    const video = selected?.video ?? null;
    liveSearchCache.set(cacheKey, { video, expiresAt: Date.now() + LIVE_RESULT_CACHE_MS });
    return video;
  })();

  liveSearchInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (liveSearchInFlight.get(cacheKey) === request) liveSearchInFlight.delete(cacheKey);
  }
}
