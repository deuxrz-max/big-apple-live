import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roomMessages = pgTable("room_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: text("room_id").notNull(),
  // Unbound historical rows must never be backfilled by reused share code.
  historyId: uuid("history_id"),
  authorId: uuid("author_id").notNull(),
  authorAccountId: text("author_account_id"),
  hidden: text("hidden").notNull().default("false"),
  username: text("username").notNull(),
  identity: jsonb("identity").$type<{
    emojiId: string; gender: "Male" | "Female"; color: string; hairColor: string;
    portraitId?: string | null; currentMood?: string | null;
  }>().notNull(),
  kind: text("kind", { enum: ["text", "reaction"] }).notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("room_messages_room_created").on(table.roomId, table.createdAt),
  index("room_messages_history_created").on(table.historyId, table.createdAt),
]);
export const insertRoomMessageSchema = createInsertSchema(roomMessages);
export type InsertRoomMessage = z.infer<typeof insertRoomMessageSchema>;
export type RoomMessageRow = typeof roomMessages.$inferSelect;