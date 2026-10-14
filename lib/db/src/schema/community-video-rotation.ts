import { date, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export type CommunityVideoPoolItem = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  description: string | null;
  durationMs: number;
  discoveredAtMs: number;
  tags?: string[];
  categoryId?: string | null;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  thumbnailAspectRatios?: number[];
  embeddable?: boolean;
  availableInUS?: boolean;
  ageRestricted?: boolean;
};

export type CommunityWebSeriesEpisode = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  description: string | null;
  durationMs: number;
  publishedAtMs: number | null;
  episodeNumber: number;
  tags?: string[];
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  thumbnailAspectRatios?: number[];
  embeddable?: boolean;
  availableInUS?: boolean;
  ageRestricted?: boolean;
  safetyFilterVersion?: string;
};

export const communityVideoPools = pgTable("community_video_pools", {
  roomId: text("room_id").primaryKey(),
  videos: jsonb("videos").$type<CommunityVideoPoolItem[]>().notNull().default([]),
  termIndex: integer("term_index").notNull().default(0),
  pageTokens: jsonb("page_tokens").$type<Record<string, string>>().notNull().default({}),
  sourceCursors: jsonb("source_cursors").$type<Record<string, string>>().notNull().default({}),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communityVideoPlayHistory = pgTable("community_video_play_history", {
  roomId: text("room_id").notNull(),
  videoId: text("video_id").notNull(),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }).notNull(),
  playCount: integer("play_count").notNull().default(1),
}, table => [primaryKey({ columns: [table.roomId, table.videoId] })]);

export const youtubeApiDailyQuota = pgTable("youtube_api_daily_quota", {
  utcDate: date("utc_date", { mode: "string" }).primaryKey(),
  units: integer("units").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const youtubeApiRoomDailyQuota = pgTable("youtube_api_room_daily_quota", {
  utcDate: date("utc_date", { mode: "string" }).notNull(),
  roomId: text("room_id").notNull(),
  units: integer("units").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.utcDate, table.roomId] })]);

export const communityWebSeriesDaily = pgTable("community_web_series_daily", {
  roomId: text("room_id").notNull(),
  easternDate: date("eastern_date", { mode: "string" }).notNull(),
  playlistId: text("playlist_id"),
  seriesTitle: text("series_title"),
  episodes: jsonb("episodes").$type<CommunityWebSeriesEpisode[]>().notNull().default([]),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  selectedAt: timestamp("selected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.roomId, table.easternDate] })]);
