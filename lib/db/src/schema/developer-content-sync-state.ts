import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type DeveloperContentSyncSummaryData = {
  trigger: "manual" | "scheduled" | "startup-catchup";
  added: number;
  updated: number;
  skipped: number;
  videoPools: Array<{
    roomId: string;
    added: number;
    updated: number;
    skipped: number;
    savedCount: number;
    message?: string;
  }>;
  giftEffects: { active: number; drafts: number; skipped: number };
  entranceEffects: { active: number; drafts: number; skipped: number };
};

export const developerContentSyncState = pgTable("developer_content_sync_state", {
  id: text("id").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastScheduledEasternDate: text("last_scheduled_eastern_date"),
  summary: jsonb("summary").$type<DeveloperContentSyncSummaryData | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeveloperContentSyncState = typeof developerContentSyncState.$inferSelect;
