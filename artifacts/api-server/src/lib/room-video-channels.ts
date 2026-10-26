/** Stable channel sessions; source-room pools remain separate and are never overwritten. */
export const UNIFIED_VIDEO_CHANNELS = [
  { roomId: "CAFE01", label: "The Cafe", sourceRoomIds: ["MUSIC1", "COMEDY", "NEWS01"] },
  { roomId: "SCREEN", label: "The Screening Room", sourceRoomIds: ["MOVIES", "WEBSER", "HIST01"] },
  { roomId: "ARENA1", label: "The Arena", sourceRoomIds: ["SPORTS", "KIDS01"] },
] as const;

export function unifiedVideoChannel(roomId: string) {
  return UNIFIED_VIDEO_CHANNELS.find(channel => channel.roomId === roomId.toUpperCase());
}

/** Interleave sources so a long source list cannot bury the others; retain every unique video. */
export function combineChannelVideos<T extends { videoId: string }>(sources: readonly (readonly T[])[]): T[] {
  const combined: T[] = [];
  const seen = new Set<string>();
  const length = Math.max(0, ...sources.map(source => source.length));
  for (let index = 0; index < length; index++) {
    for (const source of sources) {
      const video = source[index];
      if (video && !seen.has(video.videoId)) {
        seen.add(video.videoId);
        combined.push(video);
      }
    }
  }
  return combined;
}
