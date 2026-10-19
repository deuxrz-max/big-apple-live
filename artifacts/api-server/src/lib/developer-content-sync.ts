import { eq } from "drizzle-orm";
import {
  communityVideoPools,
  db,
  developerContentSyncState,
  giftStudioAssets,
  type CommunityVideoPoolItem,
  type DeveloperContentSyncSummaryData,
} from "@workspace/db";
import { COMMUNITY_VIDEO_POOL_ROOMS } from "./community-config";
import {
  canSpendGeneralYouTubeUnits,
  getCommunityVideoPoolRefreshError,
  refreshCommunityVideoPoolIncrementally,
} from "./room-video-rotation";
import { listGiftCatalogForOwner } from "./gift-studio-catalog";
import {
  comparePoolRecords,
  easternDateKey,
  easternMinuteOfDay,
  isEasternDailySyncDue,
  runSyncItemsIndependently,
  summarizeStudioContent,
} from "./developer-content-sync-policy";
import { logger } from "./logger";

const STATE_ID = "daily-content";
const ESTIMATED_MAX_UNITS_PER_ROOM = 102;
const SCHEDULE_CHECK_MS = 30_000;
const easternParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type SyncTrigger = DeveloperContentSyncSummaryData["trigger"];
type SyncResult = {
  lastSyncedAt: string | null;
  lastScheduledEasternDate: string | null;
  summary: DeveloperContentSyncSummaryData | null;
  isRunning: boolean;
};

let syncInFlight: Promise<SyncResult> | null = null;
let schedulerStarted = false;

async function loadState() {
  const [row] = await db.select().from(developerContentSyncState)
    .where(eq(developerContentSyncState.id, STATE_ID)).limit(1);
  return row ?? null;
}

export async function getDeveloperContentSyncStatus(): Promise<SyncResult> {
  const row = await loadState();
  return {
    lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    lastScheduledEasternDate: row?.lastScheduledEasternDate ?? null,
    summary: row?.summary ?? null,
    isRunning: Boolean(syncInFlight),
  };
}

async function readPool(roomId: string): Promise<CommunityVideoPoolItem[]> {
  const [row] = await db.select({ videos: communityVideoPools.videos })
    .from(communityVideoPools)
    .where(eq(communityVideoPools.roomId, roomId.toUpperCase()))
    .limit(1);
  return row?.videos ?? [];
}

async function syncVideoPools(apiKey: string) {
  const rooms = COMMUNITY_VIDEO_POOL_ROOMS.map(room => ({
    roomId: room.roomId,
    label: room.label,
  }));
  const items = await runSyncItemsIndependently(rooms, async room => {
    const before = await readPool(room.roomId);
    if (!apiKey.trim()) {
      return {
        roomId: room.roomId,
        added: 0,
        updated: 0,
        skipped: 1,
        savedCount: before.length,
        message: "YouTube API key is not configured; saved pool retained.",
      };
    }
    if (!(await canSpendGeneralYouTubeUnits(ESTIMATED_MAX_UNITS_PER_ROOM))) {
      return {
        roomId: room.roomId,
        added: 0,
        updated: 0,
        skipped: 1,
        savedCount: before.length,
        message: "Daily YouTube quota budget reached; saved pool retained.",
      };
    }

    await refreshCommunityVideoPoolIncrementally(room.roomId, apiKey, {
      communityParentId: id => id.toUpperCase(),
      communityLabel: id => COMMUNITY_VIDEO_POOL_ROOMS.find(entry => entry.roomId === id.toUpperCase())?.label ?? null,
    });
    const after = await readPool(room.roomId);
    const error = getCommunityVideoPoolRefreshError(room.roomId);
    const diff = comparePoolRecords(before, after);
    return {
      roomId: room.roomId,
      added: diff.added,
      updated: diff.updated,
      skipped: error ? 1 : 0,
      savedCount: after.length,
      ...(error ? { message: error } : diff.added === 0 && diff.updated === 0
        ? { message: "No new eligible uploads; existing pool retained." }
        : { message: `${room.label} pool refreshed from its configured YouTube sources.` }),
    };
  });

  for (const [index, result] of items.entries()) {
    const roomId = rooms[index]?.roomId ?? "unknown";
    if (result.error) {
      logger.warn({ roomId, error: result.error }, "YouTube room pool skipped; its saved pool remains active");
    } else if (result.value && result.value.skipped > 0) {
      logger.warn({ roomId, reason: result.value.message }, "YouTube room pool skipped; its saved pool remains active");
    }
  }

  return items.map((result, index) => result.value ?? {
    roomId: rooms[index]?.roomId ?? "unknown",
    added: 0,
    updated: 0,
    skipped: 1,
    savedCount: 0,
    message: result.error ?? "This room was skipped; other pools continued.",
  });
}

