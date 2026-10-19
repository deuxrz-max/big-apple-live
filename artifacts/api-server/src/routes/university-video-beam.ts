import { Router, type Request } from "express";
import {
  GetUniversityVideoBeamStateResponse,
  GetUniversityVideoBeamTokenBody,
  GetUniversityVideoBeamTokenResponse,
  GetUniversityVideoBeamTvStateResponse,
  GetComedyRoomVideoCatalogResponse,
  PerformUniversityVideoBeamActionBody,
  PerformUniversityVideoBeamActionResponse,
  PerformUniversityVideoBeamTvActionBody,
  PerformUniversityVideoBeamTvActionResponse,
  SearchYouTubeForVideoBeamBody,
  SearchYouTubeForVideoBeamResponse,
  type UniversityVideoBeamState,
  type UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import { TrackSource } from "livekit-server-sdk";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireCompletedProfile } from "../lib/account-profiles";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import { isLiveStreamActiveOrStarting, isLiveStreamStarting } from "../lib/live-stream-policy";
import {
  COMMUNITY_VIDEO_POOL_ROOMS,
  communityDefaultVideoSearch,
  isCommunityDailyWebSeriesRoom,
  isPublicTopicRoom,
  communityLiveStreamPolicy,
  communityVideoSearchPolicy,
} from "../lib/community-config";
import {
  selectPlayableYouTubeVideos,
  youtubeRegionAllowsCountry,
  youtubeThumbnailAspectRatios,
  YOUTUBE_VIDEO_FILTER_VERSION,
} from "../lib/youtube-video-selection";
import { resolveYouTubeChannelId, searchCnnLiveStream } from "../lib/cnn-live-news";
import {
  getCommunityPlaybackSchedule,
  getComedyPlaybackSchedule,
  getNextCommunityVideoSelection,
  getCommunityVideoPool,
  markCommunityVideoBad,
  resolveCommunityPlaybackScheduleAt,
  recordCommunityVideoPlayed,
  reserveYouTubeApiUnits,
  saveCommunityPlaybackSchedule,
  saveComedyPlaybackSchedule,
  type CommunityPlaybackSchedule,
  type CommunityPlaybackScheduleVideo,
} from "../lib/room-video-rotation";
import {
  WEB_SERIES_ROOM_ID,
  easternDateKey,
  getOrChooseWebSeries,
  nextEasternMidnightMs,
  orderedWebSeriesEpisodes,
} from "../lib/web-series";
import { logger } from "../lib/logger";
import {
  postBeamTvVoteAnnouncement,
  scheduleBeamTvVideoStart,
  updateBeamTvVideoMetadata,
} from "../lib/moderator-bots";

const router = Router();
const webSeriesMidnightTimers = new Map<string, { dueAt: number; timer: ReturnType<typeof setTimeout> }>();
universityVideoBeamStore.setAutomaticVideoStartListener((roomId, videoId, metadata) => {
  scheduleBeamTvVideoStart(roomId, videoId, metadata);
});
const participantSnapshots = new Map<string, { expiresAt: number; identities: Set<string> }>();
const appliedSpeakerPolicies = new Map<string, Map<string, string>>();
const publicPlaybackTimers = new Map<string, { dueAt: number; timer: ReturnType<typeof setTimeout> }>();
const publicPlaybackInitializations = new Map<string, Promise<void>>();
const persistedPublicPlaybackSignatures = new Map<string, string>();
let comedyScheduleInitialization: Promise<void> | null = null;
let comedyScheduleRetryAtMs = 0;
let comedyPlaybackSchedulerStarted = false;
const persistedComedyScheduleSignatures = new Map<string, string>();
let publicRoomPlaybackSchedulerStarted = false;
let newsPlaybackRetryAtMs = 0;
const PARTICIPANT_SNAPSHOT_TTL_MS = 1_500;
type YouTubeSearchResult = {
  videoIds: string[];
  titles: string[];
  videos: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
  selectedVideoId?: string;
};
const youtubeSearchCache = new Map<string, { expiresAt: number } & YouTubeSearchResult>();
const youtubeSearchFailureCache = new Map<string, { expiresAt: number; status: number; message: string }>();
const youtubeSearchInFlight = new Map<string, Promise<YouTubeSearchResult>>();
const YOUTUBE_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_SEARCH_TRANSIENT_FAILURE_MS = 10 * 60 * 1000;

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function parseYouTubeDurationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
}

