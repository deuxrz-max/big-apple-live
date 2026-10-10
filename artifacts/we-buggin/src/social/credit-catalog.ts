export type CreditBundle = { id: string; credits: number; priceCents: number };

export const CREDIT_BUNDLES: readonly CreditBundle[] = [
  { id: 'credits-500', credits: 500, priceCents: 499 },
  { id: 'credits-1000', credits: 1000, priceCents: 899 },
  { id: 'credits-2500', credits: 2500, priceCents: 1799 },
];

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Approximate per-credit discount vs the smallest pack, as whole percent. */
export function savingsPercent(b: CreditBundle): number {
  const base = CREDIT_BUNDLES[0];
  const pct = (1 - (b.priceCents / b.credits) / (base.priceCents / base.credits)) * 100;
  return Math.max(0, Math.round(pct));
}
