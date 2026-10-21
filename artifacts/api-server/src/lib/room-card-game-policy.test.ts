import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_GAME_EPOCH_MS, CARD_GAME_PERIOD_MS, CARD_DEAL_INTERVAL_MS,
  cardGameClock, cardGamePrizeEligible, compareHandScores, createDeck, dealCardsForSeats, scoreFiveCardHand,
  securelyShuffledDeck, splitRoomPrize,
} from "./room-card-game-policy";

test("one fixed 75-minute app clock drives every room and boundary deal", () => {
  assert.equal(cardGameClock(CARD_GAME_EPOCH_MS).gameNumber, 1);
  assert.equal(cardGameClock(CARD_GAME_EPOCH_MS + 14 * 60_000).cardsDealt, 0);
  const atFirstDeal = cardGameClock(CARD_GAME_EPOCH_MS + CARD_DEAL_INTERVAL_MS);
  assert.equal(atFirstDeal.cardsDealt, 1);
  assert.equal(atFirstDeal.nextDealAtMs, CARD_GAME_EPOCH_MS + 2 * CARD_DEAL_INTERVAL_MS);
  const atBoundary = cardGameClock(CARD_GAME_EPOCH_MS + CARD_GAME_PERIOD_MS);
  assert.equal(atBoundary.gameNumber, 2);
  assert.equal(atBoundary.cardsDealt, 0);
  assert.equal(atBoundary.gameStartMs, CARD_GAME_EPOCH_MS + CARD_GAME_PERIOD_MS);
});

test("one securely shuffled 52-card deck deals fifty distinct cards for ten seats", () => {
  const deck = securelyShuffledDeck(max => max - 1);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  assert.deepEqual([...deck].sort(), [...createDeck()].sort());
  const seats = Array.from({ length: 10 }, (_, i) => ({ seatNumber: i + 1, accountId: `player-${i}` }));
  const all = Array.from({ length: 5 }, (_, index) => dealCardsForSeats(deck, index * 10, seats)).flat();
  assert.equal(all.length, 50);
  assert.equal(new Set(all.map(card => card.cardCode)).size, 50);
});

test("scores every hand category from best to worst, including all wild-twos", () => {
  const hands = [
    ["AS", "AH", "AD", "AC", "2S"],
    ["9S", "10S", "JS", "QS", "2H"],
    ["AS", "AH", "AD", "AC", "KS"],
    ["AS", "AH", "KC", "KH", "2D"],
    ["AS", "JS", "8S", "4S", "2H"],
    ["AS", "3H", "4D", "5C", "2D"],
    ["AS", "AH", "AD", "KC", "QD"],
    ["AS", "AH", "KC", "KH", "QD"],
    ["AS", "AH", "KC", "QD", "JD"],
    ["AS", "KH", "QD", "JC", "9S"],
  ].map(scoreFiveCardHand);
  assert.deepEqual(hands.map(hand => hand.category), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(hands[5]!.tieBreak[0], 5, "Ace-low straight is five-high");
  assert.equal(scoreFiveCardHand(["10S", "JH", "QD", "KC", "AS"]).category, 4);
  assert.equal(scoreFiveCardHand(["AS", "KH", "QD", "JC", "2C"]).category, 4);
  assert.equal(compareHandScores(
    scoreFiveCardHand(["10S", "JH", "QD", "KC", "AS"]),
    scoreFiveCardHand(["AS", "KH", "QD", "JC", "2C"]),
  ), 0, "a wild hand matching a natural hand ties it");
  assert.equal(scoreFiveCardHand(["2C", "2D", "2H", "2S", "3C"]).category, 9);
});

test("ties split exactly one hundred coins in host-relative seat order", () => {
  const three = splitRoomPrize([
    { accountId: "a", username: "A", seatNumber: 2 },
    { accountId: "b", username: "B", seatNumber: 3 },
    { accountId: "c", username: "C", seatNumber: 7 },
  ], 3);
  assert.deepEqual(three.map(winner => [winner.accountId, winner.coins]), [["b", 34], ["c", 33], ["a", 33]]);
  const two = splitRoomPrize([
    { accountId: "a", username: "A", seatNumber: 1 },
    { accountId: "b", username: "B", seatNumber: 8 },
  ], 1);
  assert.deepEqual(two.map(winner => winner.coins), [50, 50]);
  const shares = splitRoomPrize(Array.from({ length: 10 }, (_, i) => ({
    accountId: String(i), username: `P${i}`, seatNumber: i + 1,
  })), 7);
  assert.equal(shares.reduce((total, share) => total + share.coins, 0), 100);
  assert.deepEqual(shares.slice(0, 10).map(share => share.seatNumber), [7, 8, 9, 10, 1, 2, 3, 4, 5, 6]);
});

test("prizes require three eligible accounts and are not available to smaller games", () => {
  assert.equal(cardGamePrizeEligible(0), false);
  assert.equal(cardGamePrizeEligible(1), false);
  assert.equal(cardGamePrizeEligible(2), false);
  assert.equal(cardGamePrizeEligible(3), true);
  assert.equal(cardGamePrizeEligible(10), true);
  assert.equal(cardGamePrizeEligible(3.5), false);
});
