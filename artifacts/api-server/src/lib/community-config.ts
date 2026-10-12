export const COMMUNITY_ROOMS = [
  { roomId: "LIVEME", label: "Video Games & Interactive Media", defaultVideoSearch: "Video Games & Interactive Media" },
  { roomId: "BIGOLV", label: "Television & Streaming Services", defaultVideoSearch: "Television & Streaming Services" },
  { roomId: "TANGOL", label: "Film & Theatrical Box Office", defaultVideoSearch: "Film & Theatrical Box Office" },
  { roomId: "TIKTOK", label: "Recorded Music & Audio Streaming", defaultVideoSearch: "Recorded Music & Audio Streaming" },
  { roomId: "INSTAL", label: "Live Concerts & Music Festivals", defaultVideoSearch: "Live Concerts & Music Festivals" },
  { roomId: "SUPRLV", label: "Spectator Sports Events", defaultVideoSearch: "Spectator Sports Events" },
  { roomId: "THEMEP", label: "Theme Parks & Amusement Attractions", defaultVideoSearch: "Theme Parks & Amusement Attractions" },
  { roomId: "SOCIAL", label: "Social Media & Creator Economy Content", defaultVideoSearch: "Social Media & Creator Economy Content" },
  { roomId: "PERFRM", label: "Performing Arts, Theater & Comedy Shows", defaultVideoSearch: "Performing Arts, Theater & Comedy Shows" },
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
  const currentRoomName = store?.communityLabel?.(normalizedId)?.trim();
  if (currentRoomName) return currentRoomName;
  const parentRoomId = store?.communityParentId(normalizedId)?.toUpperCase();
  const parentRoomName = parentRoomId ? store?.communityLabel?.(parentRoomId)?.trim() : null;
  if (parentRoomName) return parentRoomName;
  return COMMUNITY_ROOMS.find(room => room.roomId === normalizedId)?.label
    ?? COMMUNITY_ROOMS.find(room => room.roomId === parentRoomId)?.label
    ?? "University";
}
