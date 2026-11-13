import { giftingProgress, giftingTier } from '@workspace/beam-identity';

/** Wire field `displayNameTierIndex`/`tierIndex` now carries the gifting level (0..100). */
export function normalizeGiftingLevel(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

export function tierRankOf(level: number | null | undefined) {
  return giftingTier(normalizeGiftingLevel(level)).rank;
}

/** Perks are cumulative by tier rank. */
export function giftingPerks(level: number | null | undefined) {
  const rank = tierRankOf(level);
  return {
    tierNameColor: rank >= 2,
  };
}

/** Legacy catalog flags no longer restrict gifts at any gifting level. */
export function isGiftLocked(_gift: unknown, _level: number | null | undefined): boolean {
  return false;
}

export function giftingLabel(level: number | null | undefined) {
  const l = normalizeGiftingLevel(level);
  return l === 0 ? 'No gifting level yet' : `${giftingTier(l).name} gifting level ${l}`;
}

/** Progress for profile display; level comes from the server, XP math from the shared module. */
export function profileGiftingProgress(serverLevel: number | null | undefined, xp: number) {
  const progress = giftingProgress(xp);
  const level = normalizeGiftingLevel(serverLevel ?? progress.level);
  return { ...progress, level, tier: giftingTier(level), isMax: level >= 100 };
}

/** Pure decision used by the level-up watcher; returns the level to celebrate or null. */
export function levelUpToCelebrate(previous: number | null, next: number): number | null {
  if (previous === null) return null;
  return next > previous ? next : null;
}
