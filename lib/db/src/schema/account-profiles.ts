import { pgTable, text, timestamp, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountProfiles = pgTable("account_profiles", {
  accountId: text("account_id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  photoUrl: text("photo_url"),
  photoUrls: text("photo_urls").array().notNull().default([]),
  nameKey: text("name_key").notNull().unique(),
  emojiId: text("emoji_id").notNull(),
  gender: text("gender", { enum: ["Male", "Female"] }).notNull(),
  color: text("color").notNull(),
  hairColor: text("hair_color").notNull(),
  portraitId: text("portrait_id"),
  currentMood: text("current_mood"),
  isTestAccount: boolean("is_test_account").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("account_profiles_four_photos", sql`cardinality(${table.photoUrls}) <= 4`),
]);
export const insertAccountProfileSchema = createInsertSchema(accountProfiles);
export type InsertAccountProfile = z.infer<typeof insertAccountProfileSchema>;
export type AccountProfileRow = typeof accountProfiles.$inferSelect;