import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Absence means testing continues. Only an explicit owner confirmation closes it. */
export const coinTestLaunchControl = pgTable("coin_test_launch_control", {
  id: text("id").primaryKey(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: text("closed_by"),
});
export const insertCoinTestLaunchControlSchema = createInsertSchema(coinTestLaunchControl);

/** Short-lived, single-use previews; no startup/publish/payment hook executes them. */
export const coinTestResetPlans = pgTable("coin_test_reset_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export const insertCoinTestResetPlanSchema = createInsertSchema(coinTestResetPlans);
