import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type PkBattleStatus = "countdown" | "active" | "completed";
export type PkSearchStatus = "searching" | "matched" | "timed_out";

export const pkBattleSearchQueue = pgTable("pk_battle_search_queue", {
  accountId: text("account_id").primaryKey(),
  streamId: text("stream_id").notNull(),
  status: text("status").$type<PkSearchStatus>().notNull().default("searching"),
  battleId: uuid("battle_id"),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [
  check("pk_battle_search_queue_status_check", sql`${table.status} in ('searching', 'matched', 'timed_out')`),
  uniqueIndex("pk_battle_search_queue_stream_id_unique").on(table.streamId),
  index("pk_battle_search_queue_waiting_idx").on(table.status, table.expiresAt),
]);

export const pkBattles = pgTable("pk_battles", {
  id: uuid("id").primaryKey().defaultRandom(),
  streamA: text("stream_a").notNull(),
  streamB: text("stream_b").notNull(),
  accountA: text("account_a").notNull(),
  accountB: text("account_b").notNull(),
  status: text("status").$type<PkBattleStatus>().notNull().default("countdown"),
  matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  scoreA: integer("score_a").notNull().default(0),
  scoreB: integer("score_b").notNull().default(0),
  winnerAccountId: text("winner_account_id"),
  finishReason: text("finish_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  check("pk_battles_status_check", sql`${table.status} in ('countdown', 'active', 'completed')`),
  check("pk_battles_score_a_check", sql`${table.scoreA} >= 0`),
  check("pk_battles_score_b_check", sql`${table.scoreB} >= 0`),
  index("pk_battles_stream_a_status_idx").on(table.streamA, table.status),
  index("pk_battles_stream_b_status_idx").on(table.streamB, table.status),
  index("pk_battles_account_a_status_idx").on(table.accountA, table.status),
  index("pk_battles_account_b_status_idx").on(table.accountB, table.status),
  index("pk_battles_weekly_idx").on(table.status, table.completedAt),
]);

export const pkBattleGifts = pgTable("pk_battle_gifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  battleId: uuid("battle_id").notNull(),
  senderAccountId: text("sender_account_id").notNull(),
  recipientAccountId: text("recipient_account_id").notNull(),
  giftId: text("gift_id").notNull(),
  giftName: text("gift_name").notNull(),
  coins: integer("coins").notNull(),
  points: integer("points").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("pk_battle_gifts_coins_check", sql`${table.coins} >= 0`),
  check("pk_battle_gifts_points_check", sql`${table.points} >= 0`),
  index("pk_battle_gifts_battle_recipient_idx").on(table.battleId, table.recipientAccountId),
  index("pk_battle_gifts_battle_sender_idx").on(table.battleId, table.senderAccountId),
]);

export const insertPkBattleSchema = createInsertSchema(pkBattles);
export type InsertPkBattle = z.infer<typeof insertPkBattleSchema>;
export type PkBattle = typeof pkBattles.$inferSelect;
