export type CommunityVideoSearchPolicy = {
  order?: "date" | "viewCount";
  publishedWithinDays?: number;
  trustedChannelTitles?: readonly string[];
  videoCategoryId?: string;
};

export type CommunityLiveStreamPolicy = {
  channelHandle: string;
  channelTitle: string;
  streamTitle: string;
  liveSearchQuery: string;
  fallbackSearch: string;
  segmentDurationMs: number;
};

export type CommunityWrestlingChannel = {
  channelId: string;
  channelTitle: string;
};

export type CommunityWrestlingSearchPolicy = {
  query: string;
  channels: readonly CommunityWrestlingChannel[];
  cacheTtlMs: number;
};

export type CommunityOfficialChannelSearchPolicy = {
  channelHandle: string;
  channelTitle: string;
  query: string;
  cacheTtlMs: number;
};

export type CommunityVideoUploadChannel = {
  channelHandle: string;
  channelTitle: string;
  titleTerms: readonly string[];
  sourceTag?: "jkdanimator" | "comedycentral";
};

export type CommunityVideoPlaylist = {
  playlistId: string;
  sourceTag: "playlist";
  sourceTitle: string;
};

const MOVIE_UPLOAD_CHANNELS: readonly CommunityVideoUploadChannel[] = [
  { channelHandle: "@FilmRiseMovies", channelTitle: "FilmRise Movies", titleTerms: ["full movie", "full film", "full-length movie"] },
  { channelHandle: "@Popcornflix", channelTitle: "Popcornflix", titleTerms: ["full movie", "full film", "full-length movie"] },
  { channelHandle: "@ParamountMovies", channelTitle: "Paramount Movies", titleTerms: ["full movie", "full film", "full-length movie"] },
  { channelHandle: "@ShoutFactory", channelTitle: "Shout! Studios", titleTerms: ["full movie", "full film", "full-length movie"] },
  { channelHandle: "@LionsgateMovies", channelTitle: "Lionsgate Movies", titleTerms: ["full movie", "full film", "full-length movie"] },
];

type CommunityRoomConfig = {
  roomId: string;
  label: string;
  defaultVideoSearch: string;
  videoSearchTerms?: readonly string[];
  videoSearchPolicy?: CommunityVideoSearchPolicy;
  liveStreamPolicy?: CommunityLiveStreamPolicy;
  wrestlingSearchPolicy?: CommunityWrestlingSearchPolicy;
  officialChannelSearchPolicy?: CommunityOfficialChannelSearchPolicy;
  videoUploadChannels?: readonly CommunityVideoUploadChannel[];
  videoPlaylists?: readonly CommunityVideoPlaylist[];
  dailyWebSeries?: boolean;
};

