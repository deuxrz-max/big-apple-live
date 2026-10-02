// Private room capabilities: per-tab sessionStorage only, scoped to Clerk user + room.
export interface RoomCreds {
  participantSessionId: string;
  participantId: string;
}
const PREFIX = 'wb:room:';
const key = (userId: string, roomId: string) => `${PREFIX}${userId}:${roomId}`;

export function saveCreds(userId: string, roomId: string, c: RoomCreds) {
  sessionStorage.setItem(key(userId, roomId), JSON.stringify(c));
}
export function loadCreds(userId: string, roomId: string): RoomCreds | null {
  try {
    const raw = sessionStorage.getItem(key(userId, roomId));
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c?.participantSessionId && c?.participantId ? c : null;
  } catch {
    return null;
  }
}
export function clearCreds(userId: string, roomId: string) {
  sessionStorage.removeItem(key(userId, roomId));
}
export function clearAllCreds() {
  for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
}
