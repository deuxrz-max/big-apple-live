export const NYC_BACKGROUND_VIDEO_SLOTS = [
  { id: 'nyc-01', fileName: 'nyc-background-1.mp4' },
  { id: 'nyc-02', fileName: 'nyc-background-2.mp4' },
  { id: 'nyc-03', fileName: 'nyc-background-3.mp4' },
  { id: 'nyc-04', fileName: 'nyc-background-4.mp4' },
  { id: 'nyc-05', fileName: 'nyc-background-5.mp4' },
  { id: 'nyc-06', fileName: 'nyc-background-6.mp4' },
] as const;

export type NycBackgroundSlot = {
  id: string;
  src: string | null;
};

export type NycBackgroundManifest = {
  videos?: unknown;
};

function assetUrl(src: string, baseUrl: string): string | null {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed || /^[a-z]+:/i.test(trimmed) || trimmed.startsWith('//')) return null;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${trimmed.replace(/^\/+/, '')}`;
}

/** Enable the set only when all six real source URLs are configured. */
export function configuredNycBackgroundVideos(manifest: NycBackgroundManifest, baseUrl = '/'): string[] {
  if (!Array.isArray(manifest.videos) || manifest.videos.length !== NYC_BACKGROUND_VIDEO_SLOTS.length) return [];

  const slots = manifest.videos as NycBackgroundSlot[];
  const sources: string[] = [];
  for (const [index, expected] of NYC_BACKGROUND_VIDEO_SLOTS.entries()) {
    const slot = slots[index];
    if (!slot || slot.id !== expected.id || typeof slot.src !== 'string') return [];
    const src = assetUrl(slot.src, baseUrl);
    if (!src) return [];
    sources.push(src);
  }
  return sources;
}

export async function loadNycBackgroundVideos(baseUrl: string): Promise<string[]> {
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const response = await fetch(`${base}nyc-backgrounds/manifest.json`, { cache: 'no-store' });
    if (!response.ok) return [];
    return configuredNycBackgroundVideos(await response.json() as NycBackgroundManifest, base);
  } catch {
    return [];
  }
}

export function pickRandomHomeBackground(videos: readonly string[], random = Math.random()): string | null {
  if (videos.length !== NYC_BACKGROUND_VIDEO_SLOTS.length) return null;
  const value = Number.isFinite(random) ? Math.min(0.999999999, Math.max(0, random)) : 0;
  return videos[Math.floor(value * videos.length)] ?? null;
}

/**
 * Room codes are generated from random bytes. Hashing that code gives every
 * viewer the same random-looking clip for the room without adding DB state.
 */
export function pickRoomBackground(roomId: string, roomType: string | undefined, videos: readonly string[]): string | null {
  const normalizedId = roomId.trim().toUpperCase();
  if (roomType !== 'social' || normalizedId.startsWith('CHESS')
    || videos.length !== NYC_BACKGROUND_VIDEO_SLOTS.length) return null;

  let hash = 0x811c9dc5;
  for (let i = 0; i < normalizedId.length; i += 1) {
    hash ^= normalizedId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return videos[(hash >>> 0) % videos.length] ?? null;
}
