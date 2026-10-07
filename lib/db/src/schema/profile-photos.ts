import { pgTable, text, uuid, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Uploads may be staged before the first profile is saved.
export const profilePhotos = pgTable("profile_photos", {
  id: uuid("id").primaryKey(),
  accountId: text("account_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertProfilePhotoSchema = createInsertSchema(profilePhotos);
export type ProfilePhoto = typeof profilePhotos.$inferSelect;
export type InsertProfilePhoto = z.infer<typeof insertProfilePhotoSchema>;
