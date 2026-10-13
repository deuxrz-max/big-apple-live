import { eq } from "drizzle-orm";
import {
  communityVideoPlayHistory,
  db,
} from "@workspace/db";
import {
  communityLiveStreamPolicy,
  COMMUNITY_ROOMS,
} from "../lib/community-config";
import {
  chooseUnplayedVideo,
  getCommunityVideoPool,
} from "../lib/room-video-rotation";
import { roomStore } from "../lib/room-store";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Video-pool refresh is development-only.");
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not available to the development runner.");
  const focusRoomId = process.env.ROOM_VIDEO_REFRESH_ROOM?.trim().toUpperCase();

  const reports: Array<{ room: string; count: number; sampleIds: string[] }> = [];
  const refreshable: Array<{ room: typeof COMMUNITY_ROOMS[number]; pool: Awaited<ReturnType<typeof getCommunityVideoPool>> }> = [];
  for (const room of COMMUNITY_ROOMS) {
    if (communityLiveStreamPolicy(room.roomId, roomStore)) {
      reports.push({ room: room.label, count: 1, sampleIds: ["CNN live stream (unchanged)"] });
      continue;
    }
    const pool = await getCommunityVideoPool(room.roomId, apiKey, roomStore);
    refreshable.push({ room, pool });
  }
  refreshable.sort((a, b) => a.pool.length - b.pool.length);
  for (let pass = 0; pass < 4; pass += 1) {
    for (const entry of refreshable) {
      if (focusRoomId && entry.room.roomId !== focusRoomId) continue;
      if (!focusRoomId && entry.pool.length >= 50) continue;
      entry.pool = await getCommunityVideoPool(entry.room.roomId, apiKey, roomStore, true, 1);
    }
  }

  for (const { room, pool } of refreshable) {
    const history = await db.select({
      videoId: communityVideoPlayHistory.videoId,
      lastPlayedAt: communityVideoPlayHistory.lastPlayedAt,
    }).from(communityVideoPlayHistory).where(eq(communityVideoPlayHistory.roomId, room.roomId));
    const played = new Map(history.map(row => [row.videoId, row.lastPlayedAt.getTime()]));
    const simulated: typeof pool = [];
    for (let index = 0; index < Math.min(3, pool.length); index += 1) {
      const pick = chooseUnplayedVideo(pool, played);
      if (!pick) break;
      simulated.push(pick);
      played.set(pick.videoId, Date.now());
    }
    reports.push({
      room: room.label,
      count: pool.length,
      sampleIds: simulated.map(video => video.videoId),
    });
  }
  for (const report of reports) {
    console.log(`${report.room}: ${report.count} pool videos; next picks distinct: ${new Set(report.sampleIds).size === report.sampleIds.length}`);
  }
}

void main().catch(() => {
  console.error("Development video-pool refresh could not complete.");
  process.exitCode = 1;
});
