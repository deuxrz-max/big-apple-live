import type {
  UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import type { CommunityWrestlingSearchPolicy } from "./community-config";
import { RoomError } from "./room-store";
import {
  selectPlayableYouTubeVideos,
  youtubeRegionAllowsCountry,
  youtubeThumbnailAspectRatios,
  YOUTUBE_VIDEO_FILTER_VERSION,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";

type SearchResult = {
  videoIds: string[];
  titles: string[];
  videos: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};

type CacheEntry = { expiresAt: number; result: SearchResult };

const cache = new Map<string, CacheEntry>();
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

async function requestYouTube(
  endpoint: "search" | "videos",
  params: URLSearchParams,
): Promise<unknown> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new RoomError(502, "Pro Wrestling videos are temporarily unavailable.");
  }
  if (!response.ok) {
    throw new RoomError(
      response.status === 403 || response.status === 429 ? 503 : 502,
      "Pro Wrestling videos are temporarily unavailable.",
    );
  }
  return response.json().catch(() => null);
}

function parseDurationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
}

async function searchFromChannel(
  apiKey: string,
  query: string,
  channel: CommunityWrestlingSearchPolicy["channels"][number],
): Promise<YouTubeVideoCandidate[]> {
  const payload = await requestYouTube("search", new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    safeSearch: "none",
    relevanceLanguage: "en",
    regionCode: "US",
    videoDuration: "medium",
    order: "date",
    maxResults: "10",
    channelId: channel.channelId,
    q: query,
    key: apiKey,
  }));
  return recordsFrom(payload).flatMap(item => {
    const videoId = text(object(item.id)?.videoId);
    const snippet = object(item.snippet);
    const title = text(snippet?.title);
    const resultChannelId = text(snippet?.channelId);
    const description = text(snippet?.description);
    if (!videoId || !title || resultChannelId !== channel.channelId
      || /\b(reaction|fan[\s-]?edit|gameplay|video[\s-]?game|gaming|wwe\s*2k|aew\s*fight\s*forever)\b/i
        .test(`${title} ${description ?? ""}`)) {
      return [];
    }
    return [{
      videoId,
      title: title.slice(0, 200),
      channelTitle: text(snippet?.channelTitle),
      channelId: resultChannelId,
      description: description?.slice(0, 500) ?? null,
      liveBroadcastContent: text(snippet?.liveBroadcastContent),
      publishedAt: text(snippet?.publishedAt),
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }];
  });
}

async function uncachedSearch(apiKey: string, policy: CommunityWrestlingSearchPolicy): Promise<SearchResult> {
  const requests = await Promise.allSettled(
    policy.channels.map(channel => searchFromChannel(apiKey, policy.query, channel)),
  );
  const candidates = requests.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (candidates.length === 0) {
    const firstError = requests.find(result => result.status === "rejected");
    if (firstError?.status === "rejected" && firstError.reason instanceof RoomError) throw firstError.reason;
    throw new RoomError(404, "No suitable official Pro Wrestling videos are available right now.");
  }

  const channelById = new Map(policy.channels.map(channel => [channel.channelId, channel]));
  const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.videoId, candidate])).values()];
  const candidateChannelIds = new Map(uniqueCandidates.map(candidate => [candidate.videoId, candidate.channelId]));
  const detailsPayload = await requestYouTube("videos", new URLSearchParams({
    part: "snippet,contentDetails,status",
    id: uniqueCandidates.map(candidate => candidate.videoId).join(","),
    key: apiKey,
  }));
  const eligibility: YouTubeVideoEligibility[] = recordsFrom(detailsPayload).flatMap(item => {
    const videoId = text(item.id);
    const snippet = object(item.snippet);
    const expectedChannel = videoId ? channelById.get(candidateChannelIds.get(videoId) ?? "") : undefined;
    if (!videoId || !expectedChannel || text(snippet?.channelId) !== expectedChannel.channelId) return [];
    const status = object(item.status);
    const contentDetails = object(item.contentDetails);
    const rating = object(contentDetails?.contentRating);
    const thumbnails = object(snippet?.thumbnails);
    return [{
      videoId,
      durationMs: parseDurationMs(contentDetails?.duration),
      embeddable: status?.embeddable === true,
      availableInUS: youtubeRegionAllowsCountry(contentDetails?.regionRestriction),
      ytRating: text(rating?.ytRating),
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(thumbnails),
      description: text(snippet?.description),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }];
  });
  const allowedTitles = policy.channels.map(channel => channel.channelTitle);
  const selected = selectPlayableYouTubeVideos(uniqueCandidates, eligibility, allowedTitles, 30);
  if (selected.videos.length === 0) {
    throw new RoomError(404, "No suitable official Pro Wrestling videos are available right now.");
  }

  const newestFirst = [...selected.videos].sort(
    (a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""),
  );
  const videos: UniversityVideoBeamTvVideoMetadata[] = newestFirst.map(video => ({
    videoId: video.videoId,
    title: video.title,
    channelTitle: video.channelTitle,
    description: video.description,
  }));
  const videoIds = videos.map(video => video.videoId);
  const durationMsByVideoId = Object.fromEntries(
    videoIds.flatMap(videoId => selected.durationMsByVideoId[videoId]
      ? [[videoId, selected.durationMsByVideoId[videoId]!]] : []),
  );
  return { videoIds, titles: videos.map(video => video.title), videos, durationMsByVideoId };
}

export async function searchOfficialProWrestlingVideos(
  apiKey: string,
  policy: CommunityWrestlingSearchPolicy,
): Promise<SearchResult> {
  const cacheKey = `${YOUTUBE_VIDEO_FILTER_VERSION}|${policy.query.trim().toLocaleLowerCase("en-US")}|${policy.channels.map(channel => channel.channelId).join(",")}`;
  const cached = cache.get(cacheKey);
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
    cache.set(cacheKey, { result, expiresAt: Date.now() + policy.cacheTtlMs });
    failureCache.delete(cacheKey);
    return result;
  } catch (error) {
    const roomError = error instanceof RoomError
      ? error
      : new RoomError(502, "Pro Wrestling videos are temporarily unavailable.");
    failureCache.set(cacheKey, { error: roomError, expiresAt: Date.now() + FAILURE_CACHE_MS });
    throw roomError;
  } finally {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  }
}
