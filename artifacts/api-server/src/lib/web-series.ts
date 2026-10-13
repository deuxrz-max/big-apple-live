import { and, eq, gte } from "drizzle-orm";
import {
  communityWebSeriesDaily,
  db,
  type CommunityWebSeriesEpisode,
} from "@workspace/db";
import {
  reserveYouTubeApiUnits,
} from "./room-video-rotation";
import {
  selectPlayableYouTubeVideos,
  youtubeThumbnailAspectRatios,
  YOUTUBE_VIDEO_FILTER_VERSION,
  type YouTubeVideoCandidate,
  type YouTubeVideoEligibility,
} from "./youtube-video-selection";
import { logger } from "./logger";

export const WEB_SERIES_ROOM_ID = "WEBSER";
export const WEB_SERIES_TIME_ZONE = "America/New_York";
export const WEB_SERIES_MIN_EPISODES = 3;
export const WEB_SERIES_HISTORY_DAYS = 30;
export const WEB_SERIES_DAILY_API_BUDGET = 500;
export const WEB_SERIES_RETRY_AFTER_MS = 60 * 60_000;
export const WEB_SERIES_SEARCH_TERMS = [
  "English web series full episodes official playlist",
  "web series season 1 episode 1 full episodes playlist",
  "season 1 episode 1 English web series playlist",
  "popular English web series complete episodes",
] as const;

const MAX_SERIES_PLAYLISTS_TO_INSPECT = 8;
const MAX_EPISODES_PER_SERIES = 50;
const NON_EPISODE_CONTENT = /\b(?:trailer|teaser|reaction|recap|review|behind the scenes|making of|promo|preview)\b/i;
const inFlightPicks = new Map<string, Promise<WebSeriesDailySelection | null>>();
const dailyPickCache = new Map<string, { expiresAt: number; selection: WebSeriesDailySelection | null }>();

export type WebSeriesEpisode = CommunityWebSeriesEpisode;
export type WebSeriesDailySelection = {
  roomId: string;
  easternDate: string;
  playlistId: string;
  seriesTitle: string;
  episodes: WebSeriesEpisode[];
  selectedAt: Date;
};

type PlaylistCandidate = {
  playlistId: string;
  title: string;
  channelTitle: string | null;
};

type PlaylistEpisodeCandidate = YouTubeVideoCandidate & {
  position: number;
};

type RankedSeries = WebSeriesDailySelection & {
  score: number;
};

function easternDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WEB_SERIES_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? NaN);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function easternDateKey(date = new Date()): string {
  const { year, month, day } = easternDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timezoneOffsetMinutes(date: Date): number {
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: WEB_SERIES_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(date).find(part => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneName.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  const magnitude = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? magnitude : -magnitude;
}

function easternDateAtMidnightUtc(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year!, month! - 1, day!);
  const offset = timezoneOffsetMinutes(new Date(localMidnightAsUtc));
  return localMidnightAsUtc - offset * 60_000;
}

function addCalendarDays(dateKey: string, count: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function nextEasternMidnightMs(now = new Date()): number {
  return easternDateAtMidnightUtc(addCalendarDays(easternDateKey(now), 1));
}

export function parseWebSeriesEpisodeNumber(title: string): number | null {
  const seasonEpisode = title.match(/\b(?:s(?:eason)?\s*0*(\d+)\s*[-: ]*\s*e(?:p(?:isode)?)?\s*0*(\d+)|season\s*0*(\d+)\s*[,|:–-]*\s*episode\s*0*(\d+))\b/i);
  if (seasonEpisode) {
    const season = Number(seasonEpisode[1] ?? seasonEpisode[3]);
    const episode = Number(seasonEpisode[2] ?? seasonEpisode[4]);
    if (Number.isInteger(season) && Number.isInteger(episode)) return season * 1_000 + episode;
  }
  const simpleEpisode = title.match(/\b(?:episode|ep\.?|part)\s*#?\s*0*(\d+)\b/i);
  return simpleEpisode ? Number(simpleEpisode[1]) : null;
}

export function cleanWebSeriesTitle(title: string): string {
  const leadingTitle = title.match(/^\s*(?:【([^】]+)】|\[([^\]]+)\]|\(([^)]+)\))/);
  const bracketed = leadingTitle?.[1] ?? leadingTitle?.[2] ?? leadingTitle?.[3];
  if (bracketed && !/^(?:full|complete|episode|season)\b/i.test(bracketed.trim())) {
    return bracketed.trim().replace(/\s+/g, " ").slice(0, 160);
  }
  return title
    .replace(/\s*[|–—-]\s*(?:complete|full|official)?\s*(?:season\s*\d+|full episodes?|web series|episodes?)\b.*$/i, "")
    .replace(/\b(?:complete|full)\s*(?:season\s*\d+|episodes?)\b/ig, "")
    .replace(/\b(?:official )?web series\b/ig, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s|–—-]+|[\s|–—-]+$/g, "")
    .trim();
}

