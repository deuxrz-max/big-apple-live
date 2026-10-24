export const CASH_OUT_SETTINGS = Object.freeze({
  minimumGold: 30_000,
  rateGold: 30_000,
  rateCents: 10_000,
  currency: "USD" as const,
  payoutsEnabled: false,
  eligibleSource: "earned_units_only" as const,
});

export type CashOutQuote = { gold: number; cents: number; currency: "USD" };

/**
 * Calculation for verified earned units ONLY, never a spendable wallet balance,
 * purchased coins, daily reward counters or lifetime received totals.
 * Convert complete groups of 3 earned units to whole cents; 1–2 remainder units
 * stay unconverted. No payout or wallet debit is enabled.
 */
export function quoteCashOutGold(gold: number): CashOutQuote | null {
  if (!Number.isSafeInteger(gold) || gold < 0) throw new Error("Gold amount must be a nonnegative whole number");
  if (gold < CASH_OUT_SETTINGS.minimumGold) return null;
  const numerator = BigInt(gold) * BigInt(CASH_OUT_SETTINGS.rateCents);
  const denominator = BigInt(CASH_OUT_SETTINGS.rateGold);
  const cents = Number(numerator / denominator);
  return { gold, cents, currency: CASH_OUT_SETTINGS.currency };
}

/** Distinct source inputs: purchased coins cannot contribute to a cash-out quote.
 * This does not infer earned balances from the legacy mixed spendable wallet.
 * An eventual payout integration must supply a separately verified earned balance.
 */
export function quoteEarnedCashOut(balances: { purchasedCoins: number; earnedUnits: number }) {
  for (const amount of [balances.purchasedCoins, balances.earnedUnits]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Balances must be nonnegative whole numbers");
  }
  return quoteCashOutGold(balances.earnedUnits);
}
