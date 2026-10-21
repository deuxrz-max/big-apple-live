const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export const CARD_TEST_SUITS = [
  { code: "C", symbol: "♣", name: "clubs", wildMark: "♛" },
  { code: "D", symbol: "♦", name: "diamonds", wildMark: "W✦" },
  { code: "H", symbol: "♥", name: "hearts", wildMark: "♕" },
  { code: "S", symbol: "♠", name: "spades", wildMark: "𝕎" },
] as const;

export function getCardTestFace(code: string) {
  const suit = CARD_TEST_SUITS.find(item => code.endsWith(item.code));
  const rank = code.slice(0, -1);
  if (!suit || !RANKS.includes(rank as typeof RANKS[number])) return null;
  return { code, rank, suit: suit.code, symbol: suit.symbol, suitName: suit.name,
    isWild: rank === "2", wildMark: rank === "2" ? suit.wildMark : null };
}

export function createCardTestFaces() {
  return RANKS.flatMap(rank => CARD_TEST_SUITS.map(suit =>
    getCardTestFace(`${rank}${suit.code}`)!,
  ));
}