function records(value: unknown): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("items" in value)
    || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function durationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1_000;
}

function parsePlaylistResults(payload: unknown): PlaylistCandidate[] {
  const seen = new Set<string>();
  return records(payload).flatMap(item => {
    const id = object(item.id);
    const snippet = object(item.snippet);
    const playlistId = text(id?.playlistId);
    const title = text(snippet?.title);
    if (!playlistId || !title || seen.has(playlistId)) return [];
    seen.add(playlistId);
    return [{ playlistId, title, channelTitle: text(snippet?.channelTitle) }];
  });
}

function parsePlaylistEpisodes(payload: unknown): PlaylistEpisodeCandidate[] {
  return records(payload).flatMap(item => {
    const snippet = object(item.snippet);
    const contentDetails = object(item.contentDetails);
    const resourceId = object(snippet?.resourceId);
    const videoId = text(contentDetails?.videoId) ?? text(resourceId?.videoId);
    const title = text(snippet?.title);
    if (!videoId || !title || title === "Deleted video" || title === "Private video") return [];
    const thumbnails = object(snippet?.thumbnails);
    return [{
      videoId,
      title: title.slice(0, 200),
      channelTitle: (text(snippet?.videoOwnerChannelTitle) ?? text(snippet?.channelTitle))?.slice(0, 120) ?? null,
      channelId: text(snippet?.videoOwnerChannelId),
      description: text(snippet?.description)?.slice(0, 500) ?? null,
      publishedAt: text(snippet?.publishedAt),
      liveBroadcastContent: "none",
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(thumbnails),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
      position: number(snippet?.position) ?? 0,
    }];
  });
}

