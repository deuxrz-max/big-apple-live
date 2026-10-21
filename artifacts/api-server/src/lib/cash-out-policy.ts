export const CASH_OUT_SETTINGS = Object.freeze({
  minimumGold: 30_000,
  rateGold: 30_000,
  rateCents: 5_397,
  currency: "USD" as const,
});

export type CashOutQuote = { gold: number; cents: number; currency: "USD" };

/**
 * Quote at the configured linear rate, rounding once to the nearest cent with
 * integer arithmetic. This is a calculation only; it does not initiate a payout.
 */
export function quoteCashOutGold(gold: number): CashOutQuote | null {
  if (!Number.isSafeInteger(gold) || gold < 0) throw new Error("Gold amount must be a nonnegative whole number");
  if (gold < CASH_OUT_SETTINGS.minimumGold) return null;
  const numerator = BigInt(gold) * BigInt(CASH_OUT_SETTINGS.rateCents);
  const denominator = BigInt(CASH_OUT_SETTINGS.rateGold);
  const cents = Number((numerator + denominator / 2n) / denominator);
  return { gold, cents, currency: CASH_OUT_SETTINGS.currency };
}
