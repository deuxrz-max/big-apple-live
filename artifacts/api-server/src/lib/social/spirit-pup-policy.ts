/** Change the price here. The recipient gets half, rounded down; the house gets the remainder. */
export const SPIRIT_PUP = { id: 'spirit-pup', name: 'Spirit Pup', cost: 100, durationMs: 4000 } as const;
export function spiritSplit(cost: number = SPIRIT_PUP.cost) {
  const recipientCredits = Math.floor(cost / 2);
  return { recipientCredits, houseCredits: cost - recipientCredits };
}
