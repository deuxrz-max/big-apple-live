export type RoomChannelSlug = 'cafe' | 'screening' | 'arena';
export type RoomChannelRoom = { roomId: string; label: string };
export type RoomChannel = { slug: RoomChannelSlug; roomId: string; title: string; rooms: readonly RoomChannelRoom[] };

export const ROOM_CHANNELS: readonly RoomChannel[] = [
  { slug: 'cafe', roomId: 'CAFE01', title: 'Times Square', rooms: [{ roomId: 'MUSIC1', label: 'Music' }, { roomId: 'COMEDY', label: 'Comedy' }, { roomId: 'NEWS01', label: 'News' }] },
  { slug: 'screening', roomId: 'SCREEN', title: 'Broadway', rooms: [{ roomId: 'MOVIES', label: 'Movies' }, { roomId: 'WEBSER', label: 'Web Series' }, { roomId: 'HIST01', label: 'History' }] },
  { slug: 'arena', roomId: 'ARENA1', title: 'Harlem', rooms: [{ roomId: 'SPORTS', label: 'Sports' }, { roomId: 'KIDS01', label: 'Pro Wrestling' }] },
];

/** Exact topic-room match only. */
export function channelForRoom(roomId: string): RoomChannel | null {
  const id = roomId.toUpperCase();
  return ROOM_CHANNELS.find((c) => c.roomId === id || c.rooms.some((r) => r.roomId === id)) ?? null;
}

/** Existing overflow IDs append a number; also accept legacy separators. */
export function channelForDirectoryRoom(roomId: string): RoomChannel | null {
  const id = roomId.toUpperCase();
  return channelForRoom(id) ?? ROOM_CHANNELS.find((c) => [c, ...c.rooms].some((r) =>
    id.startsWith(r.roomId) && /^[-_]?\d+$/.test(id.slice(r.roomId.length)))) ?? null;
}

export function roomChannelHref(roomId: string): string | null {
  const c = channelForDirectoryRoom(roomId);
  return c ? (roomId.toUpperCase().startsWith(c.roomId) ? '/home' : `/rooms/${c.roomId}`) : null;
}

export function channelBySlug(slug: string | null | undefined): RoomChannel | null {
  return ROOM_CHANNELS.find((c) => c.slug === slug) ?? null;
}
