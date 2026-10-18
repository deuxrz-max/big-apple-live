export const NAME_COLOR_STEP_COINS = 10_000;

// Preserve the existing color sequence and 10,000-coin thresholds. Keep edits
// to the name-color ladder centralized here.
export const NAME_COLOR_TIERS = [
  { name: "Pure White", color: "#FFFFFF" },
  { name: "Light Gray", color: "#E4E4E4" },
  { name: "Silver", color: "#C0C0C0" },
  { name: "Gold", color: "#FFD700" },
  { name: "Butter Yellow", color: "#EDEBAD" },
  { name: "Pure Yellow", color: "#FFFF00" },
  { name: "Cyan", color: "#00FFFF" },
  { name: "Light Cyan / Ice Blue", color: "#A8DADC" },
  { name: "Lime Green", color: "#00FF00" },
  { name: "Mint Green", color: "#98FF98" },
  { name: "Neon Pink / Hot Pink", color: "#FF0099" },
  { name: "Soft Pink / Dusty Rose", color: "#FFC1CC" },
  { name: "Lavender / Lilac", color: "#B39CD0" },
  { name: "Magenta", color: "#FF00FF" },
  { name: "Peach / Warm Coral", color: "#FFDAB9" },
  { name: "Sky Blue", color: "#87CEEB" },
  { name: "Amber", color: "#F39C12" },
  { name: "Light Beige / Cream", color: "#F5F5DC" },
  { name: "Electric Blue", color: "#09B0EC" },
] as const;

export type NameColorTierSummary = {
  tierIndex: number;
  tierName: string;
  color: string;
  lifetimeCoinsPurchased: number;
  coinsToNextTier: number;
  nextTierName: string | null;
  nextTierThreshold: number | null;
};

export function nameColorTierForLifetimeCoins(lifetimeCoinsPurchased: number): NameColorTierSummary {
  const safeCoins = Number.isFinite(lifetimeCoinsPurchased)
    ? Math.max(0, Math.floor(lifetimeCoinsPurchased))
    : 0;
  const index = Math.min(
    Math.floor(safeCoins / NAME_COLOR_STEP_COINS),
    NAME_COLOR_TIERS.length - 1,
  );
  const tier = NAME_COLOR_TIERS[index]!;
  const nextTier = NAME_COLOR_TIERS[index + 1];
  const nextTierThreshold = nextTier ? (index + 1) * NAME_COLOR_STEP_COINS : null;
  return {
    tierIndex: index,
    tierName: tier.name,
    color: tier.color,
    lifetimeCoinsPurchased: safeCoins,
    coinsToNextTier: nextTierThreshold === null ? 0 : Math.max(0, nextTierThreshold - safeCoins),
    nextTierName: nextTier?.name ?? null,
    nextTierThreshold,
  };
}
