import { randomInt } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  communityVideoPlayHistory,
  communityVideoPools,
  db,
  type CommunityVideoPoolItem,
  youtubeApiDailyQuota,
  youtubeApiRoomDailyQuota,
} from "@workspace/db";
import type { UniversityVideoBeamTvVideoMetadata } from "@workspace/api-zod";
import {
  DIRECTORY_COMMUNITY_ROOM_IDS,
  communityDefaultVideoSearch,
  communityLiveStreamPolicy,
  communityOfficialChannelSearchPolicy,
  communityVideoSearchPolicy,
  communityVideoSearchTerms,
  communityVideoPlaylists,
  communityVideoUploadChannels,
  communityWrestlingSearchPolicy,
  type CommunityParentLookup,
  type CommunityOfficialChannelSearchPolicy,
  type CommunityVideoPlaylist,
  type CommunityVideoUploadChannel,
  type CommunityWrestlingSearchPolicy,
} from "./community-config";
import {
  selectPlayableYouTubeVideos,
  youtubeRegionAllowsCountry,
  youtubeVideoSafetyReasons,
  youtubeThumbnailAspectRatios,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";
import { isOfficialMusicVideo } from "./music-video-policy";
import { isCompleteFeatureFilm, MIN_FEATURE_FILM_DURATION_MS } from "./movies-video-policy";
import { logger } from "./logger";
import { mergeUniqueRecordsByKey } from "./developer-content-sync-policy";

const DIRECTORY_COMMUNITY_ROOM_ID_SET = new Set<string>(DIRECTORY_COMMUNITY_ROOM_IDS);

export function isDirectoryCommunityPoolRoom(roomId: string, rooms?: CommunityParentLookup): boolean {
  const normalizedId = roomId.toUpperCase();
  const parentId = rooms?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  return DIRECTORY_COMMUNITY_ROOM_ID_SET.has(parentId);
}

// Leave a separate 500-unit allowance for the daily Web Series selection and
// keep the combined tracked ceiling at 8,000 units, well below YouTube's 10k cap.
const DAILY_APP_BUDGET_UNITS = 8_000;
const GENERAL_APP_BUDGET_UNITS = 7_000;
const DAILY_GENERIC_ROOM_BUDGET_UNITS = 400;
const POOL_REFRESH_MS = 6 * 60 * 60_000;
const FAILED_REFRESH_BACKOFF_MS = 10 * 60_000;
const TARGET_POOL_SIZE = 50;
const MAX_POOL_SIZE = 300;
const COMEDY_POOL_SIZE = 3_000;
const MAX_SEARCH_PAGES_PER_REFRESH = 1;
const MAX_UPLOAD_PAGES_PER_REFRESH = 1;
const RECENT_PLAY_WINDOW_MS = 24 * 60 * 60_000;
const HISTORY_MIN_DURATION_MS = 20 * 60_000;
const COMEDY_WEEKLY_REFRESH_MS = 7 * 24 * 60 * 60_000;
const COMEDY_WEEKLY_MIN_NEW_VIDEOS = 10;
const COMEDY_PLAYBACK_SCHEDULE_KEY = "__comedyPlaybackSchedule";
const COMEDY_WEEKLY_ATTEMPT_KEY = "__comedyWeeklyRefreshAttemptAt";
const poolRefreshErrors = new Map<string, string>();

type PoolItem = CommunityVideoPoolItem & {
  availableInUS?: boolean;
  categoryId?: string | null;
};
type PoolRow = Omit<typeof communityVideoPools.$inferSelect, "videos"> & { videos: PoolItem[] };
type RoomLookup = CommunityParentLookup;
type DiscoverResult = {
  videos: PoolItem[];
  termIndex?: number;
  pageTokens?: Record<string, string>;
  sourceCursors?: Record<string, string>;
};
type SelectionResult = {
  selected: PoolItem | null;
  queue: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};
export type ComedyPlaybackSchedule = {
  currentVideoId: string;
  startedAtMs: number;
  breakEndsAtMs: number | null;
};

export function isComedyWeeklyRefreshDue(lastAttemptAtMs: number | null, nowMs = Date.now()): boolean {
  return lastAttemptAtMs === null || nowMs - lastAttemptAtMs >= COMEDY_WEEKLY_REFRESH_MS;
}

class QuotaUnavailableError extends Error {}

const refreshesInFlight = new Map<string, Promise<PoolRow>>();

export function youtubeQuotaDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function objectRecords(value: unknown): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("items" in value)
    || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseDurationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1_000;
}

function mergePool(
  existing: PoolItem[],
  incoming: PoolItem[],
  now: number,
  roomId: string,
  rooms?: RoomLookup,
): PoolItem[] {
  const normalizeSafeItems = (items: readonly PoolItem[]) => items.flatMap(item => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.videoId)) return [];
    const reasons = poolVideoReasons(item);
    if (reasons.shortsMarker || reasons.underThreeMinutes || reasons.nonEnglish
      || reasons.nonWidescreen || reasons.notEmbeddable || reasons.notAvailableInUS || reasons.ageRestricted
      || !isAllowedRoomSource(roomId, item, rooms)) return [];
    return [{
      ...item,
      channelTitle: item.channelTitle ?? null,
      description: item.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      discoveredAtMs: Number.isFinite(item.discoveredAtMs) ? item.discoveredAtMs : now,
    }];
  });
  const byId = mergeUniqueRecordsByKey(
    normalizeSafeItems(existing),
    normalizeSafeItems(incoming),
    item => item.videoId,
  );
  return byId
    .sort((a, b) => englishChannelPreference(b.channelTitle) - englishChannelPreference(a.channelTitle)
      || b.discoveredAtMs - a.discoveredAtMs)
    .slice(0, roomId.toUpperCase() === "COMEDY" ? COMEDY_POOL_SIZE : MAX_POOL_SIZE);
}

