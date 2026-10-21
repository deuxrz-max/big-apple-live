import {
  scoreFiveCardHand,
  securelyShuffledDeck,
} from "./room-card-game-policy";

export const OWNER_CARD_TEST_DEAL_INTERVAL_MS = 60_000;
export const OWNER_CARD_TEST_WINNER_DISPLAY_MS = 5_000;
const OWNER_CARD_TEST_ACK_GRACE_MS = 15_000;

export type OwnerCardTestContext = {
  key: string;
  eligible: boolean;
  message?: string;
  seatNumber?: number;
};

type WinnerMoment = {
  id: string;
  username: string;
  handName: string;
  startedAtMs: number;
};

type TestRun = {
  contextKey: string;
  deck: string[];
  cards: string[];
  attempt: number;
  nextDealAtMs: number;
  winnerMoment: WinnerMoment | null;
  paused: boolean;
};

export class OwnerCardGameTestMode {
  private enabledAccountId: string | null = null;
  private run: TestRun | null = null;

  constructor(private readonly createDeck = securelyShuffledDeck) {}

  setEnabled(accountId: string, enabled: boolean) {
    if (enabled) {
      this.enabledAccountId = accountId;
      this.run = null;
    } else if (!this.enabledAccountId || this.enabledAccountId === accountId) {
      this.enabledAccountId = null;
      this.run = null;
    }
    return this.enabledAccountId === accountId;
  }

  isEnabledFor(accountId: string) {
    return this.enabledAccountId === accountId;
  }

  getState(input: {
    accountId: string;
    username: string;
    context: OwnerCardTestContext;
    nowMs?: number;
  }) {
    const nowMs = input.nowMs ?? Date.now();
    const enabled = this.isEnabledFor(input.accountId);
    if (!enabled) {
      return {
        enabled: false,
        eligible: input.context.eligible,
        contextMessage: input.context.message ?? null,
        cards: [],
        cardsDealt: 0,
        nextDealAtMs: null,
        winnerMoment: null,
        attempt: 0,
        seatNumber: input.context.seatNumber ?? null,
      };
    }

    if (!input.context.eligible) {
      if (this.run?.contextKey === input.context.key && !this.run.paused) {
        this.run.paused = true;
        this.run.nextDealAtMs = nowMs + OWNER_CARD_TEST_DEAL_INTERVAL_MS;
      }
      return {
        enabled: true,
        eligible: false,
        contextMessage: input.context.message ?? "Open your own room while you are the only person, and take a speaker seat.",
        cards: [],
        cardsDealt: 0,
        nextDealAtMs: null,
        winnerMoment: null,
        attempt: this.run?.attempt ?? 0,
        seatNumber: null,
      };
    }

    if (!this.run || this.run.contextKey !== input.context.key) {
      this.startRun(input.context.key, nowMs, (this.run?.attempt ?? 0) + 1);
    }
    const run = this.run!;
    run.paused = false;

    if (run.winnerMoment && nowMs - run.winnerMoment.startedAtMs >= OWNER_CARD_TEST_ACK_GRACE_MS) {
      this.startRun(input.context.key, nowMs, run.attempt + 1);
    }
    const activeRun = this.run!;
    if (!activeRun.winnerMoment && nowMs >= activeRun.nextDealAtMs) {
      const card = activeRun.deck[activeRun.cards.length];
      if (!card) throw new Error("The owner test deck ran out of cards");
      activeRun.cards.push(card);
      if (activeRun.cards.length === 5) {
        const score = scoreFiveCardHand(activeRun.cards);
        activeRun.winnerMoment = {
          id: `${activeRun.attempt}:${nowMs}`,
          username: input.username,
          handName: score.categoryName,
          startedAtMs: nowMs,
        };
      } else {
        activeRun.nextDealAtMs = nowMs + OWNER_CARD_TEST_DEAL_INTERVAL_MS;
      }
    }

    return {
      enabled: true,
      eligible: true,
      contextMessage: null,
      cards: activeRun.cards.map((card, index) => ({ dealNumber: index + 1, code: card })),
      cardsDealt: activeRun.cards.length,
      nextDealAtMs: activeRun.winnerMoment ? null : activeRun.nextDealAtMs,
      winnerMoment: activeRun.winnerMoment,
      attempt: activeRun.attempt,
      seatNumber: input.context.seatNumber ?? null,
    };
  }

  acknowledgeWinner(input: {
    accountId: string;
    contextKey: string;
    winnerId: string;
    nowMs?: number;
  }) {
    const nowMs = input.nowMs ?? Date.now();
    const moment = this.run?.winnerMoment;
    if (this.enabledAccountId !== input.accountId || !moment
      || this.run?.contextKey !== input.contextKey || moment.id !== input.winnerId
      || nowMs - moment.startedAtMs < OWNER_CARD_TEST_WINNER_DISPLAY_MS) {
      return false;
    }
    this.enabledAccountId = null;
    this.run = null;
    return true;
  }

  private startRun(contextKey: string, nowMs: number, attempt: number) {
    const deck = this.createDeck();
    if (deck.length !== 52 || new Set(deck).size !== 52) {
      throw new Error("The owner test deck must contain 52 unique cards");
    }
    this.run = {
      contextKey,
      deck,
      cards: [],
      attempt,
      nextDealAtMs: nowMs + OWNER_CARD_TEST_DEAL_INTERVAL_MS,
      winnerMoment: null,
      paused: false,
    };
  }
}

export const ownerCardGameTestMode = new OwnerCardGameTestMode();
