import { createInsertSchema } from "drizzle-zod";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

export type GiftMotionCategory = "vehicle" | "character" | "object" | "logo";

export type GiftMotionPreset = {
  version: 1;
  durationMs: 6000;
  category: GiftMotionCategory;
  entry: "left" | "right" | "top" | "bottom" | "depth";
  exit: "left" | "right" | "top" | "bottom" | "depth";
  speed: number;
  spin: [number, number, number];
  drift: number;
  bounce: number;
  cameraYaw: number;
  cameraPitch: number;
  animationIndex: number | null;
};

/** Owner-created Three.js gifts. Model bytes live in App Storage; this table stores only metadata. */
export const developerGiftMotions = pgTable("developer_gift_motions", {
  id: uuid("id").primaryKey().defaultRandom(),
  giftId: text("gift_id").notNull(),
  ownerId: text("owner_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cost: integer("cost").notNull(),
  originalFilename: text("original_filename").notNull(),
  format: text("format").$type<"glb" | "gltf">().notNull(),
  objectPath: text("object_path").notNull().unique(),
  byteSize: integer("byte_size").notNull(),
  category: text("category").$type<GiftMotionCategory>().notNull(),
  animationNames: jsonb("animation_names").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  motion: jsonb("motion").$type<GiftMotionPreset>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("developer_gift_motions_gift_id_unique").on(table.giftId),
  index("developer_gift_motions_active_order").on(table.active, table.createdAt),
  check("developer_gift_motion_id_format", sql`${table.giftId} ~ '^motion-[0-9a-f-]{36}$'`),
  check("developer_gift_motion_cost_positive", sql`${table.cost} > 0`),
  check("developer_gift_motion_format", sql`${table.format} in ('glb','gltf')`),
  check("developer_gift_motion_category", sql`${table.category} in ('vehicle','character','object','logo')`),
  check("developer_gift_motion_size", sql`${table.byteSize} between 1 and 104857600`),
]);

export const insertDeveloperGiftMotionSchema = createInsertSchema(developerGiftMotions);
export type InsertDeveloperGiftMotion = typeof developerGiftMotions.$inferInsert;
export type DeveloperGiftMotion = typeof developerGiftMotions.$inferSelect;
