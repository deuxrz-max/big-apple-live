import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountProfiles } from "./account-profiles";

export const streamerPassportLinks = pgTable("streamer_passport_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["liveme", "tiktok", "bigo", "instagram", "facebook", "youtube", "twitch"] }).notNull(),
  handle: text("handle").notNull(),
  profileUrl: text("profile_url").notNull(),
  verificationCode: text("verification_code").notNull().unique(),
  verificationStatus: text("verification_status", { enum: ["unverified", "requested", "verified"] }).notNull().default("unverified"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
}, table => [
  uniqueIndex("streamer_passport_account_platform").on(table.accountId, table.platform),
  index("streamer_passport_review_queue").on(table.verificationStatus, table.requestedAt),
]);

export const streamerPassportAwards = pgTable("streamer_passport_awards", {
  accountId: text("account_id").primaryKey().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  awardId: text("award_id", { enum: ["founding-league"] }).notNull().default("founding-league"),
  grantedBy: text("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStreamerPassportLinkSchema = createInsertSchema(streamerPassportLinks);
export type InsertStreamerPassportLink = z.infer<typeof insertStreamerPassportLinkSchema>;
export type StreamerPassportLinkRow = typeof streamerPassportLinks.$inferSelect;
export type StreamerPassportAwardRow = typeof streamerPassportAwards.$inferSelect;
