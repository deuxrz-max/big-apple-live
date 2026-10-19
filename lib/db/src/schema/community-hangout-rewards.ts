import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

export const communityHangoutSettings = pgTable("community_hangout_settings", {
  id: integer("id").primaryKey().default(1),
  averageDropIntervalMinutes: integer("average_drop_interval_minutes").notNull().default(60),
  nextDropAt: timestamp("next_drop_at", { withTimezone: true }).notNull().defaultNow(),
  lastDropAt: timestamp("last_drop_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("community_hangout_settings_singleton", sql`${table.id} = 1`),
  check("community_hangout_settings_interval", sql`${table.averageDropIntervalMinutes} BETWEEN 15 AND 360`),
]);
export const insertCommunityHangoutSettingsSchema = createInsertSchema(communityHangoutSettings);
export type CommunityHangoutSettingsRow = typeof communityHangoutSettings.$inferSelect;

export const communitySeatSessions = pgTable("community_seat_sessions", {
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  roomId: text("room_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  seatedSince: timestamp("seated_since", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ name: "community_seat_sessions_pk", columns: [table.accountId, table.roomId] }),
]);
export const insertCommunitySeatSessionSchema = createInsertSchema(communitySeatSessions);
export type CommunitySeatSessionRow = typeof communitySeatSessions.$inferSelect;

export const communityCoinDrops = pgTable("community_coin_drops", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: text("room_id").notNull(),
  amount: integer("amount").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("community_coin_drop_amount", sql`${table.amount} BETWEEN 1 AND 100`),
]);
export const insertCommunityCoinDropSchema = createInsertSchema(communityCoinDrops);
export type CommunityCoinDropRow = typeof communityCoinDrops.$inferSelect;

export const communityCoinDropClaims = pgTable("community_coin_drop_claims", {
  dropId: uuid("drop_id").notNull().references(() => communityCoinDrops.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ name: "community_coin_drop_claims_pk", columns: [table.dropId, table.accountId] }),
  check("community_coin_drop_claim_amount", sql`${table.amount} BETWEEN 1 AND 100`),
]);
export const insertCommunityCoinDropClaimSchema = createInsertSchema(communityCoinDropClaims);
export type CommunityCoinDropClaimRow = typeof communityCoinDropClaims.$inferSelect;

export const communityHangoutStreaks = pgTable("community_hangout_streaks", {
  accountId: text("account_id").primaryKey().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  lastQualifiedDay: text("last_qualified_day").notNull(),
  consecutiveDays: integer("consecutive_days").notNull().default(1),
  lastRewardDay: text("last_reward_day"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("community_hangout_streak_days", sql`${table.consecutiveDays} BETWEEN 1 AND 7`),
]);
export const insertCommunityHangoutStreakSchema = createInsertSchema(communityHangoutStreaks);
export type CommunityHangoutStreakRow = typeof communityHangoutStreaks.$inferSelect;