async function searchYouTube(
  query: string,
  apiKey: string,
  policy: ReturnType<typeof communityVideoSearchPolicy> = null,
  options: { channelId?: string; cacheTtlMs?: number; roomId?: string } = {},
) {
  const cacheKey = [
    YOUTUBE_VIDEO_FILTER_VERSION,
    normalizeSearchQuery(query),
    policy?.order ?? "relevance",
    policy?.publishedWithinDays ?? "any-date",
    policy?.trustedChannelTitles?.map(normalizeSearchQuery).sort().join(",") ?? "all-channels",
    options.channelId ?? "any-channel",
  ].join("|");
  const cached = youtubeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
      return {
        videoIds: cached.videoIds,
        titles: cached.titles,
        videos: cached.videos,
        durationMsByVideoId: cached.durationMsByVideoId,
      };
  }
  const cachedFailure = youtubeSearchFailureCache.get(cacheKey);
  if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
    throw new RoomError(cachedFailure.status, cachedFailure.message);
  }
  if (cachedFailure) youtubeSearchFailureCache.delete(cacheKey);
  const pending = youtubeSearchInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    if (options.roomId && !(await reserveYouTubeApiUnits(options.roomId, 100))) {
      throw new RoomError(503, "YouTube is taking a break while this room's video pool is refreshed.");
    }
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "none",
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "medium",
      maxResults: "10",
      q: query,
      key: apiKey,
    });
    if (policy?.order) searchParams.set("order", policy.order);
    if (options.channelId) searchParams.set("channelId", options.channelId);
    if (policy?.publishedWithinDays) {
      searchParams.set("publishedAfter", new Date(
        Date.now() - policy.publishedWithinDays * 24 * 60 * 60 * 1_000,
      ).toISOString());
    }
    searchUrl.search = searchParams.toString();
    let response: Response;
    try {
      response = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new RoomError(502, "YouTube search could not be reached. Paste a video or playlist link instead.");
    }
    if (!response.ok) {
      const quotaOrCredentialFailure = response.status === 403 || response.status === 429;
      throw new RoomError(
        quotaOrCredentialFailure ? 503 : 502,
        "YouTube search is unavailable right now. A room-matched video will appear when it is available.",
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    const items = typeof payload === "object" && payload !== null && "items" in payload
      && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items : [];
    const results = items.flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as { id?: { videoId?: unknown }; snippet?: {
        title?: unknown; channelTitle?: unknown; channelId?: unknown;
        description?: unknown; liveBroadcastContent?: unknown;
        defaultLanguage?: unknown; defaultAudioLanguage?: unknown;
        thumbnails?: unknown; tags?: unknown;
      } };
      const videoId = record.id?.videoId;
      if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return [];
      const title = typeof record.snippet?.title === "string" ? record.snippet.title.slice(0, 200) : "YouTube video";
      const channelTitle = typeof record.snippet?.channelTitle === "string"
        ? record.snippet.channelTitle.slice(0, 120) : null;
      const description = typeof record.snippet?.description === "string"
        ? record.snippet.description.slice(0, 500) : null;
      const liveBroadcastContent = typeof record.snippet?.liveBroadcastContent === "string"
        ? record.snippet.liveBroadcastContent : null;
      const channelId = typeof record.snippet?.channelId === "string"
        ? record.snippet.channelId : null;
      return [{
        videoId, title, channelTitle, description, liveBroadcastContent, channelId,
        defaultLanguage: typeof record.snippet?.defaultLanguage === "string"
          ? record.snippet.defaultLanguage : null,
        defaultAudioLanguage: typeof record.snippet?.defaultAudioLanguage === "string"
          ? record.snippet.defaultAudioLanguage : null,
        thumbnailAspectRatios: youtubeThumbnailAspectRatios(record.snippet?.thumbnails),
        tags: Array.isArray(record.snippet?.tags)
          ? record.snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
      }];
    });
    if (results.length === 0) throw new RoomError(404, "No embeddable YouTube videos were found for that topic.");

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    // Public videos.list responses do not expose source width/height for videos
    // owned by other channels. Keep the server-side duration, Shorts metadata,
    // language, and thumbnail checks rather than requesting owner-only fileDetails.
    detailsUrl.search = new URLSearchParams({
      part: "snippet,contentDetails,status",
      id: results.map(item => item.videoId).join(","),
      key: apiKey,
    }).toString();
    if (options.roomId && !(await reserveYouTubeApiUnits(options.roomId, 1))) {
      throw new RoomError(503, "YouTube is taking a break while this room's video pool is refreshed.");
    }
    let detailsResponse: Response;
    try {
      detailsResponse = await fetch(detailsUrl, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new RoomError(502, "YouTube video details could not be reached. Try again shortly.");
    }
    if (!detailsResponse.ok) {
      throw new RoomError(
        detailsResponse.status === 403 || detailsResponse.status === 429 ? 503 : 502,
        "YouTube video details are unavailable right now.",
      );
    }
    const detailsPayload: unknown = await detailsResponse.json().catch(() => null);
    const details = typeof detailsPayload === "object" && detailsPayload !== null && "items" in detailsPayload
      && Array.isArray((detailsPayload as { items?: unknown }).items)
      ? (detailsPayload as { items: unknown[] }).items : [];
    const eligibility = details.flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as {
        id?: unknown;
        snippet?: {
          defaultLanguage?: unknown; defaultAudioLanguage?: unknown;
          thumbnails?: unknown; description?: unknown; tags?: unknown;
        };
        contentDetails?: {
          duration?: unknown;
          contentRating?: { ytRating?: unknown };
          regionRestriction?: unknown;
        };
        status?: { embeddable?: unknown };
      };
      if (typeof record.id !== "string") return [];
      return [{
        videoId: record.id,
        durationMs: parseYouTubeDurationMs(record.contentDetails?.duration),
        embeddable: record.status?.embeddable === true,
        availableInUS: youtubeRegionAllowsCountry(record.contentDetails?.regionRestriction),
        ytRating: typeof record.contentDetails?.contentRating?.ytRating === "string"
          ? record.contentDetails.contentRating.ytRating : null,
        defaultLanguage: typeof record.snippet?.defaultLanguage === "string"
          ? record.snippet.defaultLanguage : null,
        defaultAudioLanguage: typeof record.snippet?.defaultAudioLanguage === "string"
          ? record.snippet.defaultAudioLanguage : null,
        thumbnailAspectRatios: youtubeThumbnailAspectRatios(record.snippet?.thumbnails),
        description: typeof record.snippet?.description === "string" ? record.snippet.description : null,
        tags: Array.isArray(record.snippet?.tags)
          ? record.snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
      }];
    });
    const playable = selectPlayableYouTubeVideos(results, eligibility, policy?.trustedChannelTitles);
    if (playable.videos.length === 0) {
      throw new RoomError(404, "No suitable videos are available for this room right now.");
    }
    return {
      videoIds: playable.videos.map(item => item.videoId),
      titles: playable.videos.map(item => item.title),
      videos: playable.videos.map(video => ({
        videoId: video.videoId,
        title: video.title,
        channelTitle: video.channelTitle,
        description: video.description,
      })),
      durationMsByVideoId: playable.durationMsByVideoId,
    };
  })();
  youtubeSearchInFlight.set(cacheKey, request);
  try {
    const result = await request;
    youtubeSearchCache.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + (options.cacheTtlMs ?? YOUTUBE_SEARCH_CACHE_MS),
    });
    youtubeSearchFailureCache.delete(cacheKey);
    if (youtubeSearchCache.size > 100) {
      const oldestKey = youtubeSearchCache.keys().next().value;
      if (oldestKey) youtubeSearchCache.delete(oldestKey);
    }
    return result;
  } catch (error) {
    if (error instanceof RoomError) {
      const cacheMs = error.status === 404 || error.status === 503
        ? YOUTUBE_SEARCH_CACHE_MS
        : YOUTUBE_SEARCH_TRANSIENT_FAILURE_MS;
      youtubeSearchFailureCache.set(cacheKey, {
        expiresAt: Date.now() + cacheMs,
        status: error.status,
        message: error.message,
      });
      if (youtubeSearchFailureCache.size > 100) {
        const oldestKey = youtubeSearchFailureCache.keys().next().value;
        if (oldestKey) youtubeSearchFailureCache.delete(oldestKey);
      }
    }
    throw error;
  } finally {
    if (youtubeSearchInFlight.get(cacheKey) === request) youtubeSearchInFlight.delete(cacheKey);
  }
}

async function searchDefaultCommunityVideos(roomId: string, apiKey: string) {
  const livePolicy = communityLiveStreamPolicy(roomId, roomStore);
  if (!livePolicy) {
    const selection = await getNextCommunityVideoSelection(roomId, apiKey, roomStore);
    return {
      videoIds: selection.queue.map(video => video.videoId),
      titles: selection.queue.map(video => video.title),
      videos: selection.queue,
      durationMsByVideoId: selection.durationMsByVideoId,
      selectedVideoId: selection.selected?.videoId,
    };
  }

  const savedFallback = async () => {
    const selection = await getNextCommunityVideoSelection(roomId, apiKey, roomStore);
    return {
      videoIds: selection.queue.map(video => video.videoId),
      titles: selection.queue.map(video => video.title),
      videos: selection.queue,
      durationMsByVideoId: selection.durationMsByVideoId,
      selectedVideoId: selection.selected?.videoId,
    };
  };
  if (!apiKey) {
    logger.warn({ roomId }, "YouTube key unavailable; serving the saved News room queue");
    return savedFallback();
  }
  try {
    const channelId = await resolveYouTubeChannelId(
      apiKey,
      livePolicy.channelHandle,
      livePolicy.channelTitle,
      units => reserveYouTubeApiUnits(roomId, units),
    );
    const liveVideo = await searchCnnLiveStream(
      apiKey,
      channelId,
      livePolicy,
      units => reserveYouTubeApiUnits(roomId, units),
    );
    if (liveVideo) {
      return {
        videoIds: [liveVideo.videoId],
        titles: [liveVideo.title],
        videos: [liveVideo],
        durationMsByVideoId: { [liveVideo.videoId]: livePolicy.segmentDurationMs },
      };
    }
    const latestFallback = await searchYouTube(
      livePolicy.fallbackSearch,
      apiKey,
      communityVideoSearchPolicy(roomId, roomStore),
      { channelId, cacheTtlMs: 60 * 60_000, roomId },
    );
    if (latestFallback.videos.length) return latestFallback;
  } catch (error) {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "CNN live and latest-video lookup failed; using the saved filtered News queue");
  }

  return savedFallback();
}

function requireMember(req: Request, roomId: string, id: string) {
  const sessionId = req.get("X-Room-Session") ?? "";
  const participant = roomStore.requireAccountMember(roomId, sessionId, id);
  return { sessionId, participant };
}

function isComedyRoom(roomId: string) {
  return (roomStore.communityParentId(roomId)?.toUpperCase() ?? roomId.toUpperCase()) === "COMEDY";
}

function isServerScheduledPoolRoom(roomId: string) {
  const parentId = roomStore.communityParentId(roomId)?.toUpperCase() ?? roomId.toUpperCase();
  return parentId !== "COMEDY"
    && COMMUNITY_VIDEO_POOL_ROOMS.some(room => room.roomId === parentId)
    && isPublicTopicRoom(roomId, roomStore);
}

