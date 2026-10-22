const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export const CARD_TEST_SUITS = [
  { code: "C", symbol: "♣", name: "clubs" },
  { code: "D", symbol: "♦", name: "diamonds" },
  { code: "H", symbol: "♥", name: "hearts" },
  { code: "S", symbol: "♠", name: "spades" },
] as const;

export function getCardTestFace(code: string) {
  const joker = /^joker-wild-([1-4])$/.exec(code);
  if (joker) return {
    code, rank: "Joker", suit: null, symbol: "", suitName: "",
    isWild: true, wildMark: `Joker ${joker[1]}`,
    label: `Joker ${joker[1]}, wild`,
    imagePath: `api/card-deck/${code}.png`,
  };
  const suit = CARD_TEST_SUITS.find(item => code.endsWith(item.code));
  const rank = code.slice(0, -1);
  if (!suit || !RANKS.includes(rank as typeof RANKS[number])) return null;
  return {
    code, rank, suit: suit.code, symbol: suit.symbol, suitName: suit.name,
    isWild: false, wildMark: null, label: `${rank} of ${suit.name}`,
    imagePath: `api/card-deck/${rank}-${suit.name}.png`,
  };
}

export function createCardTestFaces() {
  return [
    ...RANKS.flatMap(rank => CARD_TEST_SUITS.map(suit => getCardTestFace(`${rank}${suit.code}`)!)),
    ...[1, 2, 3, 4].map(id => getCardTestFace(`joker-wild-${id}`)!),
  ];
}
