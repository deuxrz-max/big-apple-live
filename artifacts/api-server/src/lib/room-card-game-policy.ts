import { randomInt } from "node:crypto";

export const CARD_GAME_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
export const CARD_GAME_PERIOD_MS = 75 * 60_000;
export const CARD_DEAL_INTERVAL_MS = 15 * 60_000;
export const CARD_GAME_SEAT_LIMIT = 9;
export const CARD_GAME_PRIZE = 100;
export const CARD_GAME_DAILY_WIN_CAP = 500;
export const CARD_GAME_MAX_POT = 500;
export const CARD_RECONNECT_GRACE_MS = 90_000;

export function cardGamePrizeEligible(playerCount: number): boolean {
  return Number.isInteger(playerCount) && playerCount >= 3;
}

export type CardGameClock = {
  serverNowMs: number;
  gameNumber: number;
  gameStartMs: number;
  cardsDealt: number;
  nextDealAtMs: number | null;
  nextGameStartMs: number;
};

export function cardGameClock(nowMs = Date.now(), epochMs = CARD_GAME_EPOCH_MS): CardGameClock {
  const elapsed = Math.max(0, nowMs - epochMs);
  const completedGames = Math.floor(elapsed / CARD_GAME_PERIOD_MS);
  const gameStartMs = epochMs + completedGames * CARD_GAME_PERIOD_MS;
  const withinGameMs = nowMs - gameStartMs;
  const cardsDealt = Math.min(5, Math.floor(withinGameMs / CARD_DEAL_INTERVAL_MS));
  const nextDealAtMs = cardsDealt < 5
    ? gameStartMs + (cardsDealt + 1) * CARD_DEAL_INTERVAL_MS
    : null;
  return {
    serverNowMs: nowMs,
    gameNumber: completedGames + 1,
    gameStartMs,
    cardsDealt,
    nextDealAtMs,
    nextGameStartMs: gameStartMs + CARD_GAME_PERIOD_MS,
  };
}

export type PlayingCard = { rank: number; suit: "C" | "D" | "H" | "S" | null; jokerId?: number };

const RANK_CODES = ["", "", "", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const CARD_CODE_RANK = new Map<string, number>(
  RANK_CODES.flatMap((code, rank) => code ? [[code, rank] as const] : []),
);
const SUITS = ["C", "D", "H", "S"] as const;

export function createDeck(): string[] {
  const cards: string[] = [];
  for (let rank = 3; rank <= 14; rank++) {
    for (const suit of SUITS) cards.push(`${RANK_CODES[rank]}${suit}`);
  }
  return [...cards, ...[1, 2, 3, 4].map(id => `joker-wild-${id}`)];
}

export function securelyShuffledDeck(randomIndex: (maxExclusive: number) => number = max => randomInt(max)): string[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("Invalid secure shuffle index");
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

export function parseCardCode(code: string): PlayingCard {
  const joker = /^joker-wild-([1-4])$/.exec(code);
  if (joker) return { rank: 0, suit: null, jokerId: Number(joker[1]) };
  const match = /^(10|[3-9JQKA])([CDHS])$/.exec(code);
  if (!match) throw new Error("Invalid playing card");
  const rank = CARD_CODE_RANK.get(match[1]!);
  if (rank === undefined) throw new Error("Invalid playing card");
  return { rank, suit: match[2] as PlayingCard["suit"] };
}

export type HandScore = { category: number; categoryName: string; tieBreak: number[] };
const HAND_NAMES = [
  "high card", "pair", "two pair", "three of a kind", "straight", "flush",
  "full house", "four of a kind", "straight flush", "five of a kind",
];

function straightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.length !== 5) return null;
  if (unique[0]! - unique[4]! === 4) return unique[0]!;
  if (unique.join(",") === "14,5,4,3,2") return 5;
  return null;
}

