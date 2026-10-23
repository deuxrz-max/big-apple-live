import { giftingProgress, giftingTier, GIFTING_LEVEL_THRESHOLDS } from "@workspace/beam-identity";

/** Compatibility name; indices are now actual gifter levels 0–100. */
export const NAME_COLOR_TIERS = GIFTING_LEVEL_THRESHOLDS.map((threshold, level) => ({
  name: level ? `${giftingTier(level).name} · Level ${level}` : "Unranked",
  color: giftingTier(level).color,
  threshold,
}));

export type NameColorTierSummary = {
  tierIndex: number;
  tierName: string;
  color: string;
  /** Legacy wire-field name; now contains successful outgoing gift coin value. */
  lifetimeCoinsPurchased: number;
  coinsToNextTier: number;
  nextTierName: string | null;
  nextTierThreshold: number | null;
};

export function nameColorTierForLifetimeCoins(giftCoinsSpent: number): NameColorTierSummary {
  const progress = giftingProgress(giftCoinsSpent);
  const tier = NAME_COLOR_TIERS[progress.level]!;
  const next = NAME_COLOR_TIERS[progress.level + 1];
  return {
    tierIndex: progress.level, tierName: tier.name, color: tier.color,
    lifetimeCoinsPurchased: progress.xp,
    coinsToNextTier: progress.xpRemaining,
    nextTierName: next?.name ?? null,
    nextTierThreshold: next?.threshold ?? null,
  };
}

/** Existing username colors are independent of gifting-level logo colors. */
const LEGACY_USERNAME_COLORS = [
  "#FFFFFF", "#E4E4E4", "#C0C0C0", "#FFD700", "#EDEBAD", "#FFFF00",
  "#00FFFF", "#A8DADC", "#00FF00", "#98FF98", "#FF0099", "#FFC1CC",
  "#B39CD0", "#FF00FF", "#FFDAB9", "#87CEEB", "#F39C12", "#F5F5DC", "#09B0EC",
] as const;
export function existingUsernameColor(purchasedCoins: number): string {
  return LEGACY_USERNAME_COLORS[Math.min(Math.max(0, Math.floor(purchasedCoins / 10_000)), 18)]!;
}