function scheduleFromTv(roomId: string, tv: UniversityVideoBeamState["tv"]): CommunityPlaybackSchedule | null {
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  if (!isPublicTopicRoom(roomId, roomStore)
    || !defaultSearch
    || tv.sourceType !== "search"
    || normalizeSearchQuery(tv.sourceValue ?? "") !== normalizeSearchQuery(defaultSearch)
    || !tv.currentVideoId
    || tv.startedAtMs === null) return null;
  const durations = universityVideoBeamStore.getAutomaticVideoDurationsMs(roomId);
  const metadata = new Map(tv.videoMetadata.map(video => [video.videoId, video]));
  const queue: CommunityPlaybackScheduleVideo[] = tv.queue
    .map(videoId => {
      const item = metadata.get(videoId);
      const durationMs = durations[videoId];
      if (!item || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
      return { ...item, durationMs };
    })
    .filter((video): video is CommunityPlaybackScheduleVideo => video !== null)
    .slice(0, 50);
  if (!queue.some(video => video.videoId === tv.currentVideoId)) return null;
  return {
    currentVideoId: tv.currentVideoId,
    startedAtMs: tv.startedAtMs,
    breakEndsAtMs: tv.breakEndsAtMs,
    queue,
    seriesTitle: tv.seriesTitle,
    seriesDate: tv.seriesDate?.toISOString().slice(0, 10) ?? null,
    seriesEpisodeNumber: tv.seriesEpisodeNumber,
  };
}

async function persistCommunityPlaybackScheduleBestEffort(
  roomId: string,
  tv: UniversityVideoBeamState["tv"],
) {
  const schedule = scheduleFromTv(roomId, tv);
  if (!schedule) return;
  const signature = JSON.stringify(schedule);
  if (persistedPublicPlaybackSignatures.get(roomId) === signature) return;
  try {
    await saveCommunityPlaybackSchedule(roomId, schedule);
    persistedPublicPlaybackSignatures.set(roomId, signature);
  } catch (error) {
    logger.warn({
      roomId,
      error: error instanceof Error ? error.message : "unknown",
    }, "Room playback continues; its latest server timeline checkpoint could not be saved");
  }
}

async function initializeOrRestorePoolRoomPlayback(roomId: string) {
  const current = universityVideoBeamStore.getState(roomId);
  if (current.tv.currentVideoId && current.tv.startedAtMs !== null) {
    await persistCommunityPlaybackScheduleBestEffort(roomId, current.tv);
    await catchUpPoolRoomPlayback(roomId);
    return;
  }

  const pool = await getCommunityVideoPool(roomId, "", roomStore);
  if (!pool.length) return;
  const saved = await getCommunityPlaybackSchedule(roomId);
  const poolById = new Map(pool.map(video => [video.videoId, video]));
  const savedQueue = saved?.queue
    .filter(video => poolById.has(video.videoId))
    .map(video => {
      const currentPoolItem = poolById.get(video.videoId)!;
      return {
        videoId: video.videoId,
        title: currentPoolItem.title,
        channelTitle: currentPoolItem.channelTitle,
        description: currentPoolItem.description,
        durationMs: currentPoolItem.durationMs,
      };
    }) ?? [];
  const savedCurrentAvailable = Boolean(
    saved && poolById.has(saved.currentVideoId) && savedQueue.some(video => video.videoId === saved.currentVideoId),
  );

  if (saved && savedCurrentAvailable) {
    const restoredSchedule = resolveCommunityPlaybackScheduleAt(
      { ...saved, queue: savedQueue },
      Date.now(),
      3 * 60_000,
    );
    const videos = restoredSchedule.queue.map(({ durationMs: _duration, ...video }) => video);
    const restored = universityVideoBeamStore.restoreAutomaticDefaultTvQueue(
      roomId,
      videos,
      Object.fromEntries(restoredSchedule.queue.map(video => [video.videoId, video.durationMs])),
      restoredSchedule.currentVideoId,
      restoredSchedule.startedAtMs,
      restoredSchedule.breakEndsAtMs,
      restoredSchedule.seriesTitle && restoredSchedule.seriesDate
        ? {
          title: restoredSchedule.seriesTitle,
          date: restoredSchedule.seriesDate,
          episodeNumber: restoredSchedule.seriesEpisodeNumber,
        }
        : undefined,
      true,
    );
    await persistCommunityPlaybackScheduleBestEffort(
      roomId,
      universityVideoBeamStore.getState(roomId).tv,
    );
    logger.info({
      roomId,
      currentVideoId: restoredSchedule.currentVideoId,
      startedAtMs: restoredSchedule.startedAtMs,
      restoredFromServerSchedule: true,
    }, "Restored the room's server-owned video timeline");
  } else {
    const selection = await getNextCommunityVideoSelection(roomId, "", roomStore);
    if (!selection.selected || !selection.queue.length) return;
    const started = universityVideoBeamStore.initializeDefaultTvQueue(
      roomId,
      communityDefaultVideoSearch(roomId, roomStore),
      selection.queue,
      selection.durationMsByVideoId,
    );
    if (!started.tv.currentVideoId) return;
    await recordCommunityVideoPlayed(roomId, started.tv.currentVideoId);
    await persistCommunityPlaybackScheduleBestEffort(roomId, started.tv);
    logger.info({
      roomId,
      currentVideoId: started.tv.currentVideoId,
      startedAtMs: started.tv.startedAtMs,
      savedVideoCount: pool.length,
    }, "Started room video playback from its saved server-side pool");
  }
  await catchUpPoolRoomPlayback(roomId);
}

async function ensurePoolRoomPlayback(roomId: string): Promise<void> {
  if (!isServerScheduledPoolRoom(roomId)) return;
  const existing = publicPlaybackInitializations.get(roomId);
  if (existing) return existing;
  const pending = initializeOrRestorePoolRoomPlayback(roomId)
    .catch(error => {
      logger.warn({
        roomId,
        error: error instanceof Error ? error.message : "unknown",
      }, "Could not initialize the room's saved video timeline");
    })
    .finally(() => publicPlaybackInitializations.delete(roomId));
  publicPlaybackInitializations.set(roomId, pending);
  return pending;
}

async function initializeOrRestoreNewsPlayback() {
  const roomId = "NEWS01";
  const current = universityVideoBeamStore.getState(roomId);
  if (current.tv.currentVideoId && current.tv.startedAtMs !== null) {
    await persistCommunityPlaybackScheduleBestEffort(roomId, current.tv);
    schedulePublicPlaybackTransition(roomId);
    return;
  }
  if (Date.now() < newsPlaybackRetryAtMs) return;

  const saved = await getCommunityPlaybackSchedule(roomId);
  if (saved) {
    const schedule = resolveCommunityPlaybackScheduleAt(saved, Date.now(), 3 * 60_000);
    const restored = universityVideoBeamStore.restoreAutomaticDefaultTvQueue(
      roomId,
      schedule.queue.map(({ durationMs: _duration, ...video }) => video),
      Object.fromEntries(schedule.queue.map(video => [video.videoId, video.durationMs])),
      schedule.currentVideoId,
      schedule.startedAtMs,
      schedule.breakEndsAtMs,
      undefined,
      true,
    );
    await persistCommunityPlaybackScheduleBestEffort(roomId, restored.tv);
    schedulePublicPlaybackTransition(roomId);
    logger.info({
      roomId,
      currentVideoId: schedule.currentVideoId,
      startedAtMs: schedule.startedAtMs,
    }, "Restored the server-owned News room video timeline");
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim() ?? "";
  const result = await searchDefaultCommunityVideos(roomId, apiKey);
  if (!result.videos.length) {
    newsPlaybackRetryAtMs = Date.now() + 5 * 60_000;
    logger.warn({ roomId }, "No saved News videos are available; the server will retry later");
    return;
  }
  const started = universityVideoBeamStore.initializeDefaultTvQueue(
    roomId,
    communityDefaultVideoSearch(roomId, roomStore) ?? "World News",
    result.videos,
    result.durationMsByVideoId,
  );
  if (!started.tv.currentVideoId) return;
  newsPlaybackRetryAtMs = 0;
  await recordCommunityVideoPlayed(roomId, started.tv.currentVideoId);
  await persistCommunityPlaybackScheduleBestEffort(roomId, started.tv);
  scheduleBeamTvVideoStart(
    roomId,
    started.tv.currentVideoId,
    started.tv.videoMetadata.find(video => video.videoId === started.tv.currentVideoId),
  );
  schedulePublicPlaybackTransition(roomId);
  logger.info({
    roomId,
    currentVideoId: started.tv.currentVideoId,
    startedAtMs: started.tv.startedAtMs,
  }, "Started the News room video timeline from its configured live stream or saved fallback");
}

function ensureNewsRoomPlayback(): Promise<void> {
  const roomId = "NEWS01";
  const existing = publicPlaybackInitializations.get(roomId);
  if (existing) return existing;
  const pending = initializeOrRestoreNewsPlayback()
    .catch(error => {
      newsPlaybackRetryAtMs = Date.now() + 5 * 60_000;
      logger.warn({
        roomId,
        error: error instanceof Error ? error.message : "unknown",
      }, "Could not initialize the News room video timeline");
    })
    .finally(() => publicPlaybackInitializations.delete(roomId));
  publicPlaybackInitializations.set(roomId, pending);
  return pending;
}

async function catchUpPoolRoomPlayback(roomId: string) {
  if (!isServerScheduledPoolRoom(roomId)
    && !isCommunityDailyWebSeriesRoom(roomId, roomStore)) return;
  for (let step = 0; step < 1_000; step += 1) {
    const before = universityVideoBeamStore.getState(roomId).tv;
    if (!before.currentVideoId || before.startedAtMs === null) break;
    universityVideoBeamStore.getNextAutomaticPlaybackTransitionAt(roomId);
    const current = universityVideoBeamStore.getState(roomId).tv;
    if (current.breakEndsAtMs === null || current.breakEndsAtMs > Date.now()) {
      schedulePublicPlaybackTransition(roomId);
      break;
    }
    await refreshTopicQueueAtTransition(roomId, { ...universityVideoBeamStore.getState(roomId), tv: current });
    const after = universityVideoBeamStore.getState(roomId).tv;
    if (after.currentVideoId === current.currentVideoId
      && after.startedAtMs === current.startedAtMs
      && after.breakEndsAtMs === current.breakEndsAtMs) break;
  }
}

export function startCommunityRoomPlaybackScheduler(): void {
  if (publicRoomPlaybackSchedulerStarted) return;
  publicRoomPlaybackSchedulerStarted = true;
  const tick = () => {
    for (const room of COMMUNITY_VIDEO_POOL_ROOMS) {
      if (room.roomId === "COMEDY") continue;
      void ensurePoolRoomPlayback(room.roomId);
    }
    void ensureNewsRoomPlayback();
  };
  tick();
  const interval = setInterval(tick, 30_000);
  interval.unref();
  logger.info({
    rooms: COMMUNITY_VIDEO_POOL_ROOMS.filter(room => room.roomId !== "COMEDY").map(room => room.roomId),
    intervalMs: 30_000,
  }, "Started server-owned playback timelines for saved room video pools");
}

async function persistComedySchedule(
  tv: UniversityVideoBeamState["tv"],
): Promise<void> {
  if (!tv.currentVideoId || tv.startedAtMs === null) return;
  const schedule = {
    currentVideoId: tv.currentVideoId,
    startedAtMs: tv.startedAtMs,
    breakEndsAtMs: tv.breakEndsAtMs,
  };
  const signature = JSON.stringify(schedule);
  if (persistedComedyScheduleSignatures.get("COMEDY") === signature) return;
  await saveComedyPlaybackSchedule(schedule);
  persistedComedyScheduleSignatures.set("COMEDY", signature);
}

async function persistComedyScheduleBestEffort(
  tv: UniversityVideoBeamState["tv"],
): Promise<void> {
  try {
    await persistComedySchedule(tv);
  } catch (error) {
    logger.warn({ roomId: "COMEDY", error: error instanceof Error ? error.message : "unknown" },
      "Comedy TV is still playing; its latest schedule checkpoint could not be saved");
  }
}

async function ensureComedyTvSchedule(): Promise<void> {
  const existingState = universityVideoBeamStore.getState("COMEDY");
  if (existingState.tv.currentVideoId) {
    await persistComedyScheduleBestEffort(existingState.tv);
    schedulePublicPlaybackTransition("COMEDY");
    return;
  }
  if (comedyScheduleInitialization) return comedyScheduleInitialization;
  if (Date.now() < comedyScheduleRetryAtMs) return;

  comedyScheduleInitialization = (async () => {
    const pool = await getCommunityVideoPool("COMEDY", "", roomStore);
    if (!pool.length) {
      comedyScheduleRetryAtMs = Date.now() + 30_000;
      return;
    }
    comedyScheduleRetryAtMs = 0;
    const savedSchedule = await getComedyPlaybackSchedule();
    const savedCurrent = savedSchedule
      ? pool.find(video => video.videoId === savedSchedule.currentVideoId)
      : undefined;
    let state: UniversityVideoBeamState;
    if (savedSchedule && savedCurrent) {
      state = universityVideoBeamStore.restoreAutomaticDefaultTvQueue(
        "COMEDY",
        pool.map(video => ({
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          description: video.description,
        })),
        Object.fromEntries(pool.map(video => [video.videoId, video.durationMs])),
        savedSchedule.currentVideoId,
        savedSchedule.startedAtMs,
        savedSchedule.breakEndsAtMs,
      );
    } else {
      const selection = await getNextCommunityVideoSelection(
        "COMEDY", process.env.YOUTUBE_API_KEY?.trim() ?? "", roomStore,
      );
      if (!selection.selected || !selection.queue.length) {
        comedyScheduleRetryAtMs = Date.now() + 30_000;
        return;
      }
      state = universityVideoBeamStore.initializeDefaultTvQueue(
        "COMEDY",
        communityDefaultVideoSearch("COMEDY", roomStore) ?? "Comedy",
        selection.queue,
        selection.durationMsByVideoId,
      );
      if (!state.tv.currentVideoId) return;
      await recordCommunityVideoPlayed("COMEDY", state.tv.currentVideoId);
      scheduleBeamTvVideoStart(
        "COMEDY",
        state.tv.currentVideoId,
        state.tv.videoMetadata.find(video => video.videoId === state.tv.currentVideoId),
      );
    }
    logger.info({
      roomId: "COMEDY",
      currentVideoId: state.tv.currentVideoId,
      restoredFromServerSchedule: Boolean(savedSchedule && savedCurrent),
      savedPlayableVideoCount: pool.length,
      startedAtMs: state.tv.startedAtMs,
    }, "Comedy Beam TV is running from its server-owned saved-video schedule");
    await persistComedyScheduleBestEffort(state.tv);
    schedulePublicPlaybackTransition("COMEDY");
  })().finally(() => {
    comedyScheduleInitialization = null;
  });
  return comedyScheduleInitialization;
}

export function startComedyTvPlaybackScheduler(): void {
  if (comedyPlaybackSchedulerStarted) return;
  comedyPlaybackSchedulerStarted = true;
  const tick = () => {
    void ensureComedyTvSchedule().catch(error => {
      logger.warn({ roomId: "COMEDY", error: error instanceof Error ? error.message : "unknown" },
        "Comedy's saved TV schedule could not be restored");
    });
  };
  tick();
  const interval = setInterval(tick, 15_000);
  interval.unref();
  logger.info({ roomId: "COMEDY", intervalMs: 15_000 },
    "Started server-owned Comedy TV playback schedule");
}

async function reconcileState(roomId: string, viewerAccountId?: string) {
  if (isComedyRoom(roomId)) await ensureComedyTvSchedule();
  else if (communityLiveStreamPolicy(roomId, roomStore)) await ensureNewsRoomPlayback();
  else if (isCommunityDailyWebSeriesRoom(roomId, roomStore)) {
    scheduleWebSeriesMidnight(roomId);
    await activateWebSeriesForToday(roomId, false);
  } else if (isServerScheduledPoolRoom(roomId)) {
    await ensurePoolRoomPlayback(roomId);
  }
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let snapshot = participantSnapshots.get(roomName);
  if (!snapshot || snapshot.expiresAt <= Date.now()) {
    try {
      const participants = await liveKitBeamService.listParticipants(roomName);
      snapshot = {
        expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS,
        identities: new Set(participants.map(participant => participant.identity)),
      };
      participantSnapshots.set(roomName, snapshot);
    } catch (error) {
      if (!isPublicTopicRoom(roomId, roomStore)) throw error;
      logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
        "Public room video schedules continue while LiveKit presence is unavailable");
      snapshot = {
        expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS,
        identities: snapshot?.identities ?? new Set<string>(),
      };
      participantSnapshots.set(roomName, snapshot);
    }
  }
  const state = universityVideoBeamStore.reconcileLiveKitParticipants(
    roomId,
    snapshot.identities,
    viewerAccountId,
  );
  let synchronized = state;
  try {
    synchronized = await synchronizeSpeakerMediaPermissions(
      roomId, state, snapshot.identities, viewerAccountId,
    );
  } catch (error) {
    if (!isPublicTopicRoom(roomId, roomStore)) throw error;
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Public room video schedule continues while room audio permissions are temporarily unavailable");
  }
  if (isComedyRoom(roomId)) await persistComedyScheduleBestEffort(synchronized.tv);
  else await persistCommunityPlaybackScheduleBestEffort(roomId, synchronized.tv);
  schedulePublicPlaybackTransition(roomId);
  return synchronized;
}

async function refreshNewsQueueAtTransition(
  roomId: string,
  state: UniversityVideoBeamState,
  transitionAt: number,
) {
  const livePolicy = communityLiveStreamPolicy(roomId, roomStore);
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const tv = state.tv;
  if (!livePolicy || !defaultSearch || !tv.enabled || tv.sourceType !== "search"
    || normalizeSearchQuery(tv.sourceValue ?? "") !== normalizeSearchQuery(defaultSearch)
    || tv.breakEndsAtMs !== null || tv.startedAtMs !== transitionAt || !tv.currentVideoId) {
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  try {
    const result = await searchDefaultCommunityVideos(roomId, apiKey ?? "");
    const refreshed = universityVideoBeamStore.refreshAutomaticDefaultTvQueue(
      roomId,
      defaultSearch,
      result.videos,
      result.durationMsByVideoId,
      tv.currentVideoId,
      transitionAt,
      transitionAt,
    );
    if (refreshed.tv.currentVideoId !== tv.currentVideoId && refreshed.tv.currentVideoId) {
      scheduleBeamTvVideoStart(
        roomId,
        refreshed.tv.currentVideoId,
        refreshed.tv.videoMetadata.find(video => video.videoId === refreshed.tv.currentVideoId),
        true,
      );
    }
    await persistCommunityPlaybackScheduleBestEffort(roomId, refreshed.tv);
    const roomName = universityVideoBeamStore.getRoomName(roomId);
    const identities = await refreshParticipantSnapshot(roomName);
    await synchronizeSpeakerMediaPermissions(roomId, refreshed, identities);
    schedulePublicPlaybackTransition(roomId);
  } catch (error) {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Could not refresh the News room's automatic Beam TV queue");
  }
}

function scheduleWebSeriesMidnight(roomId: string) {
  const dueAt = nextEasternMidnightMs();
  const previous = webSeriesMidnightTimers.get(roomId);
  if (previous?.dueAt === dueAt) return;
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    const current = webSeriesMidnightTimers.get(roomId);
    if (current?.dueAt !== dueAt) return;
    webSeriesMidnightTimers.delete(roomId);
    if (!roomStore.isCommunity(roomId)) return;
    void activateWebSeriesForToday(roomId).catch(error => {
      logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
        "Could not select the Web Series room's next daily show");
    }).finally(() => scheduleWebSeriesMidnight(roomId));
  }, Math.max(0, dueAt - Date.now()));
  timer.unref?.();
  webSeriesMidnightTimers.set(roomId, { dueAt, timer });
}

