export const GIFT_NAME_COLOR_STEP_CREDITS = 10_000;

export const GIFT_NAME_COLOR_TIERS = [
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

export function giftNameTierForSentCredits(sentCredits: number) {
  const safeCredits = Number.isFinite(sentCredits) ? Math.max(0, Math.floor(sentCredits)) : 0;
  const index = Math.min(
    Math.floor(safeCredits / GIFT_NAME_COLOR_STEP_CREDITS),
    GIFT_NAME_COLOR_TIERS.length - 1,
  );
  return GIFT_NAME_COLOR_TIERS[index]!;
}

export function giftNameColorForSentCredits(sentCredits: number) {
  return giftNameTierForSentCredits(sentCredits).color;
}
