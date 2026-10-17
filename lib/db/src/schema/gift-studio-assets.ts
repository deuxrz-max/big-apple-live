import { createInsertSchema } from "drizzle-zod";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

/**
 * Versioned, owner-managed gift media. Binary data stays in App Storage; this
 * table contains only metadata and fixed object names in its own namespace.
 */
export const giftStudioAssets = pgTable("gift_studio_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  giftId: text("gift_id"),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  originalName: text("original_name").notNull(),
  originalExtension: text("original_extension").notNull(),
  durationMs: integer("duration_ms").notNull(),
  originalBytes: integer("original_bytes").notNull(),
  webmBytes: integer("webm_bytes").notNull(),
  safariBytes: integer("safari_bytes").notNull(),
  settings: jsonb("settings").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("gift_studio_gift_version_unique").on(table.giftId, table.version),
  uniqueIndex("gift_studio_one_active_per_gift").on(table.giftId).where(sql`status = 'active'`),
  index("gift_studio_library_order").on(table.giftId, table.createdAt),
  check("gift_studio_gift_id_check", sql`${table.giftId} in ('good-vibes','big-love','standing-ovation','heart','spirit-pup','moonfox','cosmic-encore','fireworks','rose-shower','whip')`),
  check("gift_studio_status_check", sql`${table.status} in ('draft','active')`),
  check("gift_studio_version_positive", sql`${table.version} > 0`),
  check("gift_studio_duration_limit", sql`${table.durationMs} > 0 and ${table.durationMs} <= 15000`),
  check("gift_studio_byte_limits", sql`${table.originalBytes} between 1 and 104857600 and ${table.webmBytes} between 1 and 104857600 and ${table.safariBytes} between 1 and 104857600`),
]);

export const insertGiftStudioAssetSchema = createInsertSchema(giftStudioAssets);
export type InsertGiftStudioAsset = typeof giftStudioAssets.$inferInsert;
export type GiftStudioAsset = typeof giftStudioAssets.$inferSelect;