async function summarizeGiftAndEntranceAssets() {
  const [catalog, versions] = await Promise.all([
    listGiftCatalogForOwner(),
    db.select({
      id: giftStudioAssets.id,
      giftId: giftStudioAssets.giftId,
      status: giftStudioAssets.status,
      settings: giftStudioAssets.settings,
    }).from(giftStudioAssets),
  ]);
  return summarizeStudioContent(catalog, versions);
}

async function executeSync(trigger: SyncTrigger): Promise<SyncResult> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? "";
  const [videoPools, { giftEffects, entranceEffects }] = await Promise.all([
    syncVideoPools(apiKey),
    summarizeGiftAndEntranceAssets(),
  ]);
  const added = videoPools.reduce((sum, item) => sum + item.added, 0);
  const updated = videoPools.reduce((sum, item) => sum + item.updated, 0);
  const skipped = videoPools.reduce((sum, item) => sum + item.skipped, 0)
    + giftEffects.skipped + entranceEffects.skipped;
  const summary: DeveloperContentSyncSummaryData = {
    trigger,
    added,
    updated,
    skipped,
    videoPools,
    giftEffects,
    entranceEffects,
  };

  const completedAt = new Date();
  const previous = await loadState();
  const shouldMarkScheduledDay = trigger !== "manual" || easternMinuteOfDay(completedAt) >= 180;
  const lastScheduledEasternDate = shouldMarkScheduledDay
    ? easternDateKey(completedAt)
    : previous?.lastScheduledEasternDate ?? null;
  await db.insert(developerContentSyncState).values({
    id: STATE_ID,
    lastSyncedAt: completedAt,
    lastScheduledEasternDate,
    summary,
    updatedAt: completedAt,
  }).onConflictDoUpdate({
    target: developerContentSyncState.id,
    set: {
      lastSyncedAt: completedAt,
      lastScheduledEasternDate,
      summary,
      updatedAt: completedAt,
    },
  });

  logger.info({
    trigger,
    added,
    updated,
    skipped,
    roomCount: videoPools.length,
  }, "Developer content sync completed");
  return {
    lastSyncedAt: completedAt.toISOString(),
    lastScheduledEasternDate,
    summary,
    isRunning: false,
  };
}

export function runDeveloperContentSync(trigger: SyncTrigger = "manual"): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  const run = executeSync(trigger)
    .catch(error => {
      logger.error({ err: error, trigger }, "Developer content sync failed");
      throw error;
    })
    .finally(() => {
      if (syncInFlight === run) syncInFlight = null;
    });
  syncInFlight = run;
  return run;
}

export function startDeveloperContentSyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  let firstCheck = true;
  const check = async (isStartupCheck: boolean) => {
    try {
      const row = await loadState();
      const now = new Date();
      if (!isEasternDailySyncDue(now, row?.lastScheduledEasternDate ?? null)) return;
      const trigger: SyncTrigger = isStartupCheck ? "startup-catchup" : "scheduled";
      await runDeveloperContentSync(trigger);
    } catch (error) {
      logger.error({ err: error }, "Daily 3 AM Eastern content sync check failed");
    } finally {
      if (isStartupCheck) firstCheck = false;
    }
  };
  void check(true);
  const timer = setInterval(() => {
    void check(firstCheck);
    firstCheck = false;
  }, SCHEDULE_CHECK_MS);
  timer.unref();
  logger.info({
    timeZone: "America/New_York",
    scheduledTime: "03:00",
    checkIntervalMs: SCHEDULE_CHECK_MS,
  }, "Started owner content sync scheduler");
}

export function easternSyncSchedulerConfiguration() {
  const parts = easternParts.formatToParts(new Date());
  return {
    timeZone: "America/New_York" as const,
    hour: 3,
    minute: 0,
    activeRoomCount: COMMUNITY_VIDEO_POOL_ROOMS.length,
    easternDate: `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}-${parts.find(part => part.type === "day")?.value}`,
  };
}
