import { pgTable, text, timestamp, boolean, integer, primaryKey, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { accountProfiles } from "./account-profiles";

export const pinkRewardPreferences = pgTable("pink_reward_preferences", {
  accountId: text("account_id").primaryKey().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  optedOut: boolean("opted_out").notNull().default(false),
});
export const pinkRewardEntries = pgTable("pink_reward_entries", {
  cycle: text("cycle").notNull(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.cycle, t.accountId] })]);
export const pinkRewardDraws = pgTable("pink_reward_draws", {
  id: text("id").primaryKey(),
  cycle: text("cycle").notNull(),
  slot: integer("slot").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  outcome: text("outcome"),
  winnerId: text("winner_id").references(() => accountProfiles.accountId, { onDelete: "set null" }),
  winnerName: text("winner_name"),
  prizeId: text("prize_id"),
  prizeName: text("prize_name"),
}, t => [
  index("pink_reward_winner_cooldown").on(t.winnerId, t.settledAt),
  check("pink_reward_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
]);
export const insertPinkRewardPreferenceSchema = createInsertSchema(pinkRewardPreferences);
export const insertPinkRewardEntrySchema = createInsertSchema(pinkRewardEntries);
export const insertPinkRewardDrawSchema = createInsertSchema(pinkRewardDraws);
