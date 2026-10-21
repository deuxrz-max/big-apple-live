import {
  pgTable, text, integer, boolean, jsonb, timestamp, primaryKey, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { chatRooms } from "./chat-community";
import { accountProfiles } from "./account-profiles";

/** Owner-operated, server-only switches. Rows are inserted lazily; every switch defaults off. */
export const roomCardGameSettings = pgTable("room_card_game_settings", {
  id: text("id").primaryKey().default("global"),
  dealsEnabled: boolean("deals_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  cardDisplayEnabled: boolean("card_display_enabled").notNull().default(false),
  dailyWinningsCap: integer("daily_winnings_cap"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("room_card_game_daily_cap_nonnegative", sql`${t.dailyWinningsCap} IS NULL OR ${t.dailyWinningsCap} >= 0`)]);

/** The shuffled deck is private server state. It is never part of a public response. */
export const roomCardGameRuns = pgTable("room_card_game_runs", {
  roomId: text("room_id").notNull().references(() => chatRooms.roomId, { onDelete: "cascade" }),
  gameNumber: integer("game_number").notNull(),
  gameStartAt: timestamp("game_start_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["running", "showdown", "paid", "void"] }).notNull().default("running"),
  deck: jsonb("deck").$type<string[]>().notNull(),
  cardsDealt: integer("cards_dealt").notNull().default(0),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.roomId, t.gameNumber] }),
  check("room_card_game_number_positive", sql`${t.gameNumber} > 0`),
  check("room_card_game_deals_range", sql`${t.cardsDealt} BETWEEN 0 AND 5`),
  index("room_card_game_runs_status").on(t.status, t.gameStartAt),
]);

export const roomCardGameSeats = pgTable("room_card_game_seats", {
  roomId: text("room_id").notNull(),
  gameNumber: integer("game_number").notNull(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  seatNumber: integer("seat_number").notNull(),
  status: text("status", { enum: ["active", "out", "winner"] }).notNull().default("active"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  graceUntil: timestamp("grace_until", { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.roomId, t.gameNumber, t.accountId] }),
  uniqueIndex("room_card_game_seat_number").on(t.roomId, t.gameNumber, t.seatNumber),
  uniqueIndex("room_card_game_one_active_seat_per_account").on(t.accountId).where(sql`${t.status} = 'active'`),
  check("room_card_game_seat_number_range", sql`${t.seatNumber} BETWEEN 1 AND 10`),
]);

export const roomCardGameDeals = pgTable("room_card_game_deals", {
  roomId: text("room_id").notNull(),
  gameNumber: integer("game_number").notNull(),
  dealNumber: integer("deal_number").notNull(),
  seatNumber: integer("seat_number").notNull(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  cardCode: text("card_code").notNull(),
  dealtAt: timestamp("dealt_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.roomId, t.gameNumber, t.dealNumber, t.seatNumber] }),
  uniqueIndex("room_card_game_no_duplicate_card").on(t.roomId, t.gameNumber, t.cardCode),
  check("room_card_game_deal_number_range", sql`${t.dealNumber} BETWEEN 1 AND 5`),
  check("room_card_game_deal_seat_range", sql`${t.seatNumber} BETWEEN 1 AND 10`),
]);

/** One immutable result row is the idempotency key for the entire room/game payout. */
export const roomCardGameResults = pgTable("room_card_game_results", {
  roomId: text("room_id").notNull(),
  gameNumber: integer("game_number").notNull(),
  status: text("status", { enum: ["paid", "no_prize", "void"] }).notNull(),
  winnerAccountIds: jsonb("winner_account_ids").$type<string[]>().notNull().default([]),
  shares: jsonb("shares").$type<Array<{ accountId: string; username: string; seatNumber: number; coins: number }>>().notNull().default([]),
  announcement: text("announcement").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.roomId, t.gameNumber] })]);
