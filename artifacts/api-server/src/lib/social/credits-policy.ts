/** Shared for ordinary wallet actions, exclusive only during explicit launch reset. */
export const TEST_COIN_LIFECYCLE_LOCK = "coin-test-lifecycle";

export function planCreditSpend(balance: number, cost: number, unlimited: boolean) {
  return {
    allowed: unlimited || balance >= cost,
    debit: unlimited ? 0 : cost,
  };
}
