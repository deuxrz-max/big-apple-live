import { pgTable, text, uuid, timestamp, boolean, jsonb, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

export const chatRooms = pgTable("chat_rooms", {
  roomId: text("room_id").primaryKey(),
  historyId: uuid("history_id").notNull().unique(),
  label: text("label").notNull(),
  topic: text("topic"),
  parentRoomId: text("parent_room_id"),
  overflowNumber: text("overflow_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Retained unused for data compatibility; no background system reads or writes it.
  atmosphere: jsonb("atmosphere").$type<Record<string, unknown>>(),
});
export const chatAdmissions = pgTable("chat_admissions", {
  accountId: text("account_id").primaryKey(),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  suspended: boolean("suspended").notNull().default(false),
  chatMuted: boolean("chat_muted").notNull().default(false),
  reportsMuted: boolean("reports_muted").notNull().default(false),
  moderationWarning: text("moderation_warning"),
  warningAt: timestamp("warning_at", { withTimezone: true }),
});
export const chatModerators = pgTable("chat_moderators", { accountId: text("account_id").primaryKey() });
export const universityPreferences = pgTable("university_preferences", {
  accountId: text("account_id").primaryKey().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  rulesSeenAt: timestamp("rules_seen_at", { withTimezone: true }),
});
export const universityIgnores = pgTable("university_ignores", {
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  targetId: text("target_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.accountId, t.targetId] }),
  check("university_ignores_check", sql`${t.accountId} <> ${t.targetId}`)]);
export const chatMemberships = pgTable("chat_memberships", {
  historyId: uuid("history_id").notNull().references(() => chatRooms.historyId),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId),
  participantId: uuid("participant_id").notNull().defaultRandom(),
  muted: boolean("muted").notNull().default(false),
}, t => [primaryKey({ columns: [t.historyId, t.accountId] })]);
export const chatReports = pgTable("chat_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  historyId: uuid("history_id"),
  roomId: text("room_id"),
  messageId: uuid("message_id"),
  reporterId: text("reporter_id").notNull(),
  reporterUsername: text("reporter_username").notNull().default(""),
  reportedAccountId: text("reported_account_id"),
  reportedUsername: text("reported_username").notNull().default(""),
  targetType: text("target_type", { enum: ["user", "message", "stream"] }).notNull().default("message"),
  source: text("source", { enum: ["user", "moderator_bot"] }).notNull().default("user"),
  streamId: text("stream_id"),
  messageText: text("message_text").notNull().default(""),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status", { enum: ["pending", "reviewed", "warned", "dismissed", "hidden", "muted", "restricted", "banned"] }).notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
