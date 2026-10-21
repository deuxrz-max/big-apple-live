import { pgTable, text, timestamp, primaryKey, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountProfiles } from "./account-profiles";

/** A personal host block applies to every live room session owned by hostAccountId. */
export const hostRoomBlocks = pgTable("host_room_blocks", {
  hostAccountId: text("host_account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  targetAccountId: text("target_account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.hostAccountId, t.targetAccountId] }),
  check("host_room_blocks_no_self", sql`${t.hostAccountId} <> ${t.targetAccountId}`),
  index("host_room_blocks_target").on(t.targetAccountId),
]);

/**
 * Kicks belong to a room incarnation, not a reusable room code. Community-room
 * keys are chat_rooms.history_id; livestream keys include streamId and startedAt.
 */
export const roomSessionKicks = pgTable("room_session_kicks", {
  scopeType: text("scope_type", { enum: ["community", "livestream"] }).notNull(),
  scopeKey: text("scope_key").notNull(),
  targetAccountId: text("target_account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  actorAccountId: text("actor_account_id").references(() => accountProfiles.accountId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.scopeType, t.scopeKey, t.targetAccountId] }),
  check("room_session_kicks_scope_key_nonempty", sql`length(${t.scopeKey}) > 0`),
  index("room_session_kicks_target").on(t.targetAccountId),
]);
