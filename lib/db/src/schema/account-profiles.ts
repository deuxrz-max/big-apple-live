import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountProfiles = pgTable("account_profiles", {
  accountId: text("account_id").primaryKey(),
  username: text("username").notNull(),
  nameKey: text("name_key").notNull().unique(),
  emojiId: text("emoji_id").notNull(),
  gender: text("gender", { enum: ["Male", "Female"] }).notNull(),
  color: text("color").notNull(),
  hairColor: text("hair_color").notNull(),
  portraitId: text("portrait_id"),
  currentMood: text("current_mood"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAccountProfileSchema = createInsertSchema(accountProfiles);
export type InsertAccountProfile = z.infer<typeof insertAccountProfileSchema>;
export type AccountProfileRow = typeof accountProfiles.$inferSelect;