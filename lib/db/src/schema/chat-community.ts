import { pgTable, text, uuid, timestamp, boolean, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { accountProfiles } from "./account-profiles";

export const chatRooms = pgTable("chat_rooms", {
  roomId: text("room_id").primaryKey(),
  historyId: uuid("history_id").notNull().unique(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atmosphere: jsonb("atmosphere").$type<{ scene: "city" | "calm" | "volcano"; since: number }>(),
});
export const chatAdmissions = pgTable("chat_admissions", {
  accountId: text("account_id").primaryKey(),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  suspended: boolean("suspended").notNull().default(false),
});
export const chatModerators = pgTable("chat_moderators", { accountId: text("account_id").primaryKey() });
export const chatMemberships = pgTable("chat_memberships", {
  historyId: uuid("history_id").notNull().references(() => chatRooms.historyId),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId),
  participantId: uuid("participant_id").notNull().defaultRandom(),
  muted: boolean("muted").notNull().default(false),
}, t => [primaryKey({ columns: [t.historyId, t.accountId] })]);
export const chatReports = pgTable("chat_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  historyId: uuid("history_id").notNull(),
  roomId: text("room_id").notNull(),
  messageId: uuid("message_id").notNull(),
  reporterId: text("reporter_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status", { enum: ["pending", "dismissed", "hidden", "muted", "restricted"] }).notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
