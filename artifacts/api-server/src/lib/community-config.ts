/** Audio-only community room identities and the existing three directory channels. */
export type CommunityRoomConfig = { roomId: string; label: string };

export const COMMUNITY_ROOMS: CommunityRoomConfig[] = [
  { roomId: "MUSIC1", label: "Music" },
  { roomId: "GAMING", label: "Gaming" },
  { roomId: "KIDS01", label: "Pro Wrestling" },
  { roomId: "COMEDY", label: "Comedy" },
  { roomId: "VLOGS1", label: "Vlogs" },
  { roomId: "SPORTS", label: "Sports" },
  { roomId: "NEWS01", label: "News" },
  { roomId: "MOVIES", label: "Movies" },
  { roomId: "PODCAS", label: "Podcasts" },
  { roomId: "REACTS", label: "Reactions" },
  { roomId: "PRANKS", label: "Pranks" },
  { roomId: "FOOD01", label: "Food" },
  { roomId: "BEAUTY", label: "Beauty" },
  { roomId: "HIST01", label: "History" },
  { roomId: "TECH01", label: "Tech" },
  { roomId: "EDUCAT", label: "Education" },
  { roomId: "FITNES", label: "Fitness" },
  { roomId: "PETS01", label: "Pets" },
  { roomId: "TRAVEL", label: "Travel" },
  { roomId: "ASMR01", label: "ASMR" },
  { roomId: "WEBSER", label: "Web Series" },
  { roomId: "CAFE01", label: "The Cafe" },
  { roomId: "SCREEN", label: "The Screening Room" },
  { roomId: "ARENA1", label: "The Arena" },
];

export const SOURCE_COMMUNITY_ROOM_IDS = [
  "MUSIC1", "MOVIES", "COMEDY", "SPORTS", "KIDS01", "WEBSER", "HIST01", "NEWS01",
] as const;
export const DIRECTORY_COMMUNITY_ROOM_IDS = [
  ...SOURCE_COMMUNITY_ROOM_IDS, "CAFE01", "SCREEN", "ARENA1",
] as const;

export const DIRECTORY_COMMUNITY_ROOMS: CommunityRoomConfig[] = DIRECTORY_COMMUNITY_ROOM_IDS.flatMap(roomId => {
  const room = COMMUNITY_ROOMS.find(item => item.roomId === roomId);
  return room ? [room] : [];
});

export interface CommunityParentLookup {
  communityParentId(roomId: string): string | null;
  isCommunity?(roomId: string): boolean;
  isTestOnly?(roomId: string): boolean;
}

const directoryRoomIds = new Set<string>(DIRECTORY_COMMUNITY_ROOM_IDS);

/** Room topology/access helper retained for audio moderation and speaker controls. */
export function isPublicTopicRoom(roomId: string, store: CommunityParentLookup): boolean {
  const normalized = roomId.toUpperCase();
  if (store.isCommunity && !store.isCommunity(normalized)) return false;
  if (store.isTestOnly?.(normalized)) return false;
  const parent = store.communityParentId(normalized)?.toUpperCase() ?? normalized;
  return directoryRoomIds.has(parent);
}