async function activateWebSeriesForToday(roomId: string, synchronizeMedia = true) {
  const easternDate = easternDateKey();
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() || null;
  const selection = await getOrChooseWebSeries(apiKey);
  if (selection && selection.easternDate !== easternDate) return;
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  if (!defaultSearch) return;
  const current = universityVideoBeamStore.getState(roomId).tv;
  if (!current.currentVideoId && selection && selection.easternDate === easternDate) {
    const saved = await getCommunityPlaybackSchedule(roomId);
    const orderedEpisodes = orderedWebSeriesEpisodes(selection);
    const episodeIds = new Set(orderedEpisodes.map(episode => episode.videoId));
    if (saved?.seriesDate === easternDate
      && saved.seriesTitle === selection.seriesTitle
      && episodeIds.has(saved.currentVideoId)
      && saved.queue.some(video => video.videoId === saved.currentVideoId)) {
      const schedule = resolveCommunityPlaybackScheduleAt(
        {
          ...saved,
          queue: orderedEpisodes.map(episode => ({
            videoId: episode.videoId,
            title: episode.title,
            channelTitle: episode.channelTitle,
            description: episode.description,
            durationMs: episode.durationMs,
          })),
        },
        Date.now(),
        3 * 60_000,
      );
      const restored = universityVideoBeamStore.restoreAutomaticDefaultTvQueue(
        roomId,
        schedule.queue.map(({ durationMs: _duration, ...video }) => video),
        Object.fromEntries(schedule.queue.map(video => [video.videoId, video.durationMs])),
        schedule.currentVideoId,
        schedule.startedAtMs,
        schedule.breakEndsAtMs,
        {
          title: selection.seriesTitle,
          date: easternDate,
          episodeNumber: schedule.seriesEpisodeNumber,
        },
        true,
      );
      await persistCommunityPlaybackScheduleBestEffort(roomId, restored.tv);
      await catchUpPoolRoomPlayback(roomId);
      return;
    }
  }
  const nextTitle = selection?.seriesTitle ?? null;
  const alreadyApplied = current.seriesDate?.toISOString().slice(0, 10) === easternDate
    && current.seriesTitle === nextTitle
    && (selection
      ? current.queue.length === selection.episodes.length && !!current.currentVideoId
      : !current.currentVideoId && current.queue.length === 0);
  if (alreadyApplied) return;

  const durationMsByVideoId = Object.fromEntries(
    (selection?.episodes ?? []).map(episode => [episode.videoId, episode.durationMs]),
  );
  const state = universityVideoBeamStore.replaceDailyWebSeries(
    roomId,
    defaultSearch,
    easternDate,
    selection ? {
      title: selection.seriesTitle,
      episodes: orderedWebSeriesEpisodes(selection).map(episode => ({
        videoId: episode.videoId,
        title: episode.title,
        channelTitle: episode.channelTitle,
        description: episode.description,
      })),
      durationMsByVideoId,
    } : null,
  );
  if (state.tv.currentVideoId && state.tv.startedAtMs !== null) {
    scheduleBeamTvVideoStart(
      roomId,
      state.tv.currentVideoId,
      state.tv.videoMetadata.find(video => video.videoId === state.tv.currentVideoId),
      true,
    );
  }
  await persistCommunityPlaybackScheduleBestEffort(roomId, state.tv);
  if (synchronizeMedia) {
    const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
    await synchronizeSpeakerMediaPermissions(roomId, state, identities);
  }
  schedulePublicPlaybackTransition(roomId);
}

export function startWebSeriesDailySelection() {
  const roomId = WEB_SERIES_ROOM_ID;
  scheduleWebSeriesMidnight(roomId);
  void activateWebSeriesForToday(roomId, false).catch(error => {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Could not initialize today's Web Series selection");
  });
}

async function refreshTopicQueueAtTransition(
  roomId: string,
  state: UniversityVideoBeamState,
) {
  const livePolicy = communityLiveStreamPolicy(roomId, roomStore);
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const tv = state.tv;
  const comedyContinuous = isComedyRoom(roomId);
  const currentDurationMs = comedyContinuous && tv.currentVideoId
    ? universityVideoBeamStore.getAutomaticVideoDurationMs(roomId, tv.currentVideoId)
    : null;
  const comedyVideoEnded = comedyContinuous && tv.currentVideoId && tv.startedAtMs !== null
    && currentDurationMs !== null && tv.startedAtMs + currentDurationMs <= Date.now();
  if (livePolicy || !defaultSearch || !tv.enabled || tv.sourceType !== "search"
    || normalizeSearchQuery(tv.sourceValue ?? "") !== normalizeSearchQuery(defaultSearch)
    || !tv.currentVideoId || tv.startedAtMs === null
    || (comedyContinuous
      ? !comedyVideoEnded
      : tv.breakEndsAtMs === null || tv.breakEndsAtMs > Date.now())) {
    return;
  }

  if (isCommunityDailyWebSeriesRoom(roomId, roomStore)) {
    try {
      const selection = await getOrChooseWebSeries(process.env.YOUTUBE_API_KEY?.trim() || null);
      if (!selection || selection.easternDate !== easternDateKey()) return;
      const episodes = orderedWebSeriesEpisodes(selection);
      const currentIndex = episodes.findIndex(episode =>
        episode.episodeNumber === tv.seriesEpisodeNumber || episode.videoId === tv.currentVideoId,
      );
      const nextEpisode = episodes[(currentIndex + 1 + episodes.length) % episodes.length];
      if (!nextEpisode) return;
      const advanced = universityVideoBeamStore.advanceAutomaticDefaultTvVideo(
        roomId,
        episodes.map(episode => ({
          videoId: episode.videoId,
          title: episode.title,
          channelTitle: episode.channelTitle,
          description: episode.description,
        })),
        Object.fromEntries(episodes.map(episode => [episode.videoId, episode.durationMs])),
        nextEpisode.videoId,
        tv.currentVideoId,
        tv.startedAtMs,
        tv.breakEndsAtMs,
        {
          title: selection.seriesTitle,
          date: selection.easternDate,
          episodeNumber: nextEpisode.episodeNumber,
        },
        tv.breakEndsAtMs ?? undefined,
      );
      if (advanced.tv.startedAtMs !== tv.startedAtMs
        && advanced.tv.currentVideoId === nextEpisode.videoId) {
        await persistCommunityPlaybackScheduleBestEffort(roomId, advanced.tv);
        const roomName = universityVideoBeamStore.getRoomName(roomId);
        try {
          const identities = await refreshParticipantSnapshot(roomName);
          await synchronizeSpeakerMediaPermissions(roomId, advanced, identities);
        } catch (error) {
          logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
            "Could not refresh Web Series speaker media permissions");
        }
        schedulePublicPlaybackTransition(roomId);
      }
    } catch (error) {
      logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
        "Could not advance the Web Series episode");
    }
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  try {
    let advanced: UniversityVideoBeamState;
    if (comedyContinuous && currentDurationMs !== null) {
      const selection = await getNextCommunityVideoSelection(roomId, apiKey ?? "", roomStore);
      if (!selection.selected || !selection.queue.length) return;
      advanced = universityVideoBeamStore.advanceAutomaticDefaultTvVideo(
        roomId,
        selection.queue,
        selection.durationMsByVideoId,
        selection.selected.videoId,
        tv.currentVideoId,
        tv.startedAtMs,
        tv.breakEndsAtMs,
        undefined,
        tv.startedAtMs + currentDurationMs,
      );
    } else {
      const currentIndex = tv.queue.indexOf(tv.currentVideoId);
      if (currentIndex < 0 || !tv.queue.length || tv.breakEndsAtMs === null) return;
      const nextIndex = (currentIndex + 1) % tv.queue.length;
      const wrapsQueue = nextIndex === 0;
      if (wrapsQueue) {
        const selection = await getNextCommunityVideoSelection(roomId, "", roomStore);
        if (selection.selected && selection.queue.length) {
          advanced = universityVideoBeamStore.advanceAutomaticDefaultTvVideo(
            roomId,
            selection.queue,
            selection.durationMsByVideoId,
            selection.selected.videoId,
            tv.currentVideoId,
            tv.startedAtMs,
            tv.breakEndsAtMs,
            undefined,
            tv.breakEndsAtMs,
          );
          if (advanced.tv.startedAtMs === tv.startedAtMs) return;
        } else {
          const nextVideoId = tv.queue[nextIndex];
          if (!nextVideoId) return;
          advanced = universityVideoBeamStore.advanceAutomaticDefaultTvQueue(
            roomId,
            nextVideoId,
            tv.currentVideoId,
            tv.startedAtMs,
            tv.breakEndsAtMs,
            tv.breakEndsAtMs,
          );
        }
      } else {
        const nextVideoId = tv.queue[nextIndex];
        if (!nextVideoId) return;
        advanced = universityVideoBeamStore.advanceAutomaticDefaultTvQueue(
          roomId,
          nextVideoId,
          tv.currentVideoId,
          tv.startedAtMs,
          tv.breakEndsAtMs,
          tv.breakEndsAtMs,
        );
      }
    }
    if (advanced.tv.startedAtMs !== tv.startedAtMs
      && advanced.tv.currentVideoId) {
      await recordCommunityVideoPlayed(roomId, advanced.tv.currentVideoId);
      const roomName = universityVideoBeamStore.getRoomName(roomId);
      if (comedyContinuous) await persistComedyScheduleBestEffort(advanced.tv);
      else await persistCommunityPlaybackScheduleBestEffort(roomId, advanced.tv);
      scheduleBeamTvVideoStart(
        roomId,
        advanced.tv.currentVideoId,
        advanced.tv.videoMetadata.find(video => video.videoId === advanced.tv.currentVideoId),
      );
      try {
        const identities = await refreshParticipantSnapshot(roomName);
        await synchronizeSpeakerMediaPermissions(roomId, advanced, identities);
      } catch (error) {
        logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
          "Could not refresh room speaker media permissions during video change");
      }
      schedulePublicPlaybackTransition(roomId);
    }
  } catch (error) {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Could not select the next saved Beam TV video");
  }
}

