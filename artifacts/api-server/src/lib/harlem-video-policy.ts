import type { CommunityVideoPoolItem } from "@workspace/db";

export const HARLEM_ROOM_ID = "ARENA1";
export const HARLEM_HASHTAGS = ["#BiggJah", "#ComedySkits", "#FunnyVideos"] as const;
export const HARLEM_POLICY_KEY = "__harlemHashtagRotationV1";
export const HARLEM_REFRESH_MS = 24 * 60 * 60_000;

export function harlemVideoPlayable(video: CommunityVideoPoolItem): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(video.videoId)
    && video.embeddable === true && video.ageRestricted === false
    && video.availableInUS === true && video.durationMs > 0;
}

export function harlemRefreshDue(refreshedAt: Date | null, lastAttemptAt: Date | null, now = Date.now()) {
  return (!refreshedAt || now - refreshedAt.getTime() >= HARLEM_REFRESH_MS)
    && (!lastAttemptAt || now - lastAttemptAt.getTime() >= 30 * 60_000);
}
