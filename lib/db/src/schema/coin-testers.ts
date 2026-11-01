import { pgTable, text, boolean, jsonb, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { accountProfiles } from "./account-profiles";

export type TestBagLot = { giftId: string; quantity: number; expiresAt: string };
/** Deliberately separate from wallets, paid inventory, XP and redeemable ledgers. */
export const coinTesters = pgTable("coin_testers", {
  accountId: text("account_id").primaryKey().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  designatedBy: text("designated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  bag: jsonb("bag").$type<TestBagLot[]>().notNull().default([]),
  effectIds: jsonb("effect_ids").$type<string[]>().notNull().default([]),
});
export const insertCoinTesterSchema = createInsertSchema(coinTesters);
export type CoinTester = typeof coinTesters.$inferSelect;

export const coinTestActions = pgTable("coin_test_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(),
  refKey: text("ref_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("coin_test_actions_retry").on(t.accountId, t.requestKey)]);
export const insertCoinTestActionSchema = createInsertSchema(coinTestActions);
