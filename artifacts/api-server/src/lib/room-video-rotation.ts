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
  communityDefaultVideoSearch,
  communityLiveStreamPolicy,
  communityOfficialChannelSearchPolicy,
  communityVideoSearchPolicy,
  communityVideoSearchTerms,
  communityWrestlingSearchPolicy,
  type CommunityParentLookup,
  type CommunityOfficialChannelSearchPolicy,
  type CommunityWrestlingSearchPolicy,
} from "./community-config";
import {
  selectPlayableYouTubeVideos,
  youtubeVideoSafetyReasons,
  youtubeThumbnailAspectRatios,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";

const DAILY_APP_BUDGET_UNITS = 9_500;
const GENERAL_APP_BUDGET_UNITS = 9_000;
const DAILY_GENERIC_ROOM_BUDGET_UNITS = 900;
const POOL_REFRESH_MS = 6 * 60 * 60_000;
const FAILED_REFRESH_BACKOFF_MS = 10 * 60_000;
const TARGET_POOL_SIZE = 50;
const MAX_POOL_SIZE = 300;
const MAX_SEARCH_PAGES_PER_REFRESH = 3;
const MAX_UPLOAD_PAGES_PER_REFRESH = 20;
const RECENT_PLAY_WINDOW_MS = 24 * 60 * 60_000;
const HISTORY_MIN_DURATION_MS = 20 * 60_000;

type PoolRow = typeof communityVideoPools.$inferSelect;
type RoomLookup = CommunityParentLookup;
type DiscoverResult = {
  videos: CommunityVideoPoolItem[];
  termIndex?: number;
  pageTokens?: Record<string, string>;
  sourceCursors?: Record<string, string>;
};
type SelectionResult = {
  selected: CommunityVideoPoolItem | null;
  queue: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};

class QuotaUnavailableError extends Error {}

const refreshesInFlight = new Map<string, Promise<PoolRow>>();

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
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
  existing: CommunityVideoPoolItem[],
  incoming: CommunityVideoPoolItem[],
  now: number,
  roomId: string,
  rooms?: RoomLookup,
): CommunityVideoPoolItem[] {
  const byId = new Map<string, CommunityVideoPoolItem>();
  for (const item of [...existing, ...incoming]) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.videoId)) continue;
    const reasons = poolVideoReasons(item);
    if (reasons.shortsMarker || reasons.underThreeMinutes || reasons.nonEnglish
      || reasons.nonWidescreen || reasons.notEmbeddable || reasons.ageRestricted
      || !isAllowedRoomSource(roomId, item, rooms)) continue;
    byId.set(item.videoId, {
      ...item,
      channelTitle: item.channelTitle ?? null,
      description: item.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      discoveredAtMs: Number.isFinite(item.discoveredAtMs) ? item.discoveredAtMs : now,
    });
  }
  return [...byId.values()]
    .sort((a, b) => englishChannelPreference(b.channelTitle) - englishChannelPreference(a.channelTitle)
      || b.discoveredAtMs - a.discoveredAtMs)
    .slice(0, MAX_POOL_SIZE);
}

function isAllowedRoomSource(roomId: string, item: CommunityVideoPoolItem, rooms?: RoomLookup): boolean {
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

function poolVideoReasons(item: CommunityVideoPoolItem) {
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
    ytRating: item.ageRestricted ? "ytAgeRestricted" : null,
    defaultLanguage: item.defaultLanguage,
    defaultAudioLanguage: item.defaultAudioLanguage,
    thumbnailAspectRatios: item.thumbnailAspectRatios,
    description: item.description,
    tags: item.tags,
  };
  return youtubeVideoSafetyReasons(candidate, details);
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
  pool: CommunityVideoPoolItem[],
  playedAtById: ReadonlyMap<string, number>,
  nowMs = Date.now(),
  randomIndex: (max: number) => number = randomInt,
): CommunityVideoPoolItem | null {
  const cutoff = nowMs - RECENT_PLAY_WINDOW_MS;
  const fresh = pool.filter(item => (playedAtById.get(item.videoId) ?? 0) <= cutoff);
  const candidates = fresh.length ? fresh : pool;
  const likelyEnglishChannels = candidates.filter(item => englishChannelPreference(item.channelTitle) === 1);
  const preferred = likelyEnglishChannels.length ? likelyEnglishChannels : candidates;
  return preferred.length ? preferred[randomIndex(preferred.length)] ?? null : null;
}

function durationMap(videos: CommunityVideoPoolItem[]): Record<string, number> {
  return Object.fromEntries(videos.map(item => [item.videoId, item.durationMs]));
}