function isAllowedRoomSource(roomId: string, item: PoolItem, rooms?: RoomLookup): boolean {
  const parentRoomId = rooms?.communityParentId(roomId.toUpperCase())?.toUpperCase() ?? roomId.toUpperCase();
  if (parentRoomId === "COMEDY") {
    return item.sourceTag === "playlist"
      || item.sourceTag === "jkdanimator"
      || item.sourceTag === "comedycentral";
  }
  if (parentRoomId === "MUSIC1" && !isOfficialMusicVideo(item)) return false;
  if (parentRoomId === "MOVIES" && !isCompleteFeatureFilm(item)) return false;
  const wrestling = communityWrestlingSearchPolicy(roomId, rooms);
  const official = communityOfficialChannelSearchPolicy(roomId, rooms);
  const configured = communityVideoSearchPolicy(roomId, rooms);
  const liveStream = communityLiveStreamPolicy(roomId, rooms);
  const trustedTitles = wrestling?.channels.map(channel => channel.channelTitle)
    ?? (official ? [official.channelTitle] : configured?.trustedChannelTitles)
    ?? (liveStream ? [liveStream.channelTitle] : null);
  if (!trustedTitles?.length) return true;
  const channelTitle = (item.channelTitle ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return trustedTitles.some(title => title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === channelTitle);
}

function poolVideoReasons(item: PoolItem) {
  const candidate: YouTubeVideoCandidate = {
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    description: item.description,
    defaultLanguage: item.defaultLanguage,
    defaultAudioLanguage: item.defaultAudioLanguage,
    thumbnailAspectRatios: item.thumbnailAspectRatios,
    tags: item.tags,
  };
  const details: YouTubeVideoEligibility = {
    videoId: item.videoId,
    durationMs: item.durationMs,
    embeddable: item.embeddable === true,
    availableInUS: item.availableInUS,
    ytRating: item.ageRestricted ? "ytAgeRestricted" : null,
    defaultLanguage: item.defaultLanguage,
    defaultAudioLanguage: item.defaultAudioLanguage,
    thumbnailAspectRatios: item.thumbnailAspectRatios,
    description: item.description,
    tags: item.tags,
  };
  return youtubeVideoSafetyReasons(candidate, details);
}

function savedBadVideoIds(sourceCursors: Record<string, string> | null | undefined): Set<string> {
  return new Set((sourceCursors?.__badVideoIds ?? "").split(",").filter(Boolean));
}

async function verifySavedPoolRegionRestrictions(
  roomId: string,
  apiKey: string,
  row: PoolRow,
  rooms: RoomLookup,
): Promise<PoolRow | null> {
  const unverified = (row.videos ?? []).filter(video => video.availableInUS === undefined).slice(0, 50);
  if (!unverified.length) return null;
  const details = await youtubeJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: unverified.map(video => video.videoId).join(","),
  }), apiKey, roomId, 1);
  const eligibilityById = new Map(readEligibility(details).map(item => [item.videoId, item]));
  const videos = (row.videos ?? []).map(video => {
    if (video.availableInUS !== undefined) return video;
    return {
      ...video,
      availableInUS: eligibilityById.get(video.videoId)?.availableInUS === true,
    };
  });
  const allowed = mergePool([], videos, Date.now(), roomId, rooms);
  return savePoolRow(roomId, row, { videos: allowed });
}

function englishChannelPreference(channelTitle: string | null): number {
  const letters = Array.from(channelTitle ?? "").filter(character => /\p{L}/u.test(character));
  if (!letters.length) return 0;
  const latin = letters.filter(character => /\p{Script=Latin}/u.test(character)).length;
  return latin / letters.length >= 0.8 ? 1 : 0;
}

function shuffled<T>(values: T[]): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex]!, output[index]!];
  }
  return output;
}

function selectRandom<T>(values: T[]): T | null {
  return values.length ? values[randomInt(values.length)] ?? null : null;
}

export function chooseUnplayedVideo(
  pool: PoolItem[],
  playedAtById: ReadonlyMap<string, number>,
  nowMs = Date.now(),
  randomIndex: (max: number) => number = randomInt,
): PoolItem | null {
  const cutoff = nowMs - RECENT_PLAY_WINDOW_MS;
  const fresh = pool.filter(item => (playedAtById.get(item.videoId) ?? 0) <= cutoff);
  const candidates = fresh.length ? fresh : pool;
  const likelyEnglishChannels = candidates.filter(item => englishChannelPreference(item.channelTitle) === 1);
  const preferred = likelyEnglishChannels.length ? likelyEnglishChannels : candidates;
  return preferred.length ? preferred[randomIndex(preferred.length)] ?? null : null;
}

function durationMap(videos: PoolItem[]): Record<string, number> {
  return Object.fromEntries(videos.map(item => [item.videoId, item.durationMs]));
}

function mapMetadata(item: PoolItem): UniversityVideoBeamTvVideoMetadata {
  return {
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    description: item.description,
  };
}

export async function reserveYouTubeApiUnits(
  roomId: string,
  units: number,
  perRoomLimit = DAILY_GENERIC_ROOM_BUDGET_UNITS,
  appBudgetLimit = GENERAL_APP_BUDGET_UNITS,
): Promise<boolean> {
  if (!Number.isInteger(units) || units < 1) return false;
  const date = youtubeQuotaDateKey();
  const normalizedRoomId = roomId.toUpperCase();
  return db.transaction(async tx => {
    await tx.insert(youtubeApiDailyQuota)
      .values({ utcDate: date, units: 0 })
      .onConflictDoNothing();
    const [daily] = await tx.select().from(youtubeApiDailyQuota)
      .where(eq(youtubeApiDailyQuota.utcDate, date))
      .for("update");
    if (!daily || daily.units + units > Math.min(DAILY_APP_BUDGET_UNITS, appBudgetLimit)) return false;

    await tx.insert(youtubeApiRoomDailyQuota)
      .values({ utcDate: date, roomId: normalizedRoomId, units: 0 })
      .onConflictDoNothing();
    const [room] = await tx.select().from(youtubeApiRoomDailyQuota)
      .where(and(
        eq(youtubeApiRoomDailyQuota.utcDate, date),
        eq(youtubeApiRoomDailyQuota.roomId, normalizedRoomId),
      ))
      .for("update");
    if (!room || room.units + units > perRoomLimit) return false;

    const updatedAt = new Date();
    await tx.update(youtubeApiDailyQuota)
      .set({ units: daily.units + units, updatedAt })
      .where(eq(youtubeApiDailyQuota.utcDate, date));
    await tx.update(youtubeApiRoomDailyQuota)
      .set({ units: room.units + units, updatedAt })
      .where(and(
        eq(youtubeApiRoomDailyQuota.utcDate, date),
        eq(youtubeApiRoomDailyQuota.roomId, normalizedRoomId),
      ));
    return true;
  });
}

