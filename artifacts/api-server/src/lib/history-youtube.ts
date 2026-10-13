import type {
  UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import type { CommunityOfficialChannelSearchPolicy } from "./community-config";
import { RoomError } from "./room-store";
import {
  selectPlayableYouTubeVideos,
  youtubeThumbnailAspectRatios,
  YOUTUBE_VIDEO_FILTER_VERSION,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";

const HISTORY_MIN_DURATION_MS = 20 * 60_000;
type SearchResult = {
  videoIds: string[];
  titles: string[];
  videos: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};
type CacheEntry = { expiresAt: number; result: SearchResult };

const channelCache = new Map<string, { channelId: string; expiresAt: number }>();
const resultCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SearchResult>>();
const failureCache = new Map<string, { expiresAt: number; error: RoomError }>();
const FAILURE_CACHE_MS = 10 * 60_000;

function recordsFrom(payload: unknown): Record<string, unknown>[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload)
    || !Array.isArray((payload as { items?: unknown }).items)) return [];
  return (payload as { items: unknown[] }).items.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function durationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
}

async function requestJson(
  endpoint: "channels" | "search" | "videos",
  params: URLSearchParams,
  message: string,
): Promise<unknown> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new RoomError(502, message);
  }
  if (!response.ok) {
    throw new RoomError(response.status === 403 || response.status === 429 ? 503 : 502, message);
  }
  return response.json().catch(() => null);
}

export async function resolveOfficialYouTubeChannelId(
  apiKey: string,
  policy: Pick<CommunityOfficialChannelSearchPolicy, "channelHandle" | "channelTitle">,
): Promise<string> {
  const cacheKey = `${policy.channelHandle.toLowerCase()}|${policy.channelTitle.toLowerCase()}`;
  const cached = channelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.channelId;

  const payload = await requestJson("channels", new URLSearchParams({
    part: "snippet",
    forHandle: policy.channelHandle,
    key: apiKey,
  }), "The official History channel could not be checked right now.");
  const channel = recordsFrom(payload).find(item => {
    const snippet = object(item.snippet);
    return text(snippet?.title)?.trim() === policy.channelTitle
      && text(snippet?.customUrl)?.trim().toLocaleLowerCase("en-US")
        === policy.channelHandle.trim().toLocaleLowerCase("en-US");
  });
  const channelId = text(channel?.id);
  if (!channelId || !/^[A-Za-z0-9_-]{24}$/.test(channelId)) {
    throw new RoomError(404, "The official History channel could not be found.");
  }
  channelCache.set(cacheKey, { channelId, expiresAt: Date.now() + 24 * 60 * 60_000 });
  return channelId;
}

async function uncachedSearch(apiKey: string, policy: CommunityOfficialChannelSearchPolicy): Promise<SearchResult> {
  const channelId = await resolveOfficialYouTubeChannelId(apiKey, policy);
  const searchPayload = await requestJson("search", new URLSearchParams({
    part: "snippet",
    type: "video",
    channelId,
    order: "date",
    videoDuration: "long",
    videoEmbeddable: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    regionCode: "US",
    maxResults: "25",
    q: policy.query,
    key: apiKey,
  }), "History videos are temporarily unavailable.");

  const candidates: YouTubeVideoCandidate[] = recordsFrom(searchPayload).flatMap(item => {
    const videoId = text(object(item.id)?.videoId);
    const snippet = object(item.snippet);
    const title = text(snippet?.title);
    if (!videoId || !title || text(snippet?.channelId) !== channelId) return [];
    return [{
      videoId,
      title: title.slice(0, 200),
      channelTitle: text(snippet?.channelTitle),
      channelId,
      description: text(snippet?.description)?.slice(0, 500) ?? null,
      liveBroadcastContent: text(snippet?.liveBroadcastContent),
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
    }];
  });
  if (!candidates.length) throw new RoomError(404, "No suitable full-length History videos are available right now.");

  const detailsPayload = await requestJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: candidates.map(item => item.videoId).join(","),
    key: apiKey,
  }), "History video details are temporarily unavailable.");
  const eligibility: YouTubeVideoEligibility[] = recordsFrom(detailsPayload).flatMap(item => {
    const videoId = text(item.id);
    const snippet = object(item.snippet);
    if (!videoId || text(snippet?.channelId) !== channelId) return [];
    const content = object(item.contentDetails);
    const rating = object(content?.contentRating);
    const status = object(item.status);
    return [{
      videoId,
      durationMs: durationMs(content?.duration),
      embeddable: status?.embeddable === true,
      ytRating: text(rating?.ytRating),
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      description: text(snippet?.description),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }];
  });
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  const longCandidates = candidates.filter(candidate =>
    (eligibilityById.get(candidate.videoId)?.durationMs ?? 0) >= HISTORY_MIN_DURATION_MS);
  const selected = selectPlayableYouTubeVideos(longCandidates, eligibility, [policy.channelTitle], 25);
  const videos = selected.videos.map(video => ({
    videoId: video.videoId,
    title: video.title,
    channelTitle: video.channelTitle,
    description: video.description,
  }));
  if (!videos.length) throw new RoomError(404, "No suitable full-length History videos are available right now.");
  const ids = videos.map(video => video.videoId);
  const durationMsByVideoId = Object.fromEntries(
    ids.flatMap(id => selected.durationMsByVideoId[id] ? [[id, selected.durationMsByVideoId[id]!]] : []),
  );
  return { videoIds: ids, titles: videos.map(video => video.title), videos, durationMsByVideoId };
}

export async function searchOfficialHistoryVideos(
  apiKey: string,
  policy: CommunityOfficialChannelSearchPolicy,
): Promise<SearchResult> {
  const cacheKey = `${YOUTUBE_VIDEO_FILTER_VERSION}|${policy.channelHandle.toLowerCase()}|${policy.query.toLowerCase()}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const failed = failureCache.get(cacheKey);
  if (failed && failed.expiresAt > Date.now()) throw failed.error;
  if (failed) failureCache.delete(cacheKey);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = uncachedSearch(apiKey, policy);
  inFlight.set(cacheKey, request);
  try {
    const result = await request;
    resultCache.set(cacheKey, { result, expiresAt: Date.now() + policy.cacheTtlMs });
    failureCache.delete(cacheKey);
    return result;
  } catch (error) {
    const roomError = error instanceof RoomError ? error
      : new RoomError(502, "History videos are temporarily unavailable.");
    failureCache.set(cacheKey, { error: roomError, expiresAt: Date.now() + FAILURE_CACHE_MS });
    throw roomError;
  } finally {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  }
}
