import { pgTable, text, uuid, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { roomMessages } from "./room-messages";

// System identities only: deliberately outside Clerk, profiles and social accounts.
export const moderatorBotAccounts = pgTable("moderator_bot_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url").notNull(),
});
export const moderatorBotSettings = pgTable("moderator_bot_settings", {
  id: text("id").primaryKey(),
  bannedWords: jsonb("banned_words").$type<string[]>().notNull(),
  breakSeconds: integer("break_seconds").notNull().default(45),
});
export const moderatorBotFlags = pgTable("moderator_bot_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => roomMessages.id, { onDelete: "cascade" }),
  warningMessageId: uuid("warning_message_id").references(() => roomMessages.id, { onDelete: "set null" }),
  roomId: text("room_id").notNull(),
  accountId: text("account_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
}, t => [index("moderator_bot_flags_created").on(t.createdAt)]);
export const insertModeratorBotAccountSchema = createInsertSchema(moderatorBotAccounts);
export const insertModeratorBotSettingsSchema = createInsertSchema(moderatorBotSettings);
export const insertModeratorBotFlagSchema = createInsertSchema(moderatorBotFlags);