function parseVideoEligibility(payload: unknown): {
  eligibility: YouTubeVideoEligibility[];
  viewCounts: Map<string, number>;
  publishedAtById: Map<string, number | null>;
} {
  const eligibility: YouTubeVideoEligibility[] = [];
  const viewCounts = new Map<string, number>();
  const publishedAtById = new Map<string, number | null>();
  for (const item of records(payload)) {
    const videoId = text(item.id);
    const snippet = object(item.snippet);
    const contentDetails = object(item.contentDetails);
    const contentRating = object(contentDetails?.contentRating);
    const status = object(item.status);
    const statistics = object(item.statistics);
    if (!videoId) continue;
    const publishedAt = text(snippet?.publishedAt);
    eligibility.push({
      videoId,
      durationMs: durationMs(contentDetails?.duration),
      embeddable: status?.embeddable === true,
      ytRating: text(contentRating?.ytRating),
      defaultLanguage: text(snippet?.defaultLanguage),
      defaultAudioLanguage: text(snippet?.defaultAudioLanguage),
      thumbnailAspectRatios: youtubeThumbnailAspectRatios(snippet?.thumbnails),
      description: text(snippet?.description),
      tags: Array.isArray(snippet?.tags)
        ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
    viewCounts.set(videoId, number(statistics?.viewCount) ?? 0);
    publishedAtById.set(videoId, publishedAt && Number.isFinite(Date.parse(publishedAt))
      ? Date.parse(publishedAt) : null);
  }
  return { eligibility, viewCounts, publishedAtById };
}

function scoreSeries(
  episodes: WebSeriesEpisode[],
  viewCounts: ReadonlyMap<string, number>,
  nowMs: number,
): number {
  const views = episodes.reduce((sum, episode) => sum + (viewCounts.get(episode.videoId) ?? 0), 0);
  const latestEpisode = episodes.reduce((latest, episode) =>
    Math.max(latest, episode.publishedAtMs ?? 0), 0);
  const ageDays = latestEpisode
    ? Math.max(1, (nowMs - latestEpisode) / 86_400_000) : 365;
  const viewsPerDay = views / ageDays;
  return Math.log10(views + 1) * 0.55 + Math.log10(viewsPerDay + 1) * 0.45;
}

export function buildRankedWebSeries(
  playlists: Array<{
    playlistId: string;
    title: string;
    channelTitle: string | null;
    items: PlaylistEpisodeCandidate[];
  }>,
  eligibility: YouTubeVideoEligibility[],
  viewCounts: ReadonlyMap<string, number>,
  publishedAtById: ReadonlyMap<string, number | null>,
  excludedPlaylistIds: ReadonlySet<string>,
  excludedSeriesTitles: ReadonlySet<string> = new Set(),
  nowMs = Date.now(),
): Array<RankedSeries> {
  const ranked: RankedSeries[] = [];
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  for (const playlist of playlists) {
    if (excludedPlaylistIds.has(playlist.playlistId)) continue;
    const candidates = playlist.items
      .filter(item => !NON_EPISODE_CONTENT.test(item.title)
        && !NON_EPISODE_CONTENT.test(item.description ?? "")
        && !NON_EPISODE_CONTENT.test((item.tags ?? []).join(" "))
        && !NON_EPISODE_CONTENT.test(eligibilityById.get(item.videoId)?.description ?? "")
        && !NON_EPISODE_CONTENT.test((eligibilityById.get(item.videoId)?.tags ?? []).join(" ")))
      .sort((a, b) => a.position - b.position)
      .slice(0, MAX_EPISODES_PER_SERIES);
    const selected = selectPlayableYouTubeVideos(candidates, eligibility, undefined, MAX_EPISODES_PER_SERIES);
    if (selected.videos.length < WEB_SERIES_MIN_EPISODES) continue;
    const candidateById = new Map(candidates.map(item => [item.videoId, item]));
    const parsedEpisodes = selected.videos.map(video => ({
      video,
      source: candidateById.get(video.videoId)!,
      parsedNumber: parseWebSeriesEpisodeNumber(video.title),
    }));
    const explicitNumbers = parsedEpisodes.filter(item => item.parsedNumber !== null);
    const ordered = explicitNumbers.length >= WEB_SERIES_MIN_EPISODES
      ? [...parsedEpisodes].sort((a, b) => (a.parsedNumber ?? Number.MAX_SAFE_INTEGER)
        - (b.parsedNumber ?? Number.MAX_SAFE_INTEGER) || a.source.position - b.source.position)
      : parsedEpisodes.sort((a, b) => a.source.position - b.source.position);
    const episodes = ordered.map((item, index) => ({
      videoId: item.video.videoId,
      title: item.video.title,
      channelTitle: item.video.channelTitle,
      description: item.video.description,
      durationMs: selected.durationMsByVideoId[item.video.videoId]!,
      publishedAtMs: publishedAtById.get(item.video.videoId) ?? null,
      episodeNumber: index + 1,
      tags: eligibilityById.get(item.video.videoId)?.tags ?? item.source.tags ?? [],
      defaultLanguage: eligibilityById.get(item.video.videoId)?.defaultLanguage ?? item.source.defaultLanguage ?? null,
      defaultAudioLanguage: eligibilityById.get(item.video.videoId)?.defaultAudioLanguage
        ?? item.source.defaultAudioLanguage ?? null,
      thumbnailAspectRatios: eligibilityById.get(item.video.videoId)?.thumbnailAspectRatios
        ?? item.source.thumbnailAspectRatios ?? [],
      embeddable: eligibilityById.get(item.video.videoId)?.embeddable === true,
      ageRestricted: eligibilityById.get(item.video.videoId)?.ytRating === "ytAgeRestricted",
      safetyFilterVersion: YOUTUBE_VIDEO_FILTER_VERSION,
    }));
    if (episodes.length < WEB_SERIES_MIN_EPISODES) continue;
    const seriesTitle = (cleanWebSeriesTitle(playlist.title) || playlist.title).slice(0, 160);
    if (excludedSeriesTitles.has(seriesTitle.trim().toLocaleLowerCase("en-US"))) continue;
    ranked.push({
      roomId: WEB_SERIES_ROOM_ID,
      easternDate: "",
      playlistId: playlist.playlistId,
      seriesTitle,
      episodes,
      selectedAt: new Date(nowMs),
      score: scoreSeries(episodes, viewCounts, nowMs),
    });
  }
  return ranked.sort((a, b) => b.score - a.score || a.seriesTitle.localeCompare(b.seriesTitle));
}

async function youtubeJson(
  endpoint: "search" | "playlistItems" | "videos",
  params: URLSearchParams,
  apiKey: string,
  units: number,
): Promise<unknown> {
  const reserved = await reserveYouTubeApiUnits(
    WEB_SERIES_ROOM_ID,
    units,
    WEB_SERIES_DAILY_API_BUDGET,
    9_500,
  );
  if (!reserved) throw new Error("The reserved daily YouTube lookup budget is not available.");
  params.set("key", apiKey);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) throw new Error("The YouTube series lookup did not complete.");
  return response.json().catch(() => null);
}

function selectionFromRow(row: typeof communityWebSeriesDaily.$inferSelect): WebSeriesDailySelection | null {
  if (!row.playlistId || !row.seriesTitle || row.episodes.length < WEB_SERIES_MIN_EPISODES || !row.selectedAt) return null;
  return {
    roomId: row.roomId,
    easternDate: row.easternDate,
    playlistId: row.playlistId,
    seriesTitle: cleanWebSeriesTitle(row.seriesTitle) || row.seriesTitle,
    episodes: row.episodes,
    selectedAt: row.selectedAt,
  };
}

async function rescreenSavedWebSeries(
  selection: WebSeriesDailySelection,
  apiKey: string,
): Promise<WebSeriesDailySelection | null> {
  const candidates: YouTubeVideoCandidate[] = selection.episodes.map(episode => ({
    videoId: episode.videoId,
    title: episode.title,
    channelTitle: episode.channelTitle,
    description: episode.description,
    defaultLanguage: episode.defaultLanguage,
    defaultAudioLanguage: episode.defaultAudioLanguage,
    thumbnailAspectRatios: episode.thumbnailAspectRatios,
    tags: episode.tags,
  }));
  const ids = candidates.map(candidate => candidate.videoId);
  const details = await youtubeJson("videos", new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: ids.join(","),
  }), apiKey, 1);
  const screenedDetails = parseVideoEligibility(details);
  const playable = selectPlayableYouTubeVideos(candidates, screenedDetails.eligibility, undefined, 50);
  const playableById = new Map(playable.videos.map(video => [video.videoId, video]));
  const eligibilityById = new Map(screenedDetails.eligibility.map(item => [item.videoId, item]));
  const episodes = selection.episodes.flatMap(episode => {
    const video = playableById.get(episode.videoId);
    const videoEligibility = eligibilityById.get(episode.videoId);
    if (!video || !videoEligibility || NON_EPISODE_CONTENT.test(episode.title)
      || NON_EPISODE_CONTENT.test(episode.description ?? "")
      || NON_EPISODE_CONTENT.test((videoEligibility.tags ?? []).join(" "))) return [];
    return [{
      ...episode,
      title: video.title,
      channelTitle: video.channelTitle,
      description: video.description,
      durationMs: playable.durationMsByVideoId[episode.videoId]!,
      tags: videoEligibility.tags ?? [],
      defaultLanguage: videoEligibility.defaultLanguage ?? null,
      defaultAudioLanguage: videoEligibility.defaultAudioLanguage ?? null,
      thumbnailAspectRatios: videoEligibility.thumbnailAspectRatios ?? [],
      embeddable: videoEligibility.embeddable,
      ageRestricted: videoEligibility.ytRating === "ytAgeRestricted",
      safetyFilterVersion: YOUTUBE_VIDEO_FILTER_VERSION,
    }];
  });
  const selectedAt = episodes.length >= WEB_SERIES_MIN_EPISODES ? selection.selectedAt : null;
  await db.update(communityWebSeriesDaily).set({
    episodes,
    selectedAt,
    ...(selectedAt ? {} : { lastAttemptAt: new Date() }),
    updatedAt: new Date(),
  }).where(and(
    eq(communityWebSeriesDaily.roomId, selection.roomId),
    eq(communityWebSeriesDaily.easternDate, selection.easternDate),
  ));
  const removed = selection.episodes.length - episodes.length;
  logger.info({
    roomId: selection.roomId,
    savedEpisodesScanned: selection.episodes.length,
    savedEpisodesRemoved: removed,
    stillPlayable: episodes.length,
  }, "Rescreened the saved Series of the Day before playback");
  if (episodes.length < WEB_SERIES_MIN_EPISODES) return null;
  return { ...selection, episodes };
}

async function saveDailyRow(
  easternDate: string,
  row: {
    playlistId: string | null;
    seriesTitle: string | null;
    episodes: WebSeriesEpisode[];
    attemptedAt: Date;
    selectedAt: Date | null;
  },
) {
  await db.insert(communityWebSeriesDaily).values({
    roomId: WEB_SERIES_ROOM_ID,
    easternDate,
    ...row,
    updatedAt: row.attemptedAt,
  }).onConflictDoUpdate({
    target: [communityWebSeriesDaily.roomId, communityWebSeriesDaily.easternDate],
    set: {
      playlistId: row.playlistId,
      seriesTitle: row.seriesTitle,
      episodes: row.episodes,
      lastAttemptAt: row.attemptedAt,
      selectedAt: row.selectedAt,
      updatedAt: row.attemptedAt,
    },
  });
}

async function discoverAndSaveToday(
  apiKey: string,
  easternDate: string,
  nowMs: number,
): Promise<WebSeriesDailySelection | null> {
  const attemptedAt = new Date(nowMs);
  await saveDailyRow(easternDate, {
    playlistId: null,
    seriesTitle: null,
    episodes: [],
    attemptedAt,
    selectedAt: null,
  });
  try {
    const playlistMap = new Map<string, PlaylistCandidate>();
    for (const query of WEB_SERIES_SEARCH_TERMS) {
      const payload = await youtubeJson("search", new URLSearchParams({
        part: "snippet",
        q: query,
        type: "playlist",
        maxResults: "20",
        safeSearch: "strict",
        relevanceLanguage: "en",
        regionCode: "US",
        order: "relevance",
      }), apiKey, 100);
      for (const candidate of parsePlaylistResults(payload)) {
        playlistMap.set(candidate.playlistId, candidate);
      }
    }
    const playlists = [...playlistMap.values()].slice(0, MAX_SERIES_PLAYLISTS_TO_INSPECT);
    if (!playlists.length) return null;

    const playlistItems = await Promise.all(playlists.map(async playlist => {
      const payload = await youtubeJson("playlistItems", new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: playlist.playlistId,
        maxResults: String(MAX_EPISODES_PER_SERIES),
      }), apiKey, 1);
      return { ...playlist, items: parsePlaylistEpisodes(payload) };
    }));
    const uniqueVideos = new Map<string, PlaylistEpisodeCandidate>();
    for (const playlist of playlistItems) {
      for (const episode of playlist.items) uniqueVideos.set(episode.videoId, episode);
    }
    if (uniqueVideos.size < WEB_SERIES_MIN_EPISODES) return null;
    const videos = [...uniqueVideos.values()];
    const videoDetails: Record<string, unknown>[] = [];
    const ids = videos.map(video => video.videoId);
    for (let offset = 0; offset < ids.length; offset += 50) {
      const payload = await youtubeJson("videos", new URLSearchParams({
        part: "snippet,status,contentDetails,statistics",
        id: ids.slice(offset, offset + 50).join(","),
        maxResults: "50",
      }), apiKey, 1);
      videoDetails.push(...records(payload));
    }
    const parsedDetails = parseVideoEligibility({ items: videoDetails });
    const selectedHistorySince = new Date(nowMs - WEB_SERIES_HISTORY_DAYS * 86_400_000);
    const history = await db.select({
      playlistId: communityWebSeriesDaily.playlistId,
      seriesTitle: communityWebSeriesDaily.seriesTitle,
    })
      .from(communityWebSeriesDaily)
      .where(and(
        eq(communityWebSeriesDaily.roomId, WEB_SERIES_ROOM_ID),
        gte(communityWebSeriesDaily.selectedAt, selectedHistorySince),
      ));
    const excludedPlaylistIds = new Set(history.flatMap(item => item.playlistId ? [item.playlistId] : []));
    const excludedSeriesTitles = new Set(history.flatMap(item => item.seriesTitle
      ? [(cleanWebSeriesTitle(item.seriesTitle) || item.seriesTitle).trim().toLocaleLowerCase("en-US")] : []));
    const ranked = buildRankedWebSeries(
      playlistItems,
      parsedDetails.eligibility,
      parsedDetails.viewCounts,
      parsedDetails.publishedAtById,
      excludedPlaylistIds,
      excludedSeriesTitles,
      nowMs,
    );
    const chosen = ranked[0];
    if (!chosen) return null;
    const selection: WebSeriesDailySelection = {
      ...chosen,
      easternDate,
      selectedAt: attemptedAt,
    };
    await saveDailyRow(easternDate, {
      playlistId: selection.playlistId,
      seriesTitle: selection.seriesTitle,
      episodes: selection.episodes,
      attemptedAt,
      selectedAt: attemptedAt,
    });
    return selection;
  } catch (error) {
    await saveDailyRow(easternDate, {
      playlistId: null,
      seriesTitle: null,
      episodes: [],
      attemptedAt,
      selectedAt: null,
    });
    throw error;
  }
}

