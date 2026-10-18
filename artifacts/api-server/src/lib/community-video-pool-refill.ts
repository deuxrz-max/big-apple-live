import {
  COMMUNITY_VIDEO_POOL_ROOMS,
} from "./community-config";
import { logger } from "./logger";
import { roomStore, type RoomStore } from "./room-store";
import {
  canSpendGeneralYouTubeUnits,
  getCommunityVideoPoolStats,
  refreshCommunityVideoPoolIncrementally,
} from "./room-video-rotation";

const REFILL_INTERVAL_MS = 15 * 60_000;
const FIRST_REFILL_DELAY_MS = 30_000;
// Active public rooms share a paced topic-pool budget instead of the former 20+ rooms.
const REFILL_TARGET_SIZE = 150;
const COMEDY_REFILL_TARGET_SIZE = 3_000;
const REFRESH_AFTER_MS = 6 * 60 * 60_000;

let nextRoomIndex = 0;
let refillInFlight = false;

/** One bounded, server-side batch. Music is first; later calls rotate fairly. */
export async function refillNextCommunityVideoPoolOnce(
  rooms: RoomStore = roomStore,
): Promise<{ roomId: string; count: number } | null> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Community video pool refills are preview-only.");
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() ?? "";
  if (!apiKey) return null;

  const orderedRooms = [...COMMUNITY_VIDEO_POOL_ROOMS]
    .sort((left, right) =>
      Number(right.roomId === "MOVIES") - Number(left.roomId === "MOVIES")
      || Number(right.roomId === "MUSIC1") - Number(left.roomId === "MUSIC1"));
  if (!orderedRooms.length) return null;

  const stats = await getCommunityVideoPoolStats();
  const byRoom = new Map(stats.map(item => [item.roomId.toUpperCase(), item]));
  const now = Date.now();
  for (let offset = 0; offset < orderedRooms.length; offset += 1) {
    const index = (nextRoomIndex + offset) % orderedRooms.length;
    const room = orderedRooms[index]!;
    // Comedy only uses channel/playlist pages and batched details; other rooms
    // retain the larger reserve required by their search-based fallbacks.
    const refillReserve = room.roomId === "COMEDY" ? 4 : 102;
    if (!(await canSpendGeneralYouTubeUnits(refillReserve))) continue;
    const stat = byRoom.get(room.roomId.toUpperCase());
    const stale = stat?.refreshedAtMs === null || stat?.refreshedAtMs === undefined
      || now - stat.refreshedAtMs >= REFRESH_AFTER_MS;
    const targetSize = room.roomId === "COMEDY" ? COMEDY_REFILL_TARGET_SIZE : REFILL_TARGET_SIZE;
    if ((stat?.count ?? 0) >= targetSize && !stale) continue;

    nextRoomIndex = (index + 1) % orderedRooms.length;
    const count = await refreshCommunityVideoPoolIncrementally(room.roomId, apiKey, rooms);
    logger.info({ roomId: room.roomId, savedPlayableVideoCount: count },
      "Refreshed one bounded room video-pool batch");
    return { roomId: room.roomId, count };
  }
  return null;
}

export function startCommunityVideoPoolRefillScheduler(rooms: RoomStore = roomStore): void {
  if (process.env.NODE_ENV === "production") {
    logger.info("Preview-only room video pool refills are disabled in production");
    return;
  }
  let stopped = false;
  const tick = async () => {
    if (stopped || refillInFlight) return;
    refillInFlight = true;
    try {
      await refillNextCommunityVideoPoolOnce(rooms);
    } catch (error) {
      logger.warn({ error }, "Incremental community video pool refill failed; saved pools remain available");
    } finally {
      refillInFlight = false;
    }
  };
  const initial = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), REFILL_INTERVAL_MS);
    interval.unref();
  }, FIRST_REFILL_DELAY_MS);
  initial.unref();
  logger.info({ intervalMs: REFILL_INTERVAL_MS }, "Started preview-only paced community video pool refills");
}
