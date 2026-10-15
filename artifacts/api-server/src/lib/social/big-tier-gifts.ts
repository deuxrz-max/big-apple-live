export const BIG_TIER_GIFTS = [
  { id: 'fireworks', name: 'Fireworks', cost: 2500, durationMs: 6042 },
  { id: 'rose-shower', name: 'Rose Shower', cost: 2500, durationMs: 6042 },
  { id: 'whip', name: 'Whip', cost: 2500, durationMs: 6042 },
] as const;

export type BigTierGiftId = (typeof BIG_TIER_GIFTS)[number]['id'];
