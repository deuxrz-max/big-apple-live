import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountProfiles } from "./account-profiles";

/** Server-managed room entrance effects granted to individual accounts. */
export const accountRoomEntranceEffects = pgTable("account_room_entrance_effects", {
  accountId: text("account_id").notNull().references(() => accountProfiles.accountId, { onDelete: "cascade" }),
  effectId: text("effect_id").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
}, table => [
  primaryKey({ columns: [table.accountId, table.effectId] }),
]);

export const insertAccountRoomEntranceEffectSchema = createInsertSchema(accountRoomEntranceEffects)
  .omit({ grantedAt: true, lastTriggeredAt: true });
export type InsertAccountRoomEntranceEffect = z.infer<typeof insertAccountRoomEntranceEffectSchema>;
export type AccountRoomEntranceEffect = typeof accountRoomEntranceEffects.$inferSelect;
