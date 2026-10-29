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

export function shuffleHomeBackgroundVideos(
  videos: readonly string[],
  random: () => number = Math.random,
): string[] {
  if (videos.length !== NYC_BACKGROUND_VIDEO_SLOTS.length) return [];

  const shuffled = [...videos];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    const normalized = Number.isFinite(sample) ? Math.min(0.999999999, Math.max(0, sample)) : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function advanceHomeBackgroundPlaylist(
  videos: readonly string[],
  activePosition: number,
  random: () => number = Math.random,
): { videos: string[]; activePosition: number; nextPosition: number } {
  if (videos.length !== NYC_BACKGROUND_VIDEO_SLOTS.length
    || !Number.isInteger(activePosition)
    || activePosition < 0
    || activePosition >= videos.length) {
    throw new Error('Home background playlist requires six clips and a valid current position.');
  }

  if (activePosition < videos.length - 1) {
    return { videos: [...videos], activePosition, nextPosition: activePosition + 1 };
  }

  const currentVideo = videos[activePosition];
  const shuffled = shuffleHomeBackgroundVideos(videos, random);
  if (shuffled[0] === currentVideo) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  const nextActivePosition = shuffled.indexOf(currentVideo);
  return {
    videos: shuffled,
    activePosition: nextActivePosition,
    nextPosition: (nextActivePosition + 1) % shuffled.length,
  };
}