function mapMetadata(item: CommunityVideoPoolItem): UniversityVideoBeamTvVideoMetadata {
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
  const date = utcDate();
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
      ytRating: asText(rating?.ytRating),
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
): Promise<{ videos: CommunityVideoPoolItem[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    regionCode: "US",
    maxResults: "50",
    order: policy?.order ?? "viewCount",
    q: query,
  });
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
  const eligibilityById = new Map(readEligibility(detailPayload).map(item => [item.videoId, item]));
  const videos = eligible.videos.map(item => {
    const detail = eligibilityById.get(item.videoId);
    return {
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    description: item.description,
    durationMs: eligible.durationMsByVideoId[item.videoId] ?? 0,
    discoveredAtMs: Date.now(),
    tags: detail?.tags ?? item.tags ?? [],
    defaultLanguage: detail?.defaultLanguage ?? item.defaultLanguage ?? null,
    defaultAudioLanguage: detail?.defaultAudioLanguage ?? item.defaultAudioLanguage ?? null,
    thumbnailAspectRatios: detail?.thumbnailAspectRatios ?? item.thumbnailAspectRatios ?? [],
    embeddable: detail?.embeddable ?? true,
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
    const payload = await youtubeJson("channels", params, apiKey, roomId, 1, 525);
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

async function fetchUploadPage(
  roomId: string,
  apiKey: string,
  channel: UploadChannel,
  pageToken: string | undefined,
  isHistory: boolean,
): Promise<{ videos: CommunityVideoPoolItem[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId: channel.playlistId, maxResults: "50" });
  if (pageToken) params.set("pageToken", pageToken);
  const playlist = await youtubeJson("playlistItems", params, apiKey, roomId, 1, 525);
  const candidates: YouTubeVideoCandidate[] = objectRecords(playlist).flatMap(item => {
    const snippet = asObject(item.snippet);
    const resource = asObject(snippet?.resourceId);
    const videoId = asText(resource?.videoId);
    const title = asText(snippet?.title);
    if (!videoId || !title || title === "Deleted video" || title === "Private video") return [];
    return [{
      videoId,
      title,
      channelTitle: channel.channelTitle,
      channelId: channel.channelId,
      description: asText(snippet?.description),
      publishedAt: asText(snippet?.publishedAt),
      defaultLanguage: asText(snippet?.defaultLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
    }];
  });
  if (candidates.length === 0) return { videos: [], nextPageToken: null };
  const details = await youtubeJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: candidates.map(video => video.videoId).join(","),
  }), apiKey, roomId, 1, 525);
  const eligibility = readEligibility(details);
  const accepted = selectPlayableYouTubeVideos(candidates, eligibility, [channel.channelTitle], 50);
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  const minimumDuration = isHistory ? HISTORY_MIN_DURATION_MS : 0;
  const videos = accepted.videos
    .filter(video => (accepted.durationMsByVideoId[video.videoId] ?? 0) >= minimumDuration)
    .map(video => ({
      videoId: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle,
      description: video.description,
      durationMs: accepted.durationMsByVideoId[video.videoId] ?? 0,
      discoveredAtMs: Date.now(),
      tags: eligibilityById.get(video.videoId)?.tags ?? video.tags ?? [],
      defaultLanguage: eligibilityById.get(video.videoId)?.defaultLanguage ?? video.defaultLanguage ?? null,
      defaultAudioLanguage: eligibilityById.get(video.videoId)?.defaultAudioLanguage ?? video.defaultAudioLanguage ?? null,
      thumbnailAspectRatios: eligibilityById.get(video.videoId)?.thumbnailAspectRatios
        ?? video.thumbnailAspectRatios ?? [],
      embeddable: eligibilityById.get(video.videoId)?.embeddable ?? true,
      ageRestricted: eligibilityById.get(video.videoId)?.ytRating === "ytAgeRestricted",
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
  const rows = await db.select().from(communityVideoPools);
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
      await savePoolRow(row.roomId, row, { videos: screened.videos });
    }
  }
  return report;
}

export function screenCommunityVideoPoolItems(
  saved: CommunityVideoPoolItem[],
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
  const cursors = { ...(row.sourceCursors ?? {}) };
  let termIndex = row.termIndex;
  const pageTokens = { ...(row.pageTokens ?? {}) };
  const existing = row.videos ?? [];
  const additions: CommunityVideoPoolItem[] = [];
  const targetMet = existing.length >= TARGET_POOL_SIZE;

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
  const now = Date.now();
  const lastAttempt = row.lastAttemptAt?.getTime() ?? 0;
  if (!forceRefresh && now - lastAttempt < FAILED_REFRESH_BACKOFF_MS) return row;
  await savePoolRow(roomId, row, { lastAttemptAt: new Date(now) });
  const current = (await loadPoolRow(roomId)) ?? row;
  try {
    const found = await discoverNextBatch(roomId, apiKey, rooms, current, pageLimit);
    const merged = mergePool(current.videos ?? [], found.videos, now, roomId, rooms);
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
    console.warn({
      roomId,
      error: error instanceof Error ? error.message : "Unknown YouTube pool error",
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
): Promise<CommunityVideoPoolItem[]> {
  const row = await getOrRefreshPool(roomId.toUpperCase(), apiKey, rooms, forceRefresh, pageLimit);
  return row.videos ?? [];
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

export function roomVideoPoolRefreshIntervalMs(): number {
  return POOL_REFRESH_MS;
}

