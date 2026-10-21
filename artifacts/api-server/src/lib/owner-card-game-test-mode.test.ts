import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDeck } from "./room-card-game-policy";
import {
  OWNER_CARD_TEST_DEAL_INTERVAL_MS,
  OWNER_CARD_TEST_WINNER_DISPLAY_MS,
  OwnerCardGameTestMode,
} from "./owner-card-game-test-mode";

const context = { key: "room:owner-room:1", eligible: true, seatNumber: 1 };
const shuffled = () => [...createDeck()].reverse();
const routeSource = readFileSync("src/routes/room-card-games.ts", "utf8");

test("a fresh server process starts the private card test switched off", () => {
  const mode = new OwnerCardGameTestMode(shuffled);
  assert.equal(mode.isEnabledFor("owner"), false);
});

test("owner-only test mode waits one minute per card, deals unique cards, and stops after winner acknowledgement", () => {
  const mode = new OwnerCardGameTestMode(shuffled);
  const ownerId = "owner-account";
  const otherId = "another-account";
  const start = 1_000_000;

  assert.equal(mode.setEnabled(ownerId, true), true);
  assert.equal(mode.isEnabledFor(otherId), false);
  assert.equal(mode.getState({
    accountId: otherId, username: "viewer", context, nowMs: start,
  }).enabled, false);

  let state = mode.getState({ accountId: ownerId, username: "vampsquad", context, nowMs: start });
  assert.equal(state.cardsDealt, 0);
  for (let deal = 1; deal <= 5; deal++) {
    const nowMs = start + OWNER_CARD_TEST_DEAL_INTERVAL_MS * deal;
    state = mode.getState({ accountId: ownerId, username: "vampsquad", context, nowMs });
    assert.equal(state.cardsDealt, deal);
    assert.equal(new Set(state.cards.map(card => card.code)).size, deal);
  }
  assert.ok(state.winnerMoment);
  assert.equal(state.winnerMoment.username, "vampsquad");
  assert.ok(state.winnerMoment.handName.length > 0);
  assert.equal(mode.acknowledgeWinner({
    accountId: ownerId, contextKey: context.key, winnerId: state.winnerMoment.id,
    nowMs: state.winnerMoment.startedAtMs + OWNER_CARD_TEST_WINNER_DISPLAY_MS - 1,
  }), false);
  assert.equal(mode.acknowledgeWinner({
    accountId: ownerId, contextKey: context.key, winnerId: state.winnerMoment.id,
    nowMs: state.winnerMoment.startedAtMs + OWNER_CARD_TEST_WINNER_DISPLAY_MS,
  }), true);
  assert.equal(mode.isEnabledFor(ownerId), false);
});

test("an ineligible room hides cards and pauses the owner test", () => {
  const mode = new OwnerCardGameTestMode(shuffled);
  const start = 2_000_000;
  mode.setEnabled("owner", true);
  const first = mode.getState({ accountId: "owner", username: "vampsquad", context, nowMs: start });
  assert.equal(first.cardsDealt, 0);
  const ineligible = mode.getState({
    accountId: "owner", username: "vampsquad",
    context: { key: context.key, eligible: false, message: "Only the owner is in the room." },
    nowMs: start + 30_000,
  });
  assert.deepEqual(ineligible.cards, []);
  assert.equal(ineligible.eligible, false);
  const resumed = mode.getState({ accountId: "owner", username: "vampsquad", context, nowMs: start + 90_000 });
  assert.equal(resumed.cardsDealt, 1);
});

test("unacknowledged winner moments retry with a fresh shuffled deck and no payout path", () => {
  const mode = new OwnerCardGameTestMode(shuffled);
  const start = 3_000_000;
  mode.setEnabled("owner", true);
  let state = mode.getState({ accountId: "owner", username: "vampsquad", context, nowMs: start });
  for (let deal = 1; deal <= 5; deal++) {
    state = mode.getState({
      accountId: "owner", username: "vampsquad", context,
      nowMs: start + OWNER_CARD_TEST_DEAL_INTERVAL_MS * deal,
    });
  }
  const firstAttempt = state.attempt;
  const retryAt = state.winnerMoment!.startedAtMs + 15_000;
  state = mode.getState({
    accountId: "owner", username: "vampsquad", context,
    nowMs: retryAt,
  });
  assert.equal(state.attempt, firstAttempt + 1);
  assert.deepEqual(state.cards, []);
  assert.equal(state.nextDealAtMs, retryAt + OWNER_CARD_TEST_DEAL_INTERVAL_MS);
  assert.equal(mode.isEnabledFor("owner"), true);
});

test("the HTTP control is development-only and calls the existing owner authorization", () => {
  assert.match(routeSource, /process\.env\.NODE_ENV !== "development"/);
  assert.match(routeSource, /await requireOwner\(id\)/);
  assert.match(routeSource, /router\.patch\(\"\/owner\/card-games\/test-mode\"/);
  assert.doesNotMatch(routeSource, /broadcast/);
});