export async function canSpendGeneralYouTubeUnits(units = 101): Promise<boolean> {
  const date = youtubeQuotaDateKey();
  const [daily] = await db.select({ units: youtubeApiDailyQuota.units })
    .from(youtubeApiDailyQuota)
    .where(eq(youtubeApiDailyQuota.utcDate, date));
  return (daily?.units ?? 0) + units <= Math.min(DAILY_APP_BUDGET_UNITS, GENERAL_APP_BUDGET_UNITS);
}

async function youtubeJson(
  endpoint: "channels" | "playlistItems" | "search" | "videos",
  params: URLSearchParams,
  apiKey: string,
  roomId: string,
  units: number,
  roomBudget = DAILY_GENERIC_ROOM_BUDGET_UNITS,
): Promise<unknown> {
  if (!(await reserveYouTubeApiUnits(roomId, units, roomBudget))) {
    throw new QuotaUnavailableError("YouTube API budget is reserved for later refreshes.");
  }
  params.set("key", apiKey);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) throw new Error("YouTube could not refresh this room's video pool.");
  return response.json().catch(() => null);
}

function readSearchCandidates(payload: unknown): YouTubeVideoCandidate[] {
  return objectRecords(payload).flatMap(item => {
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
      publishedAt: asText(snippet?.publishedAt),
      defaultLanguage: asText(snippet?.defaultLanguage),
      defaultAudioLanguage: asText(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }];
  });
}

function readEligibility(payload: unknown): YouTubeVideoEligibility[] {
  return objectRecords(payload).flatMap(item => {
    const videoId = asText(item.id);
    const snippet = asObject(item.snippet);
    const status = asObject(item.status);
    const contentDetails = asObject(item.contentDetails);
    const rating = asObject(contentDetails?.contentRating);
    if (!videoId) return [];
    return [{
      videoId,
      durationMs: parseDurationMs(contentDetails?.duration),
      embeddable: status?.embeddable === true,
      availableInUS: youtubeRegionAllowsCountry(contentDetails?.regionRestriction),
      ytRating: asText(rating?.ytRating),
      categoryId: asText(snippet?.categoryId),
      defaultLanguage: asText(snippet?.defaultLanguage),
      defaultAudioLanguage: asText(snippet?.defaultAudioLanguage),
      description: asText(snippet?.description),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
    }];
  });
}

async function fetchSearchPage(
  roomId: string,
  apiKey: string,
  query: string,
  policy: ReturnType<typeof communityVideoSearchPolicy>,
  pageToken: string | undefined,
): Promise<{ videos: PoolItem[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    safeSearch: "none",
    relevanceLanguage: "en",
    regionCode: "US",
    maxResults: "50",
    order: policy?.order ?? "viewCount",
    q: query,
  });
  if (policy?.videoCategoryId) params.set("videoCategoryId", policy.videoCategoryId);
  if (policy?.publishedWithinDays) {
    params.set("publishedAfter", new Date(Date.now() - policy.publishedWithinDays * 86_400_000).toISOString());
  }
  if (pageToken) params.set("pageToken", pageToken);
  const search = await youtubeJson("search", params, apiKey, roomId, 100);
  const candidates = readSearchCandidates(search);
  if (candidates.length === 0) return { videos: [], nextPageToken: null };
  const detailPayload = await youtubeJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: candidates.map(video => video.videoId).join(","),
  }), apiKey, roomId, 1);
  const eligible = selectPlayableYouTubeVideos(
    candidates,
    readEligibility(detailPayload),
    policy?.trustedChannelTitles,
    50,
  );
  const details = readEligibility(detailPayload);
  const eligibilityById = new Map(details.map(item => [item.videoId, item]));
  const isMusicRoom = policy?.videoCategoryId === "10";
  const videos = eligible.videos.filter(item => {
    if (!isMusicRoom) return true;
    const detail = eligibilityById.get(item.videoId);
    return isOfficialMusicVideo({
      title: item.title,
      channelTitle: item.channelTitle,
      description: detail?.description ?? item.description,
      tags: detail?.tags ?? item.tags,
      categoryId: detail?.categoryId,
    });
  }).map(item => {
    const detail = eligibilityById.get(item.videoId);
    return {
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    description: item.description,
    durationMs: eligible.durationMsByVideoId[item.videoId] ?? 0,
    discoveredAtMs: Date.now(),
    tags: detail?.tags ?? item.tags ?? [],
    categoryId: detail?.categoryId ?? null,
    defaultLanguage: detail?.defaultLanguage ?? item.defaultLanguage ?? null,
    defaultAudioLanguage: detail?.defaultAudioLanguage ?? item.defaultAudioLanguage ?? null,
    thumbnailAspectRatios: detail?.thumbnailAspectRatios ?? item.thumbnailAspectRatios ?? [],
    embeddable: detail?.embeddable ?? true,
    availableInUS: detail?.availableInUS,
    ageRestricted: detail?.ytRating === "ytAgeRestricted",
  };
  });
  const nextPageToken = asText(asObject(search)?.nextPageToken);
  return { videos, nextPageToken };
}

type UploadChannel = { channelId: string; channelTitle: string; playlistId: string };

