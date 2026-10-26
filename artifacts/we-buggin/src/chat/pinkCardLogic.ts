const BASE = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
export const PINK_CARD_MEDIA = {
  card: `${BASE}api/rewards/pink-card/media/card`,
  shuffle: `${BASE}api/rewards/pink-card/media/shuffle`,
  shuffleFallback: `${BASE}api/rewards/pink-card/media/shuffle-fallback`,
} as const;
export const PINK_CARD_POLL_MS = 10_000;
export const FRESH_WINDOW_MS = 20_000;
export const SHUFFLE_MS = 6_000;
export const REVEAL_MS = 5_000;
const KEY = 'pinkCard:announced';
const memorySeen = new Set<string>();

/** Routes that host the global announcement: rooms and live watcher pages (never /live/start). */
export function isAnnouncementRoute(path: string): boolean {
  if (/^\/rooms\/[^/]+\/?$/.test(path)) return true;
  if (/^\/community\/chess\/[^/]+\/?$/.test(path)) return true;
  const m = path.match(/^\/live\/([^/]+)\/?$/);
  return Boolean(m && m[1] !== 'start');
}

export function isFreshDraw(drawnAt: string, now: number): boolean {
  const t = Date.parse(drawnAt);
  return Number.isFinite(t) && now - t >= -5_000 && now - t <= FRESH_WINDOW_MS;
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
function read(store: Store): string[] {
  try { const v = JSON.parse(store?.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function hasAnnounced(store: Store, id: string) { return memorySeen.has(id) || read(store).includes(id); }
/** Marks once; returns false if already marked (so the caller skips). */
export function markAnnounced(store: Store, id: string): boolean {
  const list = read(store);
  if (memorySeen.has(id) || list.includes(id)) return false;
  memorySeen.add(id);
  try { store?.setItem(KEY, JSON.stringify([...list, id].slice(-20))); } catch { /* storage blocked */ }
  return true;
}
export function safeSession(): Store {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}
