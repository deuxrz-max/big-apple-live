/** Inclusive, cumulative successful gift-spending thresholds, never recharge totals. */
export const NAME_COLOR_TIERS = [
  { name: "Default", color: "#FFFFFF", threshold: 0 },
  { name: "Green", color: "#00FF00", threshold: 20_000 },
  { name: "Pink", color: "#FF0099", threshold: 100_000 },
  { name: "Purple", color: "#B39CD0", threshold: 250_000 },
  { name: "Yellow", color: "#FFFF00", threshold: 400_000 },
  { name: "Platinum", color: "#C0C0C0", threshold: 550_000 },
  { name: "Magenta", color: "#FF00FF", threshold: 800_000 },
] as const;

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
  const safeCoins = Number.isFinite(giftCoinsSpent) ? Math.max(0, Math.floor(giftCoinsSpent)) : 0;
  let index = 0;
  for (let i = 1; i < NAME_COLOR_TIERS.length; i++) {
    if (safeCoins >= NAME_COLOR_TIERS[i]!.threshold) index = i;
  }
  const tier = NAME_COLOR_TIERS[index]!;
  const next = NAME_COLOR_TIERS[index + 1];
  return {
    tierIndex: index, tierName: tier.name, color: tier.color,
    lifetimeCoinsPurchased: safeCoins,
    coinsToNextTier: next ? next.threshold - safeCoins : 0,
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
