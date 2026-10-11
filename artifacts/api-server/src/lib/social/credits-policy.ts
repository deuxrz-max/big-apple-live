export const DEVELOPMENT_UNLIMITED_CREDITS_USERNAME = "Vampsquad";

export function hasDevelopmentUnlimitedCredits(
  username: string | null | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development"
    && username?.toLocaleLowerCase("en-US") === DEVELOPMENT_UNLIMITED_CREDITS_USERNAME.toLocaleLowerCase("en-US");
}

export function planCreditSpend(balance: number, cost: number, unlimited: boolean) {
  return {
    allowed: unlimited || balance >= cost,
    debit: unlimited ? 0 : cost,
  };
}
