import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

export type SceneVector3 = [number, number, number];

export const developerSceneModels = pgTable("developer_scene_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  originalFilename: text("original_filename").notNull(),
  format: text("format").$type<"glb" | "gltf">().notNull(),
  objectPath: text("object_path").notNull().unique(),
  byteSize: integer("byte_size").notNull(),
  position: jsonb("position").$type<SceneVector3>().notNull().default(sql`'[0, 0, 0]'::jsonb`),
  rotation: jsonb("rotation").$type<SceneVector3>().notNull().default(sql`'[0, 0, 0]'::jsonb`),
  scale: real("scale").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("developer_scene_models_active_order").on(table.active, table.createdAt),
]);

export const insertDeveloperSceneModelSchema = createInsertSchema(developerSceneModels);
export type InsertDeveloperSceneModel = typeof developerSceneModels.$inferInsert;
export type DeveloperSceneModel = typeof developerSceneModels.$inferSelect;
