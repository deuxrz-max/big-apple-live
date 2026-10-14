import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type LiveStreamSessionState = "starting" | "live" | "ending";

export const liveStreamSessions = pgTable("live_stream_sessions", {
  accountId: text("account_id").primaryKey(),
  streamId: text("stream_id").notNull().unique(),
  state: text("state").$type<LiveStreamSessionState>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLiveStreamSessionSchema = createInsertSchema(liveStreamSessions)
  .omit({ startedAt: true, updatedAt: true });
export type InsertLiveStreamSession = z.infer<typeof insertLiveStreamSessionSchema>;
export type LiveStreamSession = typeof liveStreamSessions.$inferSelect;
