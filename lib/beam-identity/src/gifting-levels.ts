/** Successful outgoing gift coin value is the sole source of gifter XP. */
const INCREMENTS = [
  200,250,350,400,450,550,600,650,750,
  800,1000,1200,1300,1500,1600,1800,1900,2100,2300,2400,2600,2700,2900,3100,3200,3400,3500,3700,3800,
  4000,4500,4900,5300,5600,6000,6400,6800,7200,7500,7900,8300,8700,9100,9400,9800,10200,10600,10900,11300,11700,12100,12500,12800,13200,13600,14000,14400,14700,15100,
  15500,16000,17700,19300,21000,22600,24300,25900,27600,29200,30900,32600,34200,35900,37500,39200,40800,42500,44100,45800,47400,49100,50800,52400,54100,55700,57400,59000,60700,62300,
  64000,70000,92500,115000,138000,160000,182000,205000,228000,250000,
] as const;

export function giftingTier(level: number) {
  if (level >= 91) return { name: "Deux Wild", key: "deux-wild", color: "#39FF14", rank: 5 };
  if (level >= 61) return { name: "Platinum", key: "platinum", color: "#D9F2FF", rank: 4 };
  if (level >= 31) return { name: "Gold", key: "gold", color: "#E7BC58", rank: 3 };
  if (level >= 11) return { name: "Silver", key: "silver", color: "#D8DFE8", rank: 2 };
  if (level >= 1) return { name: "Bronze", key: "bronze", color: "#CD925C", rank: 1 };
  return { name: "Unranked", key: "unranked", color: "#FFFFFF", rank: 0 };
}

/** Level 1 unlocks at the first positive XP; supplied higher totals start at zero. */
export const GIFTING_LEVEL_THRESHOLDS: readonly number[] = [
  0, 1, ...INCREMENTS.reduce<number[]>((totals, increment) => {
    totals.push((totals.at(-1) ?? 0) + increment);
    return totals;
  }, []),
];

export function giftingProgress(value: number) {
  const xp = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  let level = 0;
  for (let i = 1; i <= 100; i++) {
    if (xp >= GIFTING_LEVEL_THRESHOLDS[i]!) level = i;
  }
  const threshold = GIFTING_LEVEL_THRESHOLDS[level]!;
  const nextThreshold = level < 100 ? GIFTING_LEVEL_THRESHOLDS[level + 1]! : null;
  // Level 1 has no XP cost; preserve the owner's cumulative XP milestones.
  const progressBase = level === 1 ? 0 : threshold;
  return {
    level, xp, tier: giftingTier(level), nextThreshold,
    currentLevelXp: nextThreshold === null ? 0 : xp - progressBase,
    xpForNextLevel: nextThreshold === null ? 0 : nextThreshold - progressBase,
    xpRemaining: nextThreshold === null ? 0 : nextThreshold - xp,
  };
}
