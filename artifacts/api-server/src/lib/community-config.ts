export const COMMUNITY_ROOMS = [
  { roomId: "LIVEME", label: "Video Games & Interactive Media", defaultVideoSearch: "video game gameplay highlights new game trailers" },
  { roomId: "BIGOLV", label: "Television & Streaming Services", defaultVideoSearch: "TV show trailers streaming series recaps" },
  { roomId: "TANGOL", label: "Film & Theatrical Box Office", defaultVideoSearch: "new movie trailers box office news" },
  { roomId: "TIKTOK", label: "Recorded Music & Audio Streaming", defaultVideoSearch: "new music videos official releases audio streaming" },
  { roomId: "INSTAL", label: "Live Concerts & Music Festivals", defaultVideoSearch: "live concert performances music festival highlights" },
  { roomId: "SUPRLV", label: "Spectator Sports Events", defaultVideoSearch: "sports event highlights best plays" },
  { roomId: "THEMEP", label: "Theme Parks & Amusement Attractions", defaultVideoSearch: "theme park ride POV park tours" },
  { roomId: "SOCIAL", label: "Social Media & Creator Economy Content", defaultVideoSearch: "creator economy social media creator trends" },
  { roomId: "PERFRM", label: "Performing Arts, Theater & Comedy Shows", defaultVideoSearch: "stand-up comedy clips Broadway theater performances" },
];

export interface CommunityParentLookup {
  communityParentId(roomId: string): string | null;
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
  const parentRoomId = store?.communityParentId(roomId);
  return COMMUNITY_ROOMS.find(room => room.roomId === parentRoomId)?.defaultVideoSearch
    ?? COMMUNITY_ROOMS.find(room => room.roomId === roomId.toUpperCase())?.defaultVideoSearch
    ?? "live entertainment highlights";
}
