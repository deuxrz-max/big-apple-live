import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export const chessRooms = pgTable("chess_rooms", {
  id: text("id").primaryKey(),
  game: jsonb("game").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertChessRoomSchema = createInsertSchema(chessRooms);
export type InsertChessRoom = z.infer<typeof insertChessRoomSchema>;