function schedulePublicPlaybackTransition(roomId: string) {
  const previous = publicPlaybackTimers.get(roomId);
  if (!isPublicTopicRoom(roomId, roomStore)) {
    if (previous) clearTimeout(previous.timer);
    publicPlaybackTimers.delete(roomId);
    return;
  }
  const dueAt = universityVideoBeamStore.getNextAutomaticPlaybackTransitionAt(roomId);
  if (previous?.dueAt === dueAt) return;
  if (previous) clearTimeout(previous.timer);
  publicPlaybackTimers.delete(roomId);
  if (dueAt === null) return;

  const timer = setTimeout(() => {
    const current = publicPlaybackTimers.get(roomId);
    if (current?.dueAt !== dueAt) return;
    publicPlaybackTimers.delete(roomId);
    if (!isPublicTopicRoom(roomId, roomStore)) return;
    const state = universityVideoBeamStore.getState(roomId);
    void (async () => {
      if (communityLiveStreamPolicy(roomId, roomStore)) {
        await refreshNewsQueueAtTransition(roomId, state, dueAt);
      } else {
        await refreshTopicQueueAtTransition(roomId, state);
      }
      const nextDueAt = universityVideoBeamStore.getNextAutomaticPlaybackTransitionAt(roomId);
      if (nextDueAt !== null && nextDueAt > Date.now()) schedulePublicPlaybackTransition(roomId);
    })().catch(error => {
      logger.warn({
        roomId,
        error: error instanceof Error ? error.message : "unknown",
      }, "Room video transition will be retried without requiring a viewer");
      if (!isPublicTopicRoom(roomId, roomStore)) return;
      const retryDueAt = Date.now() + 30_000;
      const retryTimer = setTimeout(() => {
        const retry = publicPlaybackTimers.get(roomId);
        if (retry?.dueAt !== retryDueAt) return;
        publicPlaybackTimers.delete(roomId);
        schedulePublicPlaybackTransition(roomId);
      }, 30_000);
      publicPlaybackTimers.set(roomId, { dueAt: retryDueAt, timer: retryTimer });
    });
  }, Math.max(0, dueAt - Date.now()));
  publicPlaybackTimers.set(roomId, { dueAt, timer });
}

async function refreshParticipantSnapshot(roomName: string) {
  const participants = await liveKitBeamService.listParticipants(roomName);
  const identities = new Set(participants.map(participant => participant.identity));
  participantSnapshots.set(roomName, {
    expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS,
    identities,
  });
  return identities;
}

function sourcesForSlot(
  slot: UniversityVideoBeamState["slots"][number],
  micOverride?: boolean,
): { sources: TrackSource[]; microphoneEnabled: boolean } {
  const microphoneEnabled = micOverride ?? (!slot.micMuted && !slot.mutedByHost);
  return {
    sources: microphoneEnabled ? [TrackSource.MICROPHONE] : [],
    microphoneEnabled,
  };
}

