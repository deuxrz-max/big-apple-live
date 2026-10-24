export type CreditBundle = Readonly<{
  id: string; credits: number; baseCoins: number; bonusCoins: number;
  bonusBasisPoints: number; priceCents: number;
}>;

/** Display proposal ONLY. Never import this catalog into a payment/webhook grant. */
export const RECHARGE_PREVIEW_POLICY = Object.freeze({
  checkoutEnabled: false,
  bonusesApproved: false,
  processorFeesVerified: false,
  paymentMethods: ['card'] as const,
});

const PRICE_CENTS = [199, 699, 999, 1999, 2999, 4999, 9999, 39999, 99999, 199999, 299999] as const;
const BONUS_BASIS_POINTS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200] as const;

export const CREDIT_BUNDLES: readonly CreditBundle[] = Object.freeze(PRICE_CENTS.map((priceCents, index) => {
  const baseCoins = priceCents; // Exactly one US cent per base coin.
  const bonusBasisPoints = BONUS_BASIS_POINTS[index]!;
  const bonusCoins = Math.floor(baseCoins * bonusBasisPoints / 10_000);
  return Object.freeze({
    id: `credits-${baseCoins}`, baseCoins, bonusCoins, bonusBasisPoints,
    credits: baseCoins + bonusCoins, priceCents,
  });
}));

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Liability is total / 3 cents. Reserve rounds UP, never understates it. */
export function previewEconomics(bundle: CreditBundle, fees: {
  percentBasisPoints: number; fixedCents: number; otherKnownCents: number;
} | null = null) {
  if (!Number.isSafeInteger(bundle.credits) || bundle.credits < 0
    || !Number.isSafeInteger(bundle.priceCents) || bundle.priceCents < 0) throw new Error('Invalid package');
  if (fees && Object.values(fees).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid fees');
  const reserveCents = Math.ceil(bundle.credits / 3);
  const feeCents = fees === null ? null
    : Math.ceil(bundle.priceCents * fees.percentBasisPoints / 10_000) + fees.fixedCents + fees.otherKnownCents;
  return {
    liabilityThirdCents: bundle.credits,
    reserveCents,
    coinsPerUsd: bundle.credits * 100 / bundle.priceCents,
    feeCents,
    remainingCents: feeCents === null ? null : bundle.priceCents - reserveCents - feeCents,
  };
}
