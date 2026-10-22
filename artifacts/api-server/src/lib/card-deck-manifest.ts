export const CARD_DECK_MEDIA_VERSION = "uploaded-jokers-v1";
export const CARD_DECK_FILENAMES = [
  ...["spades", "hearts", "diamonds", "clubs"].flatMap(suit =>
    ["A", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map(rank => `${rank}-${suit}.png`)),
  ...[1, 2, 3, 4].map(id => `joker-wild-${id}.png`),
];