async function synchronizeSpeakerMediaPermissions(
  roomId: string,
  state: UniversityVideoBeamState,
  liveIdentities: ReadonlySet<string>,
  viewerAccountId?: string,
): Promise<UniversityVideoBeamState> {
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let policies = appliedSpeakerPolicies.get(roomName);
  if (!policies) {
    policies = new Map();
    appliedSpeakerPolicies.set(roomName, policies);
  }
  const occupied = new Set(state.slots.flatMap(slot => slot.participantId ? [slot.participantId] : []));
  for (const participantId of policies.keys()) {
    if (!occupied.has(participantId)) policies.delete(participantId);
  }

  for (const slot of state.slots) {
    const participantId = slot.participantId;
    if (!participantId || !liveIdentities.has(participantId)) continue;
    let currentState = state;
    if (!slot.micMuted && !slot.mutedByHost) {
      const accountId = universityVideoBeamStore.accountIdForParticipant(roomId, participantId);
      if (accountId && isLiveStreamStarting(accountId)) {
        currentState = universityVideoBeamStore.setSelfMedia(roomId, participantId, "mic", false);
      }
    }
    const currentSlot = currentState.slots.find(candidate => candidate.participantId === participantId) ?? slot;
    const policy = sourcesForSlot(currentSlot);
    const signature = `${policy.microphoneEnabled}:${policy.sources.join(",")}`;
    if (policies.get(participantId) === signature) continue;
    try {
      await liveKitBeamService.applySpeakerMediaPolicy(
        roomName, participantId, policy.sources, policy.microphoneEnabled,
      );
      policies.set(participantId, signature);
    } catch (failure) {
      throw publicLiveKitFailure(failure);
    }
  }
  return universityVideoBeamStore.getState(roomId, viewerAccountId);
}

router.get("/account/rooms/:roomId/video-beam", async (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  const state = await reconcileState(req.params.roomId, id);
  res.set("Cache-Control", "no-store");
  res.json(GetUniversityVideoBeamStateResponse.parse(state));
});

router.post("/account/rooms/:roomId/video-beam/token", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = GetUniversityVideoBeamTokenBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key => key !== "role")) {
    throw new RoomError(400, "Choose a valid beam role.");
  }
  const profile = await requireCompletedProfile(id);
  const roomName = universityVideoBeamStore.getRoomName(req.params.roomId);
  let slotNumber: number | null = null;

  if (input.data.role === "speaker") {
    if (await isLiveStreamActiveOrStarting(id)) {
      throw new RoomError(409, "End your Go Live stream before joining an audio beam seat.");
    }
    universityVideoBeamStore.assertCanJoin(req.params.roomId, id);
    const reserved = universityVideoBeamStore.joinSlot(
      req.params.roomId, participant.participantId, id,
    );
    slotNumber = reserved.slots.find(slot => slot.participantId === participant.participantId)?.slotNumber ?? null;
  } else {
    const state = await reconcileState(req.params.roomId);
    if (!state.beamActive) throw new RoomError(409, "A speaker needs to start the beam before audience members can join.");
    if (state.slots.some(slot => slot.participantId === participant.participantId)) {
      throw new RoomError(409, "Use your speaker connection to rejoin your beam spot.");
    }
  }

  try {
    const ownSlot = input.data.role === "speaker"
      ? universityVideoBeamStore.slotFor(req.params.roomId, participant.participantId)
      : null;
    const token = await liveKitBeamService.createToken({
      roomName,
      participantId: participant.participantId,
      displayName: profile.displayName || profile.username,
      role: input.data.role,
      canSubscribe: ownSlot ? !ownSlot.micMuted && !ownSlot.mutedByHost : false,
    });
    res.set("Cache-Control", "no-store").json(GetUniversityVideoBeamTokenResponse.parse({
      ...token,
      role: input.data.role,
      slotNumber,
    }));
  } catch (failure) {
    if (input.data.role === "speaker") {
      universityVideoBeamStore.leaveSlot(req.params.roomId, participant.participantId);
    }
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/rooms/:roomId/video-beam/actions", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = PerformUniversityVideoBeamActionBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key =>
    !["action", "enabled", "targetParticipantId", "targetSlotNumber"].includes(key))) {
    throw new RoomError(400, "Choose a valid video beam action.");
  }
  const roomId = req.params.roomId;
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let state;

  try {
    switch (input.data.action) {
      case "reserve-slot": {
        if (await isLiveStreamActiveOrStarting(id)) {
          throw new RoomError(409, "End your Go Live stream before joining an audio beam seat.");
        }
        state = universityVideoBeamStore.joinSlot(
          roomId, participant.participantId, id,
        );
        break;
      }
      case "speaker-connected": {
        const connected = await refreshParticipantSnapshot(roomName);
        if (!connected.has(participant.participantId)) {
          throw new RoomError(409, "The LiveKit connection is not ready yet. Try joining again.");
        }
        state = universityVideoBeamStore.markConnected(roomId, participant.participantId);
        break;
      }
      case "leave-slot": {
        const liveParticipants = await liveKitBeamService.listParticipants(roomName);
        if (liveParticipants.some(item => item.identity === participant.participantId)) {
          await liveKitBeamService.removeParticipant(roomName, participant.participantId);
        }
        await refreshParticipantSnapshot(roomName);
        state = universityVideoBeamStore.leaveSlot(roomId, participant.participantId);
        break;
      }
      case "move-slot": {
        if (!Number.isInteger(input.data.targetSlotNumber)) {
          throw new RoomError(400, "Choose one of the eight speaker spots.");
        }
        state = universityVideoBeamStore.moveSlot(
          roomId, participant.participantId, id, input.data.targetSlotNumber!,
        );
        break;
      }
      case "set-self-mic": {
        if (typeof input.data.enabled !== "boolean") throw new RoomError(400, "Choose whether the device is on or off.");
        const media = "mic";
        if (input.data.enabled && (await isLiveStreamActiveOrStarting(id) || isLiveStreamStarting(id))) {
          throw new RoomError(409, "End your Go Live stream before turning on your room microphone.");
        }
        universityVideoBeamStore.assertSelfMedia(roomId, participant.participantId, media, input.data.enabled);
        const slot = universityVideoBeamStore.slotFor(roomId, participant.participantId);
        const current = universityVideoBeamStore.getState(roomId);
        const policy = sourcesForSlot(slot, input.data.enabled);
        await liveKitBeamService.setSelfTrackEnabled(
          roomName, participant.participantId, media, input.data.enabled, policy.sources,
        );
        state = universityVideoBeamStore.setSelfMedia(
          roomId, participant.participantId, media, input.data.enabled,
        );
        break;
      }
      case "host-mute-mic": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        const target = input.data.targetParticipantId;
        const media = "mic";
        const slot = universityVideoBeamStore.assertHostControl(roomId, participant.participantId, target);
        const current = universityVideoBeamStore.getState(roomId);
        const policy = sourcesForSlot(slot, false);
        await liveKitBeamService.disableTrack(roomName, target, media, policy.sources);
        state = universityVideoBeamStore.hostDisableMedia(
          roomId, participant.participantId, target, media,
        );
        break;
      }
      case "kick": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        const target = input.data.targetParticipantId;
        universityVideoBeamStore.assertHostControl(roomId, participant.participantId, target);
        await liveKitBeamService.removeParticipant(roomName, target);
        await refreshParticipantSnapshot(roomName);
        const result = universityVideoBeamStore.kick(roomId, participant.participantId, target);
        roomStore.leaveParticipant(roomId, target);
        state = result.state;
        break;
      }
    }
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }

  const identities = await refreshParticipantSnapshot(roomName);
  state = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  res.set("Cache-Control", "no-store").json(PerformUniversityVideoBeamActionResponse.parse(state));
});

router.get("/account/rooms/:roomId/video-beam/tv", async (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  const state = await reconcileState(req.params.roomId, id);
  res.set("Cache-Control", "no-store")
    .json(GetUniversityVideoBeamTvStateResponse.parse(state.tv));
});

router.get("/account/rooms/:roomId/video-beam/tv/comedy/catalog", async (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  if ((roomStore.communityParentId(req.params.roomId)?.toUpperCase() ?? req.params.roomId.toUpperCase()) !== "COMEDY") {
    throw new RoomError(404, "That video list is not available in this room.");
  }
  const pool = await getCommunityVideoPool(
    "COMEDY",
    process.env.YOUTUBE_API_KEY?.trim() ?? "",
    roomStore,
  );
  const state = (await reconcileState(req.params.roomId, id)).tv;
  res.set("Cache-Control", "no-store").json(GetComedyRoomVideoCatalogResponse.parse({
    videos: pool.map(video => ({
      videoId: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle,
      source: video.sourceTag ?? "playlist",
      durationMs: video.durationMs,
    })),
    currentVideoId: state.currentVideoId,
  }));
});