async function resolveUploadChannels(
  roomId: string,
  apiKey: string,
  wrestlingPolicy: CommunityWrestlingSearchPolicy | null,
  historyPolicy: CommunityOfficialChannelSearchPolicy | null,
  savedCursors: Record<string, string>,
): Promise<{ channels: UploadChannel[]; sourceCursors: Record<string, string> }> {
  const cursors = { ...savedCursors };
  const expected = wrestlingPolicy?.channels ?? [];
  const channelIds = wrestlingPolicy
    ? expected.map(channel => channel.channelId)
    : cursors.__historyChannelId ? [cursors.__historyChannelId] : [];
  const needResolution = historyPolicy && !cursors.__historyChannelId;
  if (needResolution || channelIds.some(channelId => !cursors[`uploads:${channelId}`])) {
    const params = new URLSearchParams({ part: "snippet,contentDetails" });
    if (historyPolicy && needResolution) params.set("forHandle", historyPolicy.channelHandle);
    else params.set("id", channelIds.join(","));
    const payload = await youtubeJson("channels", params, apiKey, roomId, 1, DAILY_GENERIC_ROOM_BUDGET_UNITS);
    const rows = objectRecords(payload);
    for (const row of rows) {
      const channelId = asText(row.id);
      const snippet = asObject(row.snippet);
      const contentDetails = asObject(row.contentDetails);
      const related = asObject(contentDetails?.relatedPlaylists);
      const playlistId = asText(related?.uploads);
      const title = asText(snippet?.title);
      if (!channelId || !playlistId || !title) continue;
      if (historyPolicy
        && title.trim().toLocaleLowerCase("en-US") !== historyPolicy.channelTitle.toLocaleLowerCase("en-US")) {
        continue;
      }
      if (wrestlingPolicy && !expected.some(channel =>
        channel.channelId === channelId
        && channel.channelTitle.trim().toLocaleLowerCase("en-US") === title.trim().toLocaleLowerCase("en-US"))) {
        continue;
      }
      cursors[`uploads:${channelId}`] = playlistId;
      if (historyPolicy) cursors.__historyChannelId = channelId;
    }
  }
  const channels = wrestlingPolicy
    ? expected.flatMap(channel => {
      const playlistId = cursors[`uploads:${channel.channelId}`];
      return playlistId ? [{ ...channel, playlistId }] : [];
    })
    : historyPolicy && cursors.__historyChannelId && cursors[`uploads:${cursors.__historyChannelId}`]
      ? [{
        channelId: cursors.__historyChannelId,
        channelTitle: historyPolicy.channelTitle,
        playlistId: cursors[`uploads:${cursors.__historyChannelId}`]!,
      }]
      : [];
  return { channels, sourceCursors: cursors };
}

async function resolveConfiguredUploadChannels(
  roomId: string,
  apiKey: string,
  specs: CommunityVideoUploadChannel[],
  savedCursors: Record<string, string>,
): Promise<{ channels: Array<UploadChannel & { titleTerms: readonly string[]; sourceTag?: PoolItem["sourceTag"] }>; sourceCursors: Record<string, string> }> {
  const cursors = { ...savedCursors };
  for (const [index, spec] of specs.entries()) {
    const cursorKey = `configured:${index}`;
    if (cursors[`uploads:${cursorKey}`]) continue;
    const unavailableUntil = Number(cursors[`__configuredUnavailableUntil:${index}`] ?? 0);
    if (unavailableUntil > Date.now()) continue;
    try {
      const payload = await youtubeJson("channels", new URLSearchParams({
        part: "snippet,contentDetails",
        forHandle: spec.channelHandle,
      }), apiKey, roomId, 1, DAILY_GENERIC_ROOM_BUDGET_UNITS);
      const row = objectRecords(payload).find(candidate =>
        Boolean(asText(candidate.id)) && Boolean(asText(asObject(asObject(candidate.contentDetails)?.relatedPlaylists)?.uploads)));
      const channelId = asText(row?.id);
      const channelTitle = asText(asObject(row?.snippet)?.title);
      const related = asObject(asObject(row?.contentDetails)?.relatedPlaylists);
      const playlistId = asText(related?.uploads);
      if (channelId && playlistId) {
        cursors[`__configuredChannelId:${index}`] = channelId;
        if (channelTitle) cursors[`__configuredChannelTitle:${index}`] = channelTitle;
        cursors[`uploads:${cursorKey}`] = playlistId;
      } else {
        cursors[`__configuredUnavailableUntil:${index}`] = String(Date.now() + 15 * 60_000);
      }
    } catch {
      cursors[`__configuredUnavailableUntil:${index}`] = String(Date.now() + 15 * 60_000);
      logger.warn({ roomId, sourceTag: spec.sourceTag }, "Configured Comedy channel could not be refreshed; other sources remain available");
    }
  }
  const channels = specs.flatMap((spec, index) => {
    const channelId = cursors[`__configuredChannelId:${index}`];
    const channelTitle = cursors[`__configuredChannelTitle:${index}`] ?? spec.channelTitle;
    const playlistId = cursors[`uploads:configured:${index}`];
    return channelId && playlistId
      ? [{ channelId, channelTitle, playlistId, titleTerms: spec.titleTerms, sourceTag: spec.sourceTag }]
      : [];
  });
  return { channels, sourceCursors: cursors };
}

async function fetchUploadPage(
  roomId: string,
  apiKey: string,
  channel: UploadChannel,
  pageToken: string | undefined,
  isHistory: boolean,
  titleTerms?: readonly string[],
  sourceTag?: PoolItem["sourceTag"],
  playlistSource = false,
): Promise<{ videos: PoolItem[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId: channel.playlistId, maxResults: "50" });
  if (pageToken) params.set("pageToken", pageToken);
  const playlist = await youtubeJson("playlistItems", params, apiKey, roomId, 1, DAILY_GENERIC_ROOM_BUDGET_UNITS);
  const candidates: YouTubeVideoCandidate[] = objectRecords(playlist).flatMap(item => {
    const snippet = asObject(item.snippet);
    const resource = asObject(snippet?.resourceId);
    const videoId = asText(resource?.videoId);
    const title = asText(snippet?.title);
    if (!videoId || !title || title === "Deleted video" || title === "Private video") return [];
    return [{
      videoId,
      title,
      channelTitle: playlistSource ? asText(snippet?.videoOwnerChannelTitle) ?? channel.channelTitle : channel.channelTitle,
      channelId: playlistSource ? asText(snippet?.videoOwnerChannelId) ?? channel.channelId : channel.channelId,
      description: asText(snippet?.description),
      publishedAt: asText(snippet?.publishedAt),
      defaultLanguage: asText(snippet?.defaultLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
    }];
  });
  const topicCandidates = titleTerms?.length
    ? candidates.filter(candidate => titleTerms.some(term =>
      `${candidate.title} ${candidate.description ?? ""}`.toLocaleLowerCase("en-US").includes(term.toLocaleLowerCase("en-US"))))
    : candidates;
  if (topicCandidates.length === 0) {
    return { videos: [], nextPageToken: asText(asObject(playlist)?.nextPageToken) };
  }
  const details = await youtubeJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: topicCandidates.map(video => video.videoId).join(","),
  }), apiKey, roomId, 1, DAILY_GENERIC_ROOM_BUDGET_UNITS);
  const eligibility = readEligibility(details);
  const accepted = selectPlayableYouTubeVideos(
    topicCandidates,
    eligibility,
    playlistSource ? undefined : [channel.channelTitle],
    50,
  );
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  const isMovieRoom = roomId.toUpperCase() === "MOVIES";
  const minimumDuration = isMovieRoom
    ? MIN_FEATURE_FILM_DURATION_MS
    : isHistory ? HISTORY_MIN_DURATION_MS : 0;
  const videos = accepted.videos
    .filter(video => (accepted.durationMsByVideoId[video.videoId] ?? 0) >= minimumDuration)
    .filter(video => !isMovieRoom || isCompleteFeatureFilm({
      title: video.title,
      durationMs: accepted.durationMsByVideoId[video.videoId] ?? 0,
    }))
    .map(video => ({
      videoId: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle,
      description: video.description,
      durationMs: accepted.durationMsByVideoId[video.videoId] ?? 0,
      discoveredAtMs: Date.now(),
      tags: eligibilityById.get(video.videoId)?.tags ?? video.tags ?? [],
      categoryId: eligibilityById.get(video.videoId)?.categoryId ?? null,
      defaultLanguage: eligibilityById.get(video.videoId)?.defaultLanguage ?? video.defaultLanguage ?? null,
      defaultAudioLanguage: eligibilityById.get(video.videoId)?.defaultAudioLanguage ?? video.defaultAudioLanguage ?? null,
      thumbnailAspectRatios: eligibilityById.get(video.videoId)?.thumbnailAspectRatios
        ?? video.thumbnailAspectRatios ?? [],
      embeddable: eligibilityById.get(video.videoId)?.embeddable ?? true,
      availableInUS: eligibilityById.get(video.videoId)?.availableInUS,
      ageRestricted: eligibilityById.get(video.videoId)?.ytRating === "ytAgeRestricted",
      ...(sourceTag ? { sourceTag } : {}),
    }));
  return { videos, nextPageToken: asText(asObject(playlist)?.nextPageToken) };
}

