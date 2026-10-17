import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Owner-managed overrides for the built-in gift catalog. Unset rows continue
 * to use the catalog's source defaults, so this table can be introduced without
 * rewriting or resetting existing gifts.
 */
export const socialGiftCatalogSettings = pgTable("social_gift_catalog_settings", {
  giftId: text("gift_id").primaryKey(),
  displayName: text("display_name"),
  cost: integer("cost"),
  productType: text("product_type").notNull().default("gift"),
  status: text("status").notNull().default("active"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("social_gift_catalog_cost_positive", sql`${table.cost} is null or ${table.cost} > 0`),
  check("social_gift_catalog_product_type_check", sql`${table.productType} in ('gift','entrance-effect')`),
  check("social_gift_catalog_status_check", sql`${table.status} in ('active','inactive','deleted')`),
]);

export type SocialGiftCatalogSettings = typeof socialGiftCatalogSettings.$inferSelect;
