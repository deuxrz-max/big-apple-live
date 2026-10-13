export type CommunityVideoSearchPolicy = {
  order?: "date" | "viewCount";
  publishedWithinDays?: number;
  trustedChannelTitles?: readonly string[];
};

export type CommunityLiveStreamPolicy = {
  channelHandle: string;
  channelTitle: string;
  streamTitle: string;
  liveSearchQuery: string;
  fallbackSearch: string;
  segmentDurationMs: number;
};

type CommunityRoomConfig = {
  roomId: string;
  label: string;
  defaultVideoSearch: string;
  videoSearchPolicy?: CommunityVideoSearchPolicy;
  liveStreamPolicy?: CommunityLiveStreamPolicy;
};

const TRUSTED_KIDS_CHANNELS = [
  "BabyBus - Kids Songs and Cartoons",
  "Bluey - Official Channel",
  "CoComelon - Nursery Rhymes",
  "Disney Jr.",
  "Little Baby Bum - Nursery Rhymes & Kids Songs",
  "Ms Rachel - Toddler Learning Videos",
  "PBS KIDS",
  "Peppa Pig - Official Channel",
  "Pinkfong Baby Shark - Kids' Songs & Stories",
  "Sesame Street",
  "Super Simple Songs - Kids Songs",
  "The Wiggles",
];

export const COMMUNITY_ROOMS: CommunityRoomConfig[] = [
  {
    roomId: "MUSIC1",
    label: "Music",
    defaultVideoSearch: "popular official music videos and new song releases",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "GAMING",
    label: "Gaming",
    defaultVideoSearch: "popular video game gameplay highlights and new game trailers",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "KIDS01",
    label: "Kids",
    defaultVideoSearch: "kid friendly family cartoons learning videos and nursery rhymes",
    videoSearchPolicy: {
      order: "viewCount",
      publishedWithinDays: 30,
      trustedChannelTitles: TRUSTED_KIDS_CHANNELS,
    },
  },
  {
    roomId: "COMEDY",
    label: "Comedy",
    defaultVideoSearch: "popular stand up comedy and clean comedy sketches",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "VLOGS1",
    label: "Vlogs",
    defaultVideoSearch: "popular creator vlogs daily life and travel vlogs",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "SPORTS",
    label: "Sports",
    defaultVideoSearch: "popular recent sports highlights and sports news",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 14 },
  },
  {
    roomId: "NEWS01",
    label: "News",
    defaultVideoSearch: "CNN Headlines: 24/7 Live News",
    videoSearchPolicy: {
      order: "date",
      trustedChannelTitles: ["CNN"],
    },
    liveStreamPolicy: {
      channelHandle: "@CNN",
      channelTitle: "CNN",
      streamTitle: "CNN Headlines: 24/7 Live News",
      liveSearchQuery: "CNN Headlines: 24/7 Live News",
      fallbackSearch: "CNN latest news",
      segmentDurationMs: 15 * 60_000,
    },
  },
  {
    roomId: "MOVIES",
    label: "Movies",
    defaultVideoSearch: "popular official movie trailers and box office news",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "PODCAS",
    label: "Podcasts",
    defaultVideoSearch: "popular podcast clips interviews and conversations",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "REACTS",
    label: "Reactions",
    defaultVideoSearch: "popular reaction videos music movies and internet trends",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "PRANKS",
    label: "Pranks",
    defaultVideoSearch: "popular harmless clean prank videos and funny surprises",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "FOOD01",
    label: "Food",
    defaultVideoSearch: "popular cooking recipes street food and food challenges",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "BEAUTY",
    label: "Beauty",
    defaultVideoSearch: "popular makeup skincare beauty tutorials and trends",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "HOWTO1",
    label: "How-To",
    defaultVideoSearch: "popular how to tutorials DIY tips and practical guides",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "TECH01",
    label: "Tech",
    defaultVideoSearch: "popular technology reviews gadgets and product launches",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "EDUCAT",
    label: "Education",
    defaultVideoSearch: "popular educational science history and learning videos",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "FITNES",
    label: "Fitness",
    defaultVideoSearch: "popular fitness workouts training routines and exercise",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "PETS01",
    label: "Pets",
    defaultVideoSearch: "popular cute pets dogs cats and animal videos",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "TRAVEL",
    label: "Travel",
    defaultVideoSearch: "popular travel vlogs destination tours and travel tips",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "ASMR01",
    label: "ASMR",
    defaultVideoSearch: "popular ASMR relaxation whispering and soothing sounds",
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
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

export function communityLiveStreamPolicy(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityLiveStreamPolicy | null {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return room?.liveStreamPolicy ? { ...room.liveStreamPolicy } : null;
}