async function loadPoolRow(roomId: string): Promise<PoolRow | null> {
  const [row] = await db.select().from(communityVideoPools).where(eq(communityVideoPools.roomId, roomId));
  return row ?? null;
}

async function ensurePoolRow(roomId: string): Promise<PoolRow> {
  await db.insert(communityVideoPools).values({ roomId }).onConflictDoNothing();
  const row = await loadPoolRow(roomId);
  if (!row) throw new Error("The room video pool could not be loaded.");
  return row;
}

async function savePoolRow(
  roomId: string,
  current: PoolRow,
  patch: Partial<typeof communityVideoPools.$inferInsert>,
): Promise<PoolRow> {
  await db.update(communityVideoPools)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(communityVideoPools.roomId, roomId));
  return (await loadPoolRow(roomId)) ?? { ...current, ...patch, updatedAt: new Date() };
}

export async function getComedyPlaybackSchedule(): Promise<ComedyPlaybackSchedule | null> {
  const row = await loadPoolRow("COMEDY");
  const encoded = row?.sourceCursors?.[COMEDY_PLAYBACK_SCHEDULE_KEY];
  if (!encoded) return null;
  try {
    const value = JSON.parse(encoded) as Partial<ComedyPlaybackSchedule>;
    if (typeof value.currentVideoId !== "string"
      || !/^[A-Za-z0-9_-]{11}$/.test(value.currentVideoId)
      || !Number.isSafeInteger(value.startedAtMs)
      || (value.breakEndsAtMs !== null && value.breakEndsAtMs !== undefined
        && (!Number.isSafeInteger(value.breakEndsAtMs) || value.breakEndsAtMs < 0))) {
      return null;
    }
    return {
      currentVideoId: value.currentVideoId,
      startedAtMs: value.startedAtMs!,
      breakEndsAtMs: value.breakEndsAtMs ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveComedyPlaybackSchedule(schedule: ComedyPlaybackSchedule): Promise<void> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(schedule.currentVideoId)
    || !Number.isSafeInteger(schedule.startedAtMs) || schedule.startedAtMs < 0
    || (schedule.breakEndsAtMs !== null
      && (!Number.isSafeInteger(schedule.breakEndsAtMs) || schedule.breakEndsAtMs < 0))) {
    throw new Error("Invalid Comedy playback schedule.");
  }
  const row = await ensurePoolRow("COMEDY");
  const sourceCursors = {
    ...(row.sourceCursors ?? {}),
    [COMEDY_PLAYBACK_SCHEDULE_KEY]: JSON.stringify(schedule),
  };
  await savePoolRow("COMEDY", row, { sourceCursors });
}

export async function getComedyWeeklyRefreshAttemptAtMs(): Promise<number | null> {
  const row = await loadPoolRow("COMEDY");
  const value = Number(row?.sourceCursors?.[COMEDY_WEEKLY_ATTEMPT_KEY]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Refresh all three configured Comedy sources once a week; keep the live pool if the refresh is thin. */
export async function refreshComedyVideoPoolWeekly(
  apiKey: string,
  rooms: RoomLookup,
  keepCurrentVideoId?: string | null,
  nowMs = Date.now(),
): Promise<{ swapped: boolean; count: number; newVideoCount: number }> {
  if (!apiKey.trim()) return { swapped: false, count: 0, newVideoCount: 0 };
  let original = await ensurePoolRow("COMEDY");
  const previousAttemptAtMs = Number(original.sourceCursors?.[COMEDY_WEEKLY_ATTEMPT_KEY]);
  if (!isComedyWeeklyRefreshDue(
    Number.isSafeInteger(previousAttemptAtMs) && previousAttemptAtMs > 0 ? previousAttemptAtMs : null,
    nowMs,
  )) {
    return { swapped: false, count: original.videos.length, newVideoCount: 0 };
  }

  const originalIds = new Set(original.videos.map(video => video.videoId));
  const sourceCursors = { ...(original.sourceCursors ?? {}) };
  sourceCursors[COMEDY_WEEKLY_ATTEMPT_KEY] = String(nowMs);
  // Force the three configured sources to fetch their latest pages, not their
  // backfill cursors, before deciding whether there are enough fresh videos.
  for (const key of Object.keys(sourceCursors)) {
    if (key.startsWith("__configuredLatestCheckedAt:")) delete sourceCursors[key];
  }
  original = await savePoolRow("COMEDY", original, { sourceCursors });

  for (let source = 0; source < 3; source += 1) {
    try {
      await refreshCommunityVideoPoolIncrementally("COMEDY", apiKey, rooms);
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : "unknown", source },
        "Comedy weekly source refresh failed; retaining its saved videos");
    }
  }

  const refreshed = await ensurePoolRow("COMEDY");
  const newVideos = refreshed.videos.filter(video => !originalIds.has(video.videoId));
  const minimumFreshCount = original.videos.length === 0 ? 1 : COMEDY_WEEKLY_MIN_NEW_VIDEOS;
  if (newVideos.length < minimumFreshCount) {
    await savePoolRow("COMEDY", refreshed, {
      videos: original.videos,
      sourceCursors: refreshed.sourceCursors,
    });
    return { swapped: false, count: original.videos.length, newVideoCount: newVideos.length };
  }

  const currentVideo = keepCurrentVideoId
    ? original.videos.find(video => video.videoId === keepCurrentVideoId)
    : undefined;
  const nextVideos = [
    ...newVideos.sort((left, right) => right.discoveredAtMs - left.discoveredAtMs),
    ...(currentVideo && !newVideos.some(video => video.videoId === currentVideo.videoId) ? [currentVideo] : []),
  ].slice(0, COMEDY_POOL_SIZE);
  await savePoolRow("COMEDY", refreshed, { videos: nextVideos });
  return { swapped: true, count: nextVideos.length, newVideoCount: newVideos.length };
}

export async function sanitizeAllSavedCommunityVideoPools(rooms?: RoomLookup): Promise<{
  poolsScanned: number;
  entriesScanned: number;
  entriesRemoved: number;
  nonEnglishOrUnverifiedEntries: number;
  shortsOrUnderThreeMinuteEntries: number;
  nonWidescreenEntries: number;
  untrustedSourceEntries: number;
  poolsWithSafeVideos: number;
  poolsEmptyAfterScreening: number;
  safeVideoCountsByRoom: Array<{ roomId: string; count: number }>;
}> {
  const rows = (await db.select().from(communityVideoPools)).filter(row => {
    return isDirectoryCommunityPoolRoom(row.roomId, rooms);
  });
  const report = {
    poolsScanned: rows.length,
    entriesScanned: 0,
    entriesRemoved: 0,
    nonEnglishOrUnverifiedEntries: 0,
    shortsOrUnderThreeMinuteEntries: 0,
    nonWidescreenEntries: 0,
    untrustedSourceEntries: 0,
    poolsWithSafeVideos: 0,
    poolsEmptyAfterScreening: 0,
    safeVideoCountsByRoom: [] as Array<{ roomId: string; count: number }>,
  };
  const now = Date.now();
  for (const row of rows) {
    const saved = row.videos ?? [];
    report.entriesScanned += saved.length;
    const screened = screenCommunityVideoPoolItems(saved, now, row.roomId, rooms);
    report.entriesRemoved += screened.entriesRemoved;
    report.nonEnglishOrUnverifiedEntries += screened.nonEnglishOrUnverifiedEntries;
    report.shortsOrUnderThreeMinuteEntries += screened.shortsOrUnderThreeMinuteEntries;
    report.nonWidescreenEntries += screened.nonWidescreenEntries;
    report.untrustedSourceEntries += screened.untrustedSourceEntries;
    if (screened.videos.length > 0) report.poolsWithSafeVideos += 1;
    else report.poolsEmptyAfterScreening += 1;
    report.safeVideoCountsByRoom.push({ roomId: row.roomId, count: screened.videos.length });
    if (JSON.stringify(screened.videos) !== JSON.stringify(saved)) {
      const parentRoomId = rooms?.communityParentId(row.roomId.toUpperCase())?.toUpperCase()
        ?? row.roomId.toUpperCase();
      const refreshRoomSearch = parentRoomId === "MUSIC1" || parentRoomId === "MOVIES";
      await savePoolRow(row.roomId, row, {
        videos: screened.videos,
        ...(refreshRoomSearch
          ? { termIndex: 0, pageTokens: {}, sourceCursors: {}, refreshedAt: null }
          : {}),
      });
    }
  }
  return report;
}

export function screenCommunityVideoPoolItems(
  saved: PoolItem[],
  now = Date.now(),
  roomId?: string,
  rooms?: RoomLookup,
) {
  let nonEnglishOrUnverifiedEntries = 0;
  let shortsOrUnderThreeMinuteEntries = 0;
  let nonWidescreenEntries = 0;
  let untrustedSourceEntries = 0;
  for (const item of saved) {
    const reasons = poolVideoReasons(item);
    if (reasons.nonEnglish) nonEnglishOrUnverifiedEntries += 1;
    if (reasons.shortsMarker || reasons.underThreeMinutes) shortsOrUnderThreeMinuteEntries += 1;
    if (reasons.nonWidescreen) nonWidescreenEntries += 1;
    if (roomId && !isAllowedRoomSource(roomId, item, rooms)) untrustedSourceEntries += 1;
  }
  const videos = roomId
    ? mergePool([], saved, now, roomId, rooms)
    : mergePool([], saved, now, "UNSPECIFIED", rooms);
  return {
    videos,
    entriesRemoved: saved.length - videos.length,
    nonEnglishOrUnverifiedEntries,
    shortsOrUnderThreeMinuteEntries,
    nonWidescreenEntries,
    untrustedSourceEntries,
  };
}

async function discoverNextBatch(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
  row: PoolRow,
  pageLimit = MAX_SEARCH_PAGES_PER_REFRESH,
): Promise<DiscoverResult> {
  const policy = communityVideoSearchPolicy(roomId, rooms);
  const wrestling = communityWrestlingSearchPolicy(roomId, rooms);
  const history = communityOfficialChannelSearchPolicy(roomId, rooms);
  const configuredUploads = communityVideoUploadChannels(roomId, rooms);
  const configuredPlaylists: CommunityVideoPlaylist[] = communityVideoPlaylists(roomId, rooms);
  const cursors = { ...(row.sourceCursors ?? {}) };
  let termIndex = row.termIndex;
  const pageTokens = { ...(row.pageTokens ?? {}) };
  const existing = row.videos ?? [];
  const additions: PoolItem[] = [];
  const targetMet = existing.length >= (roomId.toUpperCase() === "COMEDY" ? COMEDY_POOL_SIZE : TARGET_POOL_SIZE);

  if (configuredUploads.length || configuredPlaylists.length) {
    const resolved = await resolveConfiguredUploadChannels(roomId, apiKey, configuredUploads, cursors);
    Object.assign(cursors, resolved.sourceCursors);
    const sourceCount = resolved.channels.length + configuredPlaylists.length;
    if (sourceCount > 0) {
      const sourceIndex = Number(cursors.__configuredSourceIndex ?? "0") || 0;
      const index = sourceIndex % sourceCount;
      const nextIndex = (index + 1) % sourceCount;
      try {
        const isChannelSource = index < resolved.channels.length;
        const channel = isChannelSource ? resolved.channels[index]! : null;
        const playlist = isChannelSource ? null : configuredPlaylists[index - resolved.channels.length]!;
        const cursorKey = channel
          ? `page:${channel.channelId}`
          : `page:playlist:${playlist!.playlistId}`;
        const latestCheckKey = channel
          ? `__configuredLatestCheckedAt:${channel.channelId}`
          : `__configuredLatestCheckedAt:playlist:${playlist!.playlistId}`;
        const lastLatestCheck = Number(cursors[latestCheckKey] ?? 0);
        const refreshLatestPage = !lastLatestCheck || Date.now() - lastLatestCheck >= POOL_REFRESH_MS;
        const pageToken = refreshLatestPage ? undefined : cursors[cursorKey];
        const page = channel
          ? await fetchUploadPage(roomId, apiKey, channel, pageToken, false, channel.titleTerms, channel.sourceTag)
          : await fetchUploadPage(
            roomId,
            apiKey,
            { channelId: "", channelTitle: playlist!.sourceTitle, playlistId: playlist!.playlistId },
            pageToken,
            false,
            undefined,
            playlist!.sourceTag,
            true,
          );
        additions.push(...page.videos);
        if (refreshLatestPage) {
          cursors[latestCheckKey] = String(Date.now());
          // Preserve an older backfill cursor when rechecking page one for new uploads.
          if (!cursors[cursorKey] && page.nextPageToken) cursors[cursorKey] = page.nextPageToken;
        } else if (page.nextPageToken) {
          cursors[cursorKey] = page.nextPageToken;
        } else {
          delete cursors[cursorKey];
        }
      } catch {
        logger.warn({
          roomId,
          sourceTag: index < resolved.channels.length
            ? resolved.channels[index]?.sourceTag
            : configuredPlaylists[index - resolved.channels.length]?.sourceTag,
        }, "Configured Comedy video source could not be refreshed; skipping this source for now");
      }
      cursors.__configuredSourceIndex = String(nextIndex);
      return { videos: additions, sourceCursors: cursors };
    }
    return { videos: [], sourceCursors: cursors };
  }

  if (wrestling || history) {
    const resolved = await resolveUploadChannels(roomId, apiKey, wrestling, history, cursors);
    Object.assign(cursors, resolved.sourceCursors);
    if (resolved.channels.length === 0) return { videos: [], sourceCursors: cursors };
    let uploadIndex = Number(cursors.__uploadChannelIndex ?? "0") || 0;
    const maxPages = Math.min(
      pageLimit,
      targetMet ? resolved.channels.length : Math.min(MAX_UPLOAD_PAGES_PER_REFRESH, resolved.channels.length * 5),
    );
    for (let count = 0; count < maxPages
      && (targetMet || additions.length + existing.length < TARGET_POOL_SIZE); count += 1) {
      const channel = resolved.channels[uploadIndex % resolved.channels.length]!;
      const cursorKey = `page:${channel.channelId}`;
      const page = await fetchUploadPage(roomId, apiKey, channel, cursors[cursorKey], Boolean(history));
      additions.push(...page.videos);
      if (page.nextPageToken) cursors[cursorKey] = page.nextPageToken;
      else delete cursors[cursorKey];
      uploadIndex = (uploadIndex + 1) % resolved.channels.length;
    }
    cursors.__uploadChannelIndex = String(uploadIndex);
    return { videos: additions, sourceCursors: cursors };
  }

  const terms = communityVideoSearchTerms(roomId, rooms);
  const maxPages = targetMet ? Math.min(1, pageLimit) : pageLimit;
  for (let pageNumber = 0; pageNumber < maxPages
    && (targetMet || additions.length + existing.length < TARGET_POOL_SIZE); pageNumber += 1) {
    const index = termIndex % terms.length;
    const term = terms[index] ?? communityDefaultVideoSearch(roomId, rooms);
    const page = await fetchSearchPage(roomId, apiKey, term, policy, pageTokens[term]);
    additions.push(...page.videos);
    if (page.nextPageToken) pageTokens[term] = page.nextPageToken;
    else delete pageTokens[term];
    termIndex = (index + 1) % terms.length;
  }
  return { videos: additions, termIndex, pageTokens, sourceCursors: cursors };
}

async function refreshRoomPool(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
  row: PoolRow,
  forceRefresh = false,
  pageLimit = MAX_SEARCH_PAGES_PER_REFRESH,
): Promise<PoolRow> {
  poolRefreshErrors.delete(roomId.toUpperCase());
  const now = Date.now();
  const lastAttempt = row.lastAttemptAt?.getTime() ?? 0;
  if (!forceRefresh && now - lastAttempt < FAILED_REFRESH_BACKOFF_MS) return row;
  await savePoolRow(roomId, row, { lastAttemptAt: new Date(now) });
  let current = (await loadPoolRow(roomId)) ?? row;
  try {
    const regionChecked = await verifySavedPoolRegionRestrictions(roomId, apiKey, current, rooms);
    if (regionChecked) return regionChecked;
    const found = await discoverNextBatch(roomId, apiKey, rooms, current, pageLimit);
    const badIds = savedBadVideoIds(current.sourceCursors);
    const newSafeVideos = found.videos.filter(video => !badIds.has(video.videoId));
    const merged = mergePool(current.videos ?? [], newSafeVideos, now, roomId, rooms);
    if (found.videos.length === 0) {
      return savePoolRow(roomId, current, {
        videos: merged,
        refreshedAt: new Date(now),
        ...(found.termIndex === undefined ? {} : { termIndex: found.termIndex }),
        ...(found.pageTokens ? { pageTokens: found.pageTokens } : {}),
        ...(found.sourceCursors ? { sourceCursors: found.sourceCursors } : {}),
      });
    }
    return savePoolRow(roomId, current, {
      videos: merged,
      refreshedAt: new Date(now),
      ...(found.termIndex === undefined ? {} : { termIndex: found.termIndex }),
      ...(found.pageTokens ? { pageTokens: found.pageTokens } : {}),
      ...(found.sourceCursors ? { sourceCursors: found.sourceCursors } : {}),
    });
  } catch (error) {
    const savedPool = (await loadPoolRow(roomId)) ?? current;
    const message = error instanceof Error ? error.message : "Unknown YouTube pool error";
    poolRefreshErrors.set(roomId.toUpperCase(), message);
    logger.warn({
      roomId,
      error: message,
      savedVideoCount: savedPool.videos?.length ?? 0,
      message: "Room video pool refresh failed; serving the filtered saved pool",
    });
    return (await loadPoolRow(roomId)) ?? current;
  }
}

async function getOrRefreshPool(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
  forceRefresh = false,
  pageLimit = MAX_SEARCH_PAGES_PER_REFRESH,
): Promise<PoolRow> {
  let existing = await ensurePoolRow(roomId);
  const screenedVideos = mergePool(existing.videos ?? [], [], Date.now(), roomId, rooms);
  if (JSON.stringify(screenedVideos) !== JSON.stringify(existing.videos ?? [])) {
    existing = await savePoolRow(roomId, existing, { videos: screenedVideos });
  }
  if (!apiKey.trim()) return existing;
  const age = Date.now() - (existing.refreshedAt?.getTime() ?? 0);
  if (!forceRefresh && existing.videos.length > 0 && age < POOL_REFRESH_MS) return existing;
  const pending = refreshesInFlight.get(roomId);
  if (pending) return pending;
  const refresh = refreshRoomPool(roomId, apiKey, rooms, existing, forceRefresh, pageLimit)
    .finally(() => refreshesInFlight.delete(roomId));
  refreshesInFlight.set(roomId, refresh);
  return refresh;
}

export async function getCommunityVideoPool(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
  forceRefresh = false,
  pageLimit = MAX_SEARCH_PAGES_PER_REFRESH,
): Promise<PoolItem[]> {
  const row = await getOrRefreshPool(roomId.toUpperCase(), apiKey, rooms, forceRefresh, pageLimit);
  return (row.videos ?? []).filter(video => video.availableInUS === true);
}

export async function refreshCommunityVideoPoolIncrementally(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
): Promise<number> {
  const row = await getOrRefreshPool(roomId.toUpperCase(), apiKey, rooms, true, 1);
  return row.videos?.filter(video => video.availableInUS === true).length ?? 0;
}

export function getCommunityVideoPoolRefreshError(roomId: string): string | null {
  return poolRefreshErrors.get(roomId.toUpperCase()) ?? null;
}

export async function markCommunityVideoBad(roomId: string, videoId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return false;
  const normalizedRoomId = roomId.toUpperCase();
  const row = await ensurePoolRow(normalizedRoomId);
  const badIds = savedBadVideoIds(row.sourceCursors);
  const existed = (row.videos ?? []).some(video => video.videoId === videoId);
  badIds.add(videoId);
  const sourceCursors = {
    ...(row.sourceCursors ?? {}),
    __badVideoIds: [...badIds].slice(-500).join(","),
  };
  const videos = (row.videos ?? []).filter(video => video.videoId !== videoId);
  await savePoolRow(normalizedRoomId, row, { videos, sourceCursors });
  return existed;
}

export async function getNextCommunityVideoSelection(
  roomId: string,
  apiKey: string,
  rooms: RoomLookup,
): Promise<SelectionResult> {
  const normalizedRoomId = roomId.toUpperCase();
  const pool = await getCommunityVideoPool(normalizedRoomId, apiKey, rooms);
  if (pool.length === 0) return { selected: null, queue: [], durationMsByVideoId: {} };

  const played = await db.select().from(communityVideoPlayHistory)
    .where(eq(communityVideoPlayHistory.roomId, normalizedRoomId));
  const playedAtById = new Map(played.map(row => [row.videoId, row.lastPlayedAt.getTime()]));
  const selected = chooseUnplayedVideo(pool, playedAtById);
  if (!selected) return { selected: null, queue: [], durationMsByVideoId: {} };
  const ordered = [selected, ...shuffled(pool.filter(item => item.videoId !== selected.videoId))].slice(0, 50);
  return {
    selected,
    queue: ordered.map(mapMetadata),
    durationMsByVideoId: durationMap(ordered),
  };
}

export async function recordCommunityVideoPlayed(roomId: string, videoId: string): Promise<void> {
  const now = new Date();
  const normalizedRoomId = roomId.toUpperCase();
  await db.insert(communityVideoPlayHistory)
    .values({ roomId: normalizedRoomId, videoId, lastPlayedAt: now, playCount: 1 })
    .onConflictDoUpdate({
      target: [communityVideoPlayHistory.roomId, communityVideoPlayHistory.videoId],
      set: {
        lastPlayedAt: now,
        playCount: sql`${communityVideoPlayHistory.playCount} + 1`,
      },
    });
  await db.delete(communityVideoPlayHistory)
    .where(and(
      eq(communityVideoPlayHistory.roomId, normalizedRoomId),
      lt(communityVideoPlayHistory.lastPlayedAt, new Date(Date.now() - RECENT_PLAY_WINDOW_MS * 7)),
    ));
}

export async function getCommunityVideoPoolCounts(): Promise<Array<{ roomId: string; count: number }>> {
  const rows = await db.select({
    roomId: communityVideoPools.roomId,
    videos: communityVideoPools.videos,
  }).from(communityVideoPools);
  return rows.map(row => ({ roomId: row.roomId, count: row.videos?.length ?? 0 }));
}

export async function getCommunityVideoPoolStats(): Promise<Array<{
  roomId: string;
  count: number;
  refreshedAtMs: number | null;
}>> {
  const rows = await db.select({
    roomId: communityVideoPools.roomId,
    videos: communityVideoPools.videos,
    refreshedAt: communityVideoPools.refreshedAt,
  }).from(communityVideoPools);
  return rows.map(row => ({
    roomId: row.roomId,
    count: row.videos?.filter(video => (video as PoolItem).availableInUS === true).length ?? 0,
    refreshedAtMs: row.refreshedAt?.getTime() ?? null,
  }));
}

export function roomVideoPoolRefreshIntervalMs(): number {
  return POOL_REFRESH_MS;
}

