import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

/** Acquisitions are separate lots so purchase expiry never affects received or rewarded gifts. */
export const socialGiftBagLots = pgTable("social_gift_bag_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  giftId: text("gift_id").notNull(),
  quantity: integer("quantity").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, t => [
  index("social_gift_bag_lots_account_gift_expiry").on(t.accountId, t.giftId, t.expiresAt),
  check("social_gift_bag_lot_quantity", sql`${t.quantity} > 0`),
  check("social_gift_bag_lot_source", sql`${t.source} IN ('purchase', 'received', 'reward', 'legacy')`),
  check("social_gift_bag_lot_expiry", sql`(${t.source} = 'purchase' AND ${t.expiresAt} IS NOT NULL) OR (${t.source} <> 'purchase' AND ${t.expiresAt} IS NULL)`),
]);
