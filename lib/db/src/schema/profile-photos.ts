import { pgTable, text, uuid, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Uploads may be staged before the first profile is saved.
export const profilePhotos = pgTable("profile_photos", {
  id: uuid("id").primaryKey(),
  accountId: text("account_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["pending", "approved", "rejected", "flagged"] }).notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Null while current; a new 30-day clock starts on replacement/removal.
  unusedSince: timestamp("unused_since", { withTimezone: true }).defaultNow(),
  // Durable tombstone: saves must reject it even if object deletion is interrupted.
  deletionStartedAt: timestamp("deletion_started_at", { withTimezone: true }),
}, (table) => [index("profile_photos_retention").on(table.unusedSince)]);
export const insertProfilePhotoSchema = createInsertSchema(profilePhotos);
export type ProfilePhoto = typeof profilePhotos.$inferSelect;
export type InsertProfilePhoto = z.infer<typeof insertProfilePhotoSchema>;
