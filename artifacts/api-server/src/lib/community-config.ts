export type CommunityVideoSearchPolicy = {
  order?: "date";
  publishedWithinDays?: number;
  trustedChannelTitles?: readonly string[];
};

type CommunityRoomConfig = {
  roomId: string;
  label: string;
  defaultVideoSearch: string;
  videoSearchPolicy?: CommunityVideoSearchPolicy;
};

const TRUSTED_WORLD_NEWS_CHANNELS = [
  "ABC News",
  "Al Jazeera English",
  "Associated Press",
  "BBC News",
  "CBS News",
  "Channel 4 News",
  "CNN",
  "DW News",
  "France 24 English",
  "NBC News",
  "PBS NewsHour",
  "Reuters",
  "Sky News",
  "The Guardian",
];

export const COMMUNITY_ROOMS: CommunityRoomConfig[] = [
  { roomId: "LIVEME", label: "Video Games & Interactive Media", defaultVideoSearch: "Video Games & Interactive Media" },
  { roomId: "BIGOLV", label: "Television & Streaming Services", defaultVideoSearch: "Television & Streaming Services" },
  { roomId: "TANGOL", label: "Film & Theatrical Box Office", defaultVideoSearch: "Film & Theatrical Box Office" },
  { roomId: "TIKTOK", label: "Recorded Music & Audio Streaming", defaultVideoSearch: "Recorded Music & Audio Streaming" },
  { roomId: "INSTAL", label: "Live Concerts & Music Festivals", defaultVideoSearch: "Live Concerts & Music Festivals" },
  { roomId: "SUPRLV", label: "Spectator Sports Events", defaultVideoSearch: "Spectator Sports Events" },
  { roomId: "THEMEP", label: "Theme Parks & Amusement Attractions", defaultVideoSearch: "Theme Parks & Amusement Attractions" },
  { roomId: "SOCIAL", label: "Social Media & Creator Economy Content", defaultVideoSearch: "Social Media & Creator Economy Content" },
  { roomId: "PERFRM", label: "Performing Arts, Theater & Comedy Shows", defaultVideoSearch: "Performing Arts, Theater & Comedy Shows" },
  {
    roomId: "SPORTS",
    label: "Sports",
    defaultVideoSearch: "recent sports highlights and sports news",
    videoSearchPolicy: { order: "date", publishedWithinDays: 14 },
  },
  {
    roomId: "WORLDNEWS",
    label: "World News",
    defaultVideoSearch: "recent world news coverage BBC News Reuters Associated Press",
    videoSearchPolicy: {
      order: "date",
      publishedWithinDays: 14,
      trustedChannelTitles: TRUSTED_WORLD_NEWS_CHANNELS,
    },
  },
];

export interface CommunityParentLookup {
  communityParentId(roomId: string): string | null;
  communityLabel?(roomId: string): string | null;
  isCommunity?(roomId: string): boolean;
  isTestOnly?(roomId: string): boolean;
}

export function isPublicTopicRoom(roomId: string, store: CommunityParentLookup): boolean {
  const normalizedId = roomId.toUpperCase();
  if (store.isCommunity && !store.isCommunity(normalizedId)) return false;
  if (store.isTestOnly?.(normalizedId)) return false;
  const parentId = store.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  return COMMUNITY_ROOMS.some(room => room.roomId === parentId);
}

export function communityDefaultVideoSearch(roomId: string, store?: CommunityParentLookup): string {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const configuredRoom = COMMUNITY_ROOMS.find(room => room.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(room => room.roomId === normalizedId);
  // Topic-specific searches also apply to overflow children; existing rooms keep searching by their displayed name.
  if (configuredRoom && configuredRoom.defaultVideoSearch !== configuredRoom.label) {
    return configuredRoom.defaultVideoSearch;
  }
  const currentRoomName = store?.communityLabel?.(normalizedId)?.trim();
  if (currentRoomName) return currentRoomName;
  const parentRoomName = parentRoomId ? store?.communityLabel?.(parentRoomId)?.trim() : null;
  if (parentRoomName) return parentRoomName;
  return configuredRoom?.label ?? "University";
}

export function communityVideoSearchPolicy(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityVideoSearchPolicy | null {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  if (!room?.videoSearchPolicy) return null;
  return {
    ...room.videoSearchPolicy,
    ...(room.videoSearchPolicy.trustedChannelTitles
      ? { trustedChannelTitles: [...room.videoSearchPolicy.trustedChannelTitles] } : {}),
  };
}
