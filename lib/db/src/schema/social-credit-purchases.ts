import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountProfiles } from "./account-profiles";

/**
 * A confirmed external credit purchase. Only a verified payment callback may
 * create these rows; in-app credit debits and gift activity are not purchases.
 */
export const socialCreditPurchases = pgTable("social_credit_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerPurchaseId: text("provider_purchase_id").notNull(),
  credits: integer("credits").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
}, table => [
  uniqueIndex("social_credit_purchase_provider_id").on(table.provider, table.providerPurchaseId),
  index("social_credit_purchase_account_month").on(table.accountId, table.confirmedAt),
  check("social_credit_purchase_positive_credits", sql`${table.credits} > 0`),
]);

export const insertSocialCreditPurchaseSchema = createInsertSchema(socialCreditPurchases)
  .omit({ id: true });
export type InsertSocialCreditPurchase = z.infer<typeof insertSocialCreditPurchaseSchema>;
export type SocialCreditPurchase = typeof socialCreditPurchases.$inferSelect;