function scoreAssignedRanks(ranks: number[], flushAllowed: boolean): HandScore {
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const countsOnly = groups.map(([, count]) => count);
  const byRank = [...ranks].sort((a, b) => b - a);
  const straight = straightHigh(ranks);
  let category = 0;
  let tieBreak = byRank;

  if (countsOnly[0] === 5) {
    category = 9;
    tieBreak = [groups[0]![0]];
  } else if (flushAllowed && straight !== null) {
    category = 8;
    tieBreak = [straight];
  } else if (countsOnly[0] === 4) {
    category = 7;
    tieBreak = [groups[0]![0], groups[1]![0]];
  } else if (countsOnly[0] === 3 && countsOnly[1] === 2) {
    category = 6;
    tieBreak = [groups[0]![0], groups[1]![0]];
  } else if (flushAllowed) {
    category = 5;
    tieBreak = byRank;
  } else if (straight !== null) {
    category = 4;
    tieBreak = [straight];
  } else if (countsOnly[0] === 3) {
    category = 3;
    tieBreak = [groups[0]![0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  } else if (countsOnly[0] === 2 && countsOnly[1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
    category = 2;
    tieBreak = [...pairs, groups.find(([, count]) => count === 1)![0]];
  } else if (countsOnly[0] === 2) {
    category = 1;
    tieBreak = [groups[0]![0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  }

  return { category, categoryName: HAND_NAMES[category]!, tieBreak };
}

export function compareHandScores(left: HandScore, right: HandScore): number {
  if (left.category !== right.category) return left.category - right.category;
  const length = Math.max(left.tieBreak.length, right.tieBreak.length);
  for (let i = 0; i < length; i++) {
    const delta = (left.tieBreak[i] ?? 0) - (right.tieBreak[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

/** Try every rank assignment for Jokers, including two for ace-low straights. */
export function scoreFiveCardHand(codes: string[]): HandScore {
  if (codes.length !== 5) throw new Error("A hand must contain exactly five cards");
  const cards = codes.map(parseCardCode);
  if (new Set(codes).size !== 5) throw new Error("A hand cannot contain a repeated physical card");
  const wildCount = cards.filter(card => card.jokerId !== undefined).length;
  const naturals = cards.filter(card => card.jokerId === undefined);
  const naturalRanks = naturals.map(card => card.rank);
  const flushAllowed = naturals.length < 2 || naturals.every(card => card.suit === naturals[0]!.suit);
  let best: HandScore | null = null;

  const visit = (assigned: number[], remaining: number) => {
    if (remaining > 0) {
      for (let rank = 2; rank <= 14; rank++) visit([...assigned, rank], remaining - 1);
      return;
    }
    const score = scoreAssignedRanks([...naturalRanks, ...assigned], flushAllowed);
    if (!best || compareHandScores(score, best) > 0) best = score;
  };
  visit([], wildCount);
  return best!;
}

export type PrizeWinner = { accountId: string; username: string; seatNumber: number };
export type PrizeShare = PrizeWinner & { coins: number };

/** Exact 100-coin room prize; remainder follows seat order from the host or seat 1. */
export function splitRoomPrize(
  winners: PrizeWinner[],
  hostSeatNumber: number | null = null,
  prizeGold = CARD_GAME_PRIZE,
): PrizeShare[] {
  if (!Number.isSafeInteger(prizeGold) || prizeGold < 0 || prizeGold > CARD_GAME_MAX_POT) {
    throw new Error("A card-game prize must be between 0 and 500 gold");
  }
  if (!winners.length) return [];
  const startSeat = hostSeatNumber ?? 1;
  const ordered = [...winners].sort((a, b) => {
    const aOffset = (a.seatNumber - startSeat + CARD_GAME_SEAT_LIMIT) % CARD_GAME_SEAT_LIMIT;
    const bOffset = (b.seatNumber - startSeat + CARD_GAME_SEAT_LIMIT) % CARD_GAME_SEAT_LIMIT;
    return aOffset - bOffset || a.accountId.localeCompare(b.accountId);
  });
  const base = Math.floor(prizeGold / ordered.length);
  let remainder = prizeGold - base * ordered.length;
  return ordered.map(winner => ({ ...winner, coins: base + (remainder-- > 0 ? 1 : 0) }));
}

export type CappedPrizeShare = PrizeShare & { unpaidGold: number };

/** Apply one account's already-paid daily card winnings to each share. */
export function applyDailyWinningsCap(
  shares: PrizeShare[],
  winningsByAccount: ReadonlyMap<string, number>,
  capGold = CARD_GAME_DAILY_WIN_CAP,
): CappedPrizeShare[] {
  if (!Number.isSafeInteger(capGold) || capGold < 0) throw new Error("Daily winnings cap must be nonnegative");
  return shares.map(share => {
    const alreadyWon = winningsByAccount.get(share.accountId) ?? 0;
    if (!Number.isSafeInteger(alreadyWon) || alreadyWon < 0) throw new Error("Daily winnings must be nonnegative");
    const paidGold = Math.min(share.coins, Math.max(0, capGold - alreadyWon));
    return { ...share, coins: paidGold, unpaidGold: share.coins - paidGold };
  });
}

/** Keep the next room pot at its 100-gold base plus no more than 400 carryover. */
export function nextRoomCardGameCarryover(unpaidGold: number): number {
  if (!Number.isSafeInteger(unpaidGold) || unpaidGold < 0) throw new Error("Unpaid prize must be nonnegative");
  return Math.min(CARD_GAME_MAX_POT - CARD_GAME_PRIZE, unpaidGold);
}

export function dealCardsForSeats(deck: string[], startIndex: number, seats: Array<{ seatNumber: number; accountId: string }>) {
  if (seats.length > CARD_GAME_SEAT_LIMIT) throw new Error("A room can have at most nine card seats");
  const ordered = [...seats].sort((a, b) => a.seatNumber - b.seatNumber);
  if (new Set(ordered.map(seat => seat.seatNumber)).size !== ordered.length) throw new Error("Card seat numbers must be unique");
  if (startIndex < 0 || startIndex + ordered.length > deck.length) throw new Error("The deck does not contain enough cards");
  return ordered.map((seat, index) => ({
    seatNumber: seat.seatNumber,
    accountId: seat.accountId,
    cardCode: deck[startIndex + index]!,
  }));
}