export async function getOrChooseWebSeries(
  apiKey: string | null,
  now = new Date(),
): Promise<WebSeriesDailySelection | null> {
  const easternDate = easternDateKey(now);
  const key = `${WEB_SERIES_ROOM_ID}:${easternDate}`;
  const cached = dailyPickCache.get(key);
  if (cached && cached.expiresAt > now.getTime()) return cached.selection;
  const [existing] = await db.select().from(communityWebSeriesDaily).where(and(
    eq(communityWebSeriesDaily.roomId, WEB_SERIES_ROOM_ID),
    eq(communityWebSeriesDaily.easternDate, easternDate),
  )).limit(1);
  if (existing) {
    let selected = selectionFromRow(existing);
    if (selected) {
      if (!selected.episodes.every(episode => episode.safetyFilterVersion === YOUTUBE_VIDEO_FILTER_VERSION)) {
        if (!apiKey) {
          dailyPickCache.set(key, { expiresAt: now.getTime() + 5 * 60_000, selection: null });
          return null;
        }
        try {
          selected = await rescreenSavedWebSeries(selected, apiKey);
        } catch (error) {
          logger.warn({
            roomId: WEB_SERIES_ROOM_ID,
            error: error instanceof Error ? error.message : "Unknown YouTube screening error",
          }, "Could not revalidate the saved Series of the Day; it will not play until it passes screening");
          dailyPickCache.set(key, { expiresAt: now.getTime() + 5 * 60_000, selection: null });
          return null;
        }
        if (!selected) {
          dailyPickCache.set(key, { expiresAt: now.getTime() + 5 * 60_000, selection: null });
          return null;
        }
      }
      dailyPickCache.set(key, { expiresAt: nextEasternMidnightMs(now), selection: selected });
      return selected;
    }
    if (now.getTime() - existing.lastAttemptAt.getTime() < WEB_SERIES_RETRY_AFTER_MS) {
      dailyPickCache.set(key, {
        expiresAt: Math.min(existing.lastAttemptAt.getTime() + WEB_SERIES_RETRY_AFTER_MS, now.getTime() + 5 * 60_000),
        selection: null,
      });
      return null;
    }
  }
  if (!apiKey) {
    dailyPickCache.set(key, { expiresAt: now.getTime() + 5 * 60_000, selection: null });
    return null;
  }
  const inFlight = inFlightPicks.get(key);
  if (inFlight) return inFlight;
  const request = discoverAndSaveToday(apiKey, easternDate, now.getTime());
  inFlightPicks.set(key, request);
  try {
    const selection = await request;
    dailyPickCache.set(key, {
      expiresAt: selection ? nextEasternMidnightMs(now) : now.getTime() + 5 * 60_000,
      selection,
    });
    return selection;
  } finally {
    if (inFlightPicks.get(key) === request) inFlightPicks.delete(key);
  }
}

export function orderedWebSeriesEpisodes(selection: WebSeriesDailySelection): WebSeriesEpisode[] {
  return [...selection.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
}