router.post("/account/rooms/:roomId/video-beam/tv/playback-failed", async (req, res): Promise<void> => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const body = req.body as { videoId?: unknown; errorCode?: unknown } | null;
  if (!body || typeof body.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(body.videoId)
    || ![2, 5, 100, 101, 150].includes(Number(body.errorCode))) {
    throw new RoomError(400, "The player error could not be checked.");
  }

  const roomId = req.params.roomId;
  if (!isPublicTopicRoom(roomId, roomStore)) {
    throw new RoomError(403, "Automatic Beam TV recovery is only available in public topic rooms.");
  }
  const before = (await reconcileState(roomId, id)).tv;
  if (before.currentVideoId !== body.videoId) {
    res.set("Cache-Control", "no-store").json(PerformUniversityVideoBeamTvActionResponse.parse(before));
    return;
  }

  await markCommunityVideoBad(roomId, body.videoId);
  const selection = await getNextCommunityVideoSelection(
    roomId, process.env.YOUTUBE_API_KEY?.trim() ?? "", roomStore,
  );
  const state = universityVideoBeamStore.advanceAutomaticVideoAfterPlayerFailure(
    roomId,
    selection.queue,
    selection.durationMsByVideoId,
    body.videoId,
    selection.selected?.videoId ?? null,
  );
  if (state.tv.currentVideoId) {
    await recordCommunityVideoPlayed(roomId, state.tv.currentVideoId);
    if (isComedyRoom(roomId)) await persistComedyScheduleBestEffort(state.tv);
    else await persistCommunityPlaybackScheduleBestEffort(roomId, state.tv);
    scheduleBeamTvVideoStart(
      roomId,
      state.tv.currentVideoId,
      state.tv.videoMetadata.find(video => video.videoId === state.tv.currentVideoId),
    );
  }
  let synchronized = state;
  try {
    const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
    synchronized = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  } catch (error) {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Could not refresh speaker media permissions after a failed video");
  }
  schedulePublicPlaybackTransition(roomId);
  req.log.warn({
    roomId,
    videoId: body.videoId,
    errorCode: Number(body.errorCode),
    nextVideoId: synchronized.tv.currentVideoId,
  }, "Beam TV skipped a video that failed in the official YouTube player");
  res.set("Cache-Control", "no-store")
    .json(PerformUniversityVideoBeamTvActionResponse.parse(synchronized.tv));
});

router.post("/account/rooms/:roomId/video-beam/tv", async (req, res): Promise<void> => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const roomId = req.params.roomId;
  if (isComedyRoom(roomId)) {
    throw new RoomError(403, "Comedy videos play automatically; manual video controls are unavailable.");
  }
  const input = PerformUniversityVideoBeamTvActionBody.safeParse(req.body);
  const allowed = [
    "action", "sourceType", "sourceValue", "playlistId", "queue", "currentVideoId",
    "startedAtMs", "skipVotingEnabled", "videoMetadata",
  ];
  if (!input.success || Object.keys(req.body ?? {}).some(key => !allowed.includes(key))) {
    throw new RoomError(400, "Choose a valid Beam TV action.");
  }
  const before = (await reconcileState(roomId, id)).tv;
  const state = universityVideoBeamStore.actOnTv(roomId, participant.participantId, input.data, id);
  const videoChanged = state.tv.currentVideoId !== before.currentVideoId;
  const restarted = input.data.action === "start" || input.data.action === "enable";
  if (state.tv.currentVideoId && (videoChanged || restarted)) {
    const metadata = input.data.videoMetadata
      ?? state.tv.videoMetadata.find(item => item.videoId === state.tv.currentVideoId);
    scheduleBeamTvVideoStart(roomId, state.tv.currentVideoId, metadata, restarted);
  }
  if (isServerScheduledPoolRoom(roomId) && state.tv.currentVideoId) {
    await persistCommunityPlaybackScheduleBestEffort(roomId, state.tv);
  }
  if (input.data.action === "publish-playback" && input.data.videoMetadata) {
    updateBeamTvVideoMetadata(roomId, input.data.videoMetadata);
  }
  const skipWasAccepted = input.data.action === "vote-skip"
    && (state.tv.currentVideoId !== before.currentVideoId || state.tv.skipSequence !== before.skipSequence);
  if (skipWasAccepted) {
    void postBeamTvVoteAnnouncement(roomId).catch(error => {
      req.log.error({ err: error, roomId }, "Could not post Beam TV vote announcement");
    });
  }
  const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
  const synchronized = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  schedulePublicPlaybackTransition(roomId);
  res.set("Cache-Control", "no-store")
    .json(PerformUniversityVideoBeamTvActionResponse.parse(synchronized.tv));
});

router.post("/account/rooms/:roomId/video-beam/tv/search", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = SearchYouTubeForVideoBeamBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key => key !== "query")) {
    throw new RoomError(400, "Enter a YouTube search topic.");
  }
  const query = input.data.query.trim().replace(/\s+/g, " ");
  if (!query) throw new RoomError(400, "Enter a YouTube search topic.");
  const roomId = req.params.roomId;
  const tv = (await reconcileState(roomId, id)).tv;
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const dailyWebSeriesRoom = isCommunityDailyWebSeriesRoom(roomId, roomStore);
  const autoDefaultSearch = tv.enabled && tv.sourceType === "search"
    && (dailyWebSeriesRoom || (tv.queue.length === 0 && tv.currentVideoId === null))
    && normalizeSearchQuery(tv.sourceValue ?? "") === normalizeSearchQuery(defaultSearch)
    && normalizeSearchQuery(query) === normalizeSearchQuery(defaultSearch);
  if (!autoDefaultSearch) universityVideoBeamStore.assertTvHost(roomId, participant.participantId);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() ?? "";
  if (!apiKey && !autoDefaultSearch) {
    throw new RoomError(503, "YouTube search is temporarily unavailable. A room-matched video will appear when it is available.");
  }
  if (autoDefaultSearch && dailyWebSeriesRoom) {
    const selection = await getOrChooseWebSeries(apiKey);
    if (!selection) {
      throw new RoomError(503, "The Series of the Day is not available yet. Beam TV will retry automatically.");
    }
    const episodes = orderedWebSeriesEpisodes(selection);
    await activateWebSeriesForToday(roomId);
    const state = universityVideoBeamStore.getState(roomId);
    if (!state.tv.currentVideoId) {
      throw new RoomError(503, "The Series of the Day is not available yet. Beam TV will retry automatically.");
    }
    const firstTen = episodes.slice(0, 10);
    res.set("Cache-Control", "no-store").json(SearchYouTubeForVideoBeamResponse.parse({
      videoIds: firstTen.map(episode => episode.videoId),
      titles: firstTen.map(episode => episode.title),
      videos: firstTen.map(episode => ({
        videoId: episode.videoId,
        title: episode.title,
        channelTitle: episode.channelTitle,
        description: episode.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      })),
    }));
    return;
  }
  const result = autoDefaultSearch
    ? await searchDefaultCommunityVideos(roomId, apiKey)
    : await searchYouTube(query, apiKey);
  if (autoDefaultSearch) {
    const before = universityVideoBeamStore.getState(roomId).tv.currentVideoId;
    if (result.videos.length > 0) {
      const state = universityVideoBeamStore.initializeDefaultTvQueue(
        roomId, query, result.videos, result.durationMsByVideoId,
      );
      if (result.selectedVideoId && state.tv.currentVideoId === result.selectedVideoId) {
        await recordCommunityVideoPlayed(roomId, result.selectedVideoId);
      }
      if (isComedyRoom(roomId)) await persistComedyScheduleBestEffort(state.tv);
      else await persistCommunityPlaybackScheduleBestEffort(roomId, state.tv);
      const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
      await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
      schedulePublicPlaybackTransition(roomId);
      if (state.tv.currentVideoId && state.tv.currentVideoId !== before) {
        scheduleBeamTvVideoStart(roomId, state.tv.currentVideoId,
          result.videos.find(video => video.videoId === state.tv.currentVideoId));
      }
    }
  }
  const {
    durationMsByVideoId: _durations,
    selectedVideoId: _selectedVideoId,
    ...publicResult
  } = result;
  const safePublicResult = {
    ...publicResult,
    videos: publicResult.videos.map(video => ({
      ...video,
      description: video.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
    })),
  };
  res.set("Cache-Control", "no-store")
    .json(SearchYouTubeForVideoBeamResponse.parse(safePublicResult));
});

export default router;