export const COMMUNITY_ROOMS: CommunityRoomConfig[] = [
  {
    roomId: "MUSIC1",
    label: "Music",
    defaultVideoSearch: "popular official artist music videos",
    videoSearchTerms: [
      "popular official music video artist",
      "new official music video VEVO",
      "popular artist official video music",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90, videoCategoryId: "10" },
  },
  {
    roomId: "GAMING",
    label: "Gaming",
    defaultVideoSearch: "popular video game gameplay highlights and new game trailers",
    videoSearchTerms: [
      "popular video game gameplay highlights full match English",
      "new video game trailers official English",
      "esports tournament full match highlights English",
      "popular gaming walkthrough full video English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "KIDS01",
    label: "Pro Wrestling",
    defaultVideoSearch: "Pro Wrestling highlights full matches and promos",
    videoSearchPolicy: {
      order: "date",
      trustedChannelTitles: ["All Elite Wrestling", "WWE", "TNA Wrestling"],
    },
    wrestlingSearchPolicy: {
      query: "highlights full matches promos",
      cacheTtlMs: 6 * 60 * 60_000,
      channels: [
        { channelId: "UCFN4JkGP_bVhAdBsoV9xftA", channelTitle: "All Elite Wrestling" },
        { channelId: "UCJ5v_MCY6GNUBTO8-D3XoAg", channelTitle: "WWE" },
        { channelId: "UCOp8wkVqdrWbFYHjDv946QQ", channelTitle: "TNA Wrestling" },
      ],
    },
  },
  {
    roomId: "COMEDY",
    label: "Comedy",
    defaultVideoSearch: "popular stand up comedy and clean comedy sketches",
    videoSearchTerms: [
      "English clean stand up comedy full set",
      "English comedy special full segment",
      "late night comedy monologue full episode English",
      "clean English improv comedy full performance",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
    videoUploadChannels: [
      { channelHandle: "@JkDAnimator", channelTitle: "JkDAnimator", titleTerms: [], sourceTag: "jkdanimator" },
      { channelHandle: "@ComedyCentral", channelTitle: "Comedy Central", titleTerms: [], sourceTag: "comedycentral" },
    ],
    videoPlaylists: [
      { playlistId: "PLEMjCJwHb6w1UqDzZngrOKqbAW3AD9mxa", sourceTag: "playlist", sourceTitle: "Playlist" },
    ],
  },
  {
    roomId: "VLOGS1",
    label: "Vlogs",
    defaultVideoSearch: "popular creator vlogs daily life and travel vlogs",
    videoSearchTerms: [
      "popular English creator daily life full vlog",
      "English travel vlog full video popular creator",
      "day in my life creator full vlog English",
      "popular lifestyle vlog full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "SPORTS",
    label: "Sports",
    defaultVideoSearch: "popular recent sports highlights and sports news",
    videoSearchTerms: [
      "recent popular sports highlights English",
      "latest sports news highlights",
      "best game highlights recent sports",
      "sports championship highlights English",
    ],
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
    defaultVideoSearch: "complete full-length movies from official licensed movie channels",
    videoSearchTerms: [
      "FilmRise full movie English",
      "Popcornflix full movie English",
      "Paramount Movies full movie English",
      "Shout Studios full movie English",
      "Lionsgate Movies full movie English",
    ],
    videoSearchPolicy: {
      order: "viewCount",
      trustedChannelTitles: MOVIE_UPLOAD_CHANNELS.map(channel => channel.channelTitle),
    },
    videoUploadChannels: MOVIE_UPLOAD_CHANNELS,
  },
  {
    roomId: "PODCAS",
    label: "Podcasts",
    defaultVideoSearch: "popular podcast clips interviews and conversations",
    videoSearchTerms: [
      "popular English podcast full episode interview",
      "long form podcast conversation English full episode",
      "creator podcast discussion full conversation English",
      "comedy podcast full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "REACTS",
    label: "Reactions",
    defaultVideoSearch: "popular reaction videos music movies and internet trends",
    videoSearchTerms: [
      "popular English reaction video full length music",
      "movie trailer reaction full video English",
      "internet trends reaction full video English",
      "creator reacts to viral videos full English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "PRANKS",
    label: "Pranks",
    defaultVideoSearch: "popular harmless clean prank videos and funny surprises",
    videoSearchTerms: [
      "popular harmless prank full video English",
      "clean funny prank compilation full length English",
      "friendly surprise prank full episode English",
      "popular social experiment prank full video English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "FOOD01",
    label: "Food",
    defaultVideoSearch: "popular cooking recipes street food and food challenges",
    videoSearchTerms: [
      "popular cooking recipe full video English",
      "street food tour full episode English",
      "food challenge full video English",
      "easy recipe creator full video English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "BEAUTY",
    label: "Beauty",
    defaultVideoSearch: "popular makeup skincare beauty tutorials and trends",
    videoSearchTerms: [
      "popular English makeup tutorial full video",
      "skincare routine full video English",
      "beauty product review full review English",
      "makeup artist transformation tutorial English full",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "HIST01",
    label: "History",
    defaultVideoSearch: "HISTORY full episodes The Men Who Built America documentary",
    videoSearchPolicy: { order: "date", trustedChannelTitles: ["HISTORY"] },
    officialChannelSearchPolicy: {
      channelHandle: "@HISTORY",
      channelTitle: "HISTORY",
      query: "full episodes The Men Who Built America documentary",
      cacheTtlMs: 24 * 60 * 60_000,
    },
  },
  {
    roomId: "TECH01",
    label: "Tech",
    defaultVideoSearch: "popular technology reviews gadgets and product launches",
    videoSearchTerms: [
      "popular English technology review full video",
      "new technology product launch full review English",
      "smartphone laptop full review English",
      "technology news full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "EDUCAT",
    label: "Education",
    defaultVideoSearch: "popular educational science history and learning videos",
    videoSearchTerms: [
      "popular science documentary full episode English",
      "history educational documentary full video English",
      "science lecture full lesson English",
      "educational experiment full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "FITNES",
    label: "Fitness",
    defaultVideoSearch: "popular fitness workouts training routines and exercise",
    videoSearchTerms: [
      "popular full fitness workout English follow along",
      "strength training workout full session English",
      "home workout complete routine English",
      "fitness tips full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "PETS01",
    label: "Pets",
    defaultVideoSearch: "popular cute pets dogs cats and animal videos",
    videoSearchTerms: [
      "popular dogs cats pet full video English",
      "animal rescue story full episode English",
      "funny pet compilation full length English",
      "wildlife animal behavior documentary English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "TRAVEL",
    label: "Travel",
    defaultVideoSearch: "popular travel vlogs destination tours and travel tips",
    videoSearchTerms: [
      "popular travel destinations full tour English",
      "city walking tour 4K full video English",
      "travel vlog complete itinerary English",
      "beautiful places travel guide full episode English",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 90 },
  },
  {
    roomId: "ASMR01",
    label: "ASMR",
    defaultVideoSearch: "popular ASMR relaxation whispering and soothing sounds",
    videoSearchTerms: [
      "popular ASMR relaxation English",
      "ASMR whispering roleplay long video",
      "ASMR no talking sounds English",
      "sleep relaxation ASMR triggers",
    ],
    videoSearchPolicy: { order: "viewCount", publishedWithinDays: 30 },
  },
  {
    roomId: "WEBSER",
    label: "Web Series",
    defaultVideoSearch: "Series of the Day",
    dailyWebSeries: true,
  },
];

/** Room order and visibility for the public Directory. Hidden room configuration stays above. */
export const DIRECTORY_COMMUNITY_ROOM_IDS = [
  "MUSIC1",
  "MOVIES",
  "COMEDY",
  "SPORTS",
  "KIDS01",
  "WEBSER",
  "HIST01",
  "NEWS01",
] as const;

const DIRECTORY_ROOM_ID_SET = new Set<string>(DIRECTORY_COMMUNITY_ROOM_IDS);

export const DIRECTORY_COMMUNITY_ROOMS: CommunityRoomConfig[] = DIRECTORY_COMMUNITY_ROOM_IDS.map(roomId => {
  const room = COMMUNITY_ROOMS.find(item => item.roomId === roomId);
  if (!room) throw new Error(`Directory room configuration is missing: ${roomId}`);
  return room;
});

/** Active rooms that use the rotating topic-video pool rather than a special stream/series flow. */
export const COMMUNITY_VIDEO_POOL_ROOMS = DIRECTORY_COMMUNITY_ROOMS
  .filter(room => !room.liveStreamPolicy && !room.dailyWebSeries);

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
  return DIRECTORY_ROOM_ID_SET.has(parentId);
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

export function communityVideoSearchTerms(
  roomId: string,
  store?: CommunityParentLookup,
): string[] {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return [...(room?.videoSearchTerms?.length ? room.videoSearchTerms : [communityDefaultVideoSearch(roomId, store)])];
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

export function communityWrestlingSearchPolicy(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityWrestlingSearchPolicy | null {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  if (!room?.wrestlingSearchPolicy) return null;
  return {
    ...room.wrestlingSearchPolicy,
    channels: room.wrestlingSearchPolicy.channels.map(channel => ({ ...channel })),
  };
}

export function communityOfficialChannelSearchPolicy(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityOfficialChannelSearchPolicy | null {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return room?.officialChannelSearchPolicy ? { ...room.officialChannelSearchPolicy } : null;
}

export function communityVideoUploadChannels(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityVideoUploadChannel[] {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return room?.videoUploadChannels?.map(channel => ({ ...channel, titleTerms: [...channel.titleTerms] })) ?? [];
}

export function communityVideoPlaylists(
  roomId: string,
  store?: CommunityParentLookup,
): CommunityVideoPlaylist[] {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return room?.videoPlaylists?.map(playlist => ({ ...playlist })) ?? [];
}

export function isCommunityDailyWebSeriesRoom(
  roomId: string,
  store?: CommunityParentLookup,
): boolean {
  const normalizedId = roomId.toUpperCase();
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase() ?? normalizedId;
  const room = COMMUNITY_ROOMS.find(item => item.roomId === parentRoomId)
    ?? COMMUNITY_ROOMS.find(item => item.roomId === normalizedId);
  return room?.dailyWebSeries === true;
}
