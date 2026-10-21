import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountProfiles, db, roomCardGameDailyWinnings, roomCardGamePots, socialLedger, socialWallets,
} from "@workspace/db";
import {
  roomCardGameDeals, roomCardGameResults, roomCardGameRuns,
  roomCardGameSeats, roomCardGameSettings,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { RoomError, roomStore } from "./room-store";
import { lockAccounts } from "./social/core";
import { universityVideoBeamStore } from "./university-video-beam";
import { easternHangoutDayKey } from "./community-hangout-policy";
import {
  CARD_DEAL_INTERVAL_MS, CARD_GAME_DAILY_WIN_CAP, CARD_GAME_MAX_POT, CARD_GAME_PERIOD_MS, CARD_GAME_SEAT_LIMIT,
  CARD_GAME_PRIZE, CARD_RECONNECT_GRACE_MS, applyDailyWinningsCap,
  cardGameClock, cardGamePrizeEligible, compareHandScores, dealCardsForSeats, nextRoomCardGameCarryover,
  parseCardCode, scoreFiveCardHand, securelyShuffledDeck, splitRoomPrize, type PrizeWinner,
} from "./room-card-game-policy";

const SETTINGS_ID = "global";
const CARD_GAME_TICK_MS = 5_000;
const CARD_DEAL_SCHEDULER_GRACE_MS = CARD_GAME_TICK_MS * 2;
type GameSettings = {
  id: string;
  dealsEnabled: boolean;
  payoutsEnabled: boolean;
  cardDisplayEnabled: boolean;
  dealsEnabledAt: Date | null;
  dailyWinningsCap: number;
};

async function getSettings(): Promise<GameSettings> {
  await db.insert(roomCardGameSettings).values({ id: SETTINGS_ID }).onConflictDoNothing();
  const [settings] = await db.select().from(roomCardGameSettings)
    .where(eq(roomCardGameSettings.id, SETTINGS_ID)).limit(1);
  if (!settings) throw new Error("Card-game settings are unavailable");
  return { ...settings, dailyWinningsCap: CARD_GAME_DAILY_WIN_CAP };
}

async function lockRoomCardGame(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"card-game-room:" + roomId}, 0))`);
}

async function ensureGame(roomId: string, gameNumber: number, gameStartMs: number) {
  await db.transaction(async tx => {
    await lockRoomCardGame(tx, roomId);
    await tx.insert(roomCardGamePots).values({ roomId }).onConflictDoNothing();
    await tx.insert(roomCardGameRuns).values({
      roomId, gameNumber, gameStartAt: new Date(gameStartMs), deck: securelyShuffledDeck(),
    }).onConflictDoNothing();
  });
}

async function lockInFirstDealSeats(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
  gameNumber: number,
) {
  const slots = universityVideoBeamStore.getState(roomId).slots
    .filter(slot => slot.participantId !== null)
    .sort((a, b) => a.slotNumber - b.slotNumber)
    .slice(0, CARD_GAME_SEAT_LIMIT);
  if (!slots.length) return;
  const candidates = slots.flatMap(slot => {
    if (!slot.participantId) return [];
    const accountId = universityVideoBeamStore.accountIdForParticipant(roomId, slot.participantId);
    return accountId ? [{ seatNumber: slot.slotNumber, accountId }] : [];
  });
  if (!candidates.length) return;
  const profiles = await tx.select({
    accountId: accountProfiles.accountId, isTestAccount: accountProfiles.isTestAccount,
  }).from(accountProfiles).where(inArray(accountProfiles.accountId, candidates.map(row => row.accountId)));
  const realAccountIds = new Set(profiles.filter(profile => !profile.isTestAccount).map(profile => profile.accountId));
  const seats = candidates.filter(candidate => realAccountIds.has(candidate.accountId));
  if (seats.length) {
    await tx.insert(roomCardGameSeats).values(seats.map(seat => ({
      roomId, gameNumber, ...seat, status: "active" as const,
    }))).onConflictDoNothing();
  }
}

async function updateSeatPresence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
  gameNumber: number,
  now: Date,
) {
  const active = await tx.select().from(roomCardGameSeats).where(and(
    eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
    eq(roomCardGameSeats.status, "active"),
  ));
  for (const seat of active) {
    if (roomStore.hasAccountMember(roomId, seat.accountId)) {
      if (seat.graceUntil) {
        await tx.update(roomCardGameSeats).set({ graceUntil: null }).where(and(
          eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
          eq(roomCardGameSeats.accountId, seat.accountId),
        ));
      }
    } else if (!seat.graceUntil) {
      await tx.update(roomCardGameSeats).set({ graceUntil: new Date(now.getTime() + CARD_RECONNECT_GRACE_MS) })
        .where(and(
          eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
          eq(roomCardGameSeats.accountId, seat.accountId),
        ));
    } else if (seat.graceUntil.getTime() <= now.getTime()) {
      await tx.update(roomCardGameSeats).set({ status: "out", graceUntil: null }).where(and(
        eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
        eq(roomCardGameSeats.accountId, seat.accountId),
      ));
    }
  }
}

async function recordVoid(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
  gameNumber: number,
  reason: string,
) {
  const [pot] = await tx.select({ carryoverGold: roomCardGamePots.carryoverGold }).from(roomCardGamePots)
    .where(eq(roomCardGamePots.roomId, roomId)).limit(1);
  await tx.update(roomCardGameRuns).set({
    status: "void", voidReason: reason, updatedAt: new Date(),
  }).where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
  await tx.update(roomCardGameSeats).set({ status: "out", graceUntil: null }).where(and(
    eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
    eq(roomCardGameSeats.status, "active"),
  ));
  await tx.insert(roomCardGameResults).values({
    roomId, gameNumber, status: "void", carryoverGold: pot?.carryoverGold ?? 0,
    announcement: "The card game was voided. No prize was paid.",
  }).onConflictDoNothing();
}

async function settleGame(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
  gameNumber: number,
  payoutsEnabled: boolean,
  settledAt: Date,
  hostSeatNumber = universityVideoBeamStore.hostSeatNumber(roomId),
) {
  const [existing] = await tx.select().from(roomCardGameResults).where(and(
    eq(roomCardGameResults.roomId, roomId), eq(roomCardGameResults.gameNumber, gameNumber),
  )).limit(1);
  if (existing) return;

  const seats = await tx.select().from(roomCardGameSeats).where(and(
    eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
    eq(roomCardGameSeats.status, "active"),
  ));
  const deals = await tx.select().from(roomCardGameDeals).where(and(
    eq(roomCardGameDeals.roomId, roomId), eq(roomCardGameDeals.gameNumber, gameNumber),
  ));
  const profiles = await tx.select({
    accountId: accountProfiles.accountId, username: accountProfiles.username,
  }).from(accountProfiles).where(inArray(accountProfiles.accountId, seats.map(seat => seat.accountId)));
  const usernames = new Map(profiles.map(profile => [profile.accountId, profile.username]));
  const eligible: Array<PrizeWinner & { hand: string[]; score: ReturnType<typeof scoreFiveCardHand> }> = [];
  for (const seat of seats) {
    const hand = deals.filter(deal => deal.accountId === seat.accountId)
      .sort((a, b) => a.dealNumber - b.dealNumber)
      .map(deal => deal.cardCode);
    if (hand.length !== 5) continue;
    eligible.push({
      accountId: seat.accountId, username: usernames.get(seat.accountId) ?? "Player",
      seatNumber: seat.seatNumber, hand, score: scoreFiveCardHand(hand),
    });
  }

  if (!cardGamePrizeEligible(eligible.length)) {
    await tx.insert(roomCardGamePots).values({ roomId }).onConflictDoNothing();
    await tx.update(roomCardGamePots).set({ carryoverGold: 0, updatedAt: settledAt })
      .where(eq(roomCardGamePots.roomId, roomId));
    await tx.update(roomCardGameSeats).set({ status: "out", graceUntil: null }).where(and(
      eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
      eq(roomCardGameSeats.status, "active"),
    ));
    await tx.insert(roomCardGameResults).values({
      roomId, gameNumber, status: "no_prize",
      announcement: "No prize was paid because fewer than three eligible accounts played.",
    }).onConflictDoNothing();
    await tx.update(roomCardGameRuns).set({ status: "paid", updatedAt: new Date() })
      .where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
    return;
  }

  if (!payoutsEnabled) {
    await tx.insert(roomCardGamePots).values({ roomId }).onConflictDoNothing();
    const [pot] = await tx.select({ carryoverGold: roomCardGamePots.carryoverGold }).from(roomCardGamePots)
      .where(eq(roomCardGamePots.roomId, roomId)).for("update").limit(1);
    await tx.update(roomCardGameSeats).set({ status: "out", graceUntil: null }).where(and(
      eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
      eq(roomCardGameSeats.status, "active"),
    ));
    await tx.insert(roomCardGameResults).values({
      roomId, gameNumber, status: "no_prize",
      carryoverGold: pot?.carryoverGold ?? 0,
      announcement: "No prize was paid because card-game payouts are switched off.",
    }).onConflictDoNothing();
    await tx.update(roomCardGameRuns).set({ status: "paid", updatedAt: new Date() })
      .where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
    return;
  }

  let best = eligible[0]!;
  for (const player of eligible.slice(1)) {
    if (compareHandScores(player.score, best.score) > 0) best = player;
  }
  const winners = eligible.filter(player => compareHandScores(player.score, best.score) === 0);
  await tx.insert(roomCardGamePots).values({ roomId }).onConflictDoNothing();
  const [pot] = await tx.select().from(roomCardGamePots)
    .where(eq(roomCardGamePots.roomId, roomId)).for("update").limit(1);
  const prizeGold = Math.min(CARD_GAME_MAX_POT, CARD_GAME_PRIZE + (pot?.carryoverGold ?? 0));
  const rawShares = splitRoomPrize(winners, hostSeatNumber, prizeGold);
  const dayKey = easternHangoutDayKey(settledAt);
  await lockAccounts(tx, rawShares.map(share => share.accountId));
  const paidShares: typeof rawShares = [];
  let unpaidGold = 0;
  for (const share of rawShares) {
    await tx.insert(roomCardGameDailyWinnings).values({
      accountId: share.accountId, dayKey, winningsGold: 0,
    }).onConflictDoNothing();
    const [daily] = await tx.select().from(roomCardGameDailyWinnings).where(and(
      eq(roomCardGameDailyWinnings.accountId, share.accountId),
      eq(roomCardGameDailyWinnings.dayKey, dayKey),
    )).for("update").limit(1);
    const [capped] = applyDailyWinningsCap([share], new Map([
      [share.accountId, daily?.winningsGold ?? 0],
    ]), CARD_GAME_DAILY_WIN_CAP);
    if (!capped) throw new Error("Card-game payout cap could not be calculated");
    const paidGold = capped.coins;
    unpaidGold += capped.unpaidGold;
    paidShares.push({ ...share, coins: paidGold });
    if (paidGold > 0) {
      await tx.update(roomCardGameDailyWinnings).set({
        winningsGold: (daily?.winningsGold ?? 0) + paidGold, updatedAt: settledAt,
      }).where(and(
        eq(roomCardGameDailyWinnings.accountId, share.accountId),
        eq(roomCardGameDailyWinnings.dayKey, dayKey),
      ));
      await tx.update(socialWallets).set({
        balance: sql`${socialWallets.balance} + ${paidGold}`,
        earned: sql`${socialWallets.earned} + ${paidGold}`,
      }).where(eq(socialWallets.accountId, share.accountId));
      await tx.insert(socialLedger).values({
        accountId: share.accountId, delta: paidGold, kind: "reward",
        description: `Room card-game prize · game ${gameNumber}`,
        refKey: `card-game:${roomId}:${gameNumber}`,
      });
    }
    if (paidGold > 0) {
      await tx.update(roomCardGameSeats).set({ status: "winner" }).where(and(
        eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
        eq(roomCardGameSeats.accountId, share.accountId),
      ));
    }
  }
  const carryoverGold = nextRoomCardGameCarryover(unpaidGold);
  await tx.update(roomCardGamePots).set({ carryoverGold, updatedAt: settledAt })
    .where(eq(roomCardGamePots.roomId, roomId));
  for (const share of paidShares) {
    if (share.coins > 0) continue;
    // Capped winners still won the hand, even when no coins fit under today's cap.
    await tx.update(roomCardGameSeats).set({ status: "winner" }).where(and(
      eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
      eq(roomCardGameSeats.accountId, share.accountId),
    ));
  }
  await tx.update(roomCardGameSeats).set({ status: "out", graceUntil: null }).where(and(
    eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
    eq(roomCardGameSeats.status, "active"),
  ));
  const announcement = paidShares.length === 1
    ? `${paidShares[0]!.username} is the winner`
    : `We have a tie: ${paidShares.map(share => `${share.username} (${share.coins} gold)`).join(", ")}`;
  const payoutStatus = paidShares.some(share => share.coins > 0) ? "paid" : "no_prize";
  await tx.insert(roomCardGameResults).values({
    roomId, gameNumber, status: payoutStatus,
    winnerAccountIds: paidShares.map(share => share.accountId),
    shares: paidShares.map(({ accountId, username, seatNumber, coins }) => ({ accountId, username, seatNumber, coins })),
    prizeGold, carryoverGold,
    announcement,
  }).onConflictDoNothing();
  await tx.update(roomCardGameRuns).set({ status: "paid", updatedAt: new Date() })
    .where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
}

async function advanceGame(roomId: string, gameNumber: number, nowMs: number) {
  const [run] = await db.select().from(roomCardGameRuns).where(and(
    eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber),
  )).limit(1);
  if (!run || run.status === "paid" || run.status === "void") return;

  await db.transaction(async tx => {
    await lockRoomCardGame(tx, roomId);
    const [currentSettings] = await tx.select().from(roomCardGameSettings)
      .where(eq(roomCardGameSettings.id, SETTINGS_ID)).for("update").limit(1);
    if (!currentSettings) throw new Error("Card-game settings are unavailable");
    const [current] = await tx.select().from(roomCardGameRuns).where(and(
      eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber),
    )).for("update").limit(1);
    if (!current || current.status === "paid" || current.status === "void") return;
    const gameStartMs = current.gameStartAt.getTime();
    const gameEndMs = gameStartMs + CARD_GAME_PERIOD_MS;
    if (current.cardsDealt === 0 && currentSettings.dealsEnabledAt
      && currentSettings.dealsEnabledAt.getTime() > gameStartMs) return;

    if (nowMs >= gameEndMs && current.cardsDealt < 5
      && !(current.cardsDealt === 4 && nowMs - gameEndMs <= CARD_DEAL_SCHEDULER_GRACE_MS)) {
      await recordVoid(tx, roomId, gameNumber, "A scheduled deal was missed after the game ended.");
      return;
    }

    await updateSeatPresence(tx, roomId, gameNumber, new Date(nowMs));
    const dueDeals = Math.max(0, Math.min(5, Math.floor((nowMs - gameStartMs) / CARD_DEAL_INTERVAL_MS)));
    let dealtCount = current.cardsDealt;
    while (currentSettings.dealsEnabled && dealtCount < dueDeals) {
      const dealNumber = dealtCount + 1;
      if (dealNumber === 1) await lockInFirstDealSeats(tx, roomId, gameNumber);
      await updateSeatPresence(tx, roomId, gameNumber, new Date(nowMs));
      const seats = await tx.select().from(roomCardGameSeats).where(and(
        eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, gameNumber),
        eq(roomCardGameSeats.status, "active"),
      ));
      const existingDeals = await tx.select({ cardCode: roomCardGameDeals.cardCode })
        .from(roomCardGameDeals).where(and(
          eq(roomCardGameDeals.roomId, roomId), eq(roomCardGameDeals.gameNumber, gameNumber),
        ));
      const rows = dealCardsForSeats(current.deck, existingDeals.length, seats.map(seat => ({
        seatNumber: seat.seatNumber, accountId: seat.accountId,
      }))).map(card => ({ roomId, gameNumber, dealNumber, ...card }));
      if (rows.length) await tx.insert(roomCardGameDeals).values(rows).onConflictDoNothing();
      dealtCount++;
      await tx.update(roomCardGameRuns).set({
        cardsDealt: dealtCount, updatedAt: new Date(nowMs),
      }).where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
    }
    if (dealtCount >= 5) {
      await tx.update(roomCardGameRuns).set({ status: "showdown", updatedAt: new Date(nowMs) })
        .where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber)));
      await settleGame(tx, roomId, gameNumber, currentSettings.payoutsEnabled, new Date(nowMs));
    }
  });
}

/**
 * Database-backed settlement entrypoint for the isolated development integration
 * suite. It cannot be called unless the test process explicitly opts in.
 */
export async function settleRoomCardGameForDevelopmentTest(
  roomId: string,
  gameNumber: number,
  settledAt: Date,
) {
  if (process.env.NODE_ENV === "production" || process.env.CARD_GAME_TEST_SETTLEMENT !== "true") {
    throw new Error("Development-only card-game settlement test entrypoint");
  }
  return db.transaction(async tx => {
    await lockRoomCardGame(tx, roomId);
    const [run] = await tx.select().from(roomCardGameRuns).where(and(
      eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, gameNumber),
    )).for("update").limit(1);
    if (!run || run.cardsDealt < 5 || run.status === "void") {
      throw new Error("The development test hand is not ready for settlement");
    }
    await settleGame(tx, roomId, gameNumber, true, settledAt, null);
  });
}

export async function advanceRoomCardGame(roomId: string, nowMs = Date.now()) {
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, "Room not found.");
  const settings = await getSettings();
  const clock = cardGameClock(nowMs);
  if (settings.dealsEnabled) await ensureGame(roomId, clock.gameNumber, clock.gameStartMs);

  const outstanding = await db.select({ gameNumber: roomCardGameRuns.gameNumber })
    .from(roomCardGameRuns).where(and(
      eq(roomCardGameRuns.roomId, roomId),
      inArray(roomCardGameRuns.status, ["running", "showdown"]),
    ));
  for (const game of outstanding.sort((a, b) => a.gameNumber - b.gameNumber)) {
    await advanceGame(roomId, game.gameNumber, nowMs);
  }
  return { settings, clock };
}

export async function getRoomCardGameView(roomId: string, accountId: string, nowMs = Date.now()) {
  const { settings, clock } = await advanceRoomCardGame(roomId, nowMs);
  const [seat] = await db.select().from(roomCardGameSeats).where(and(
    eq(roomCardGameSeats.roomId, roomId), eq(roomCardGameSeats.gameNumber, clock.gameNumber),
    eq(roomCardGameSeats.accountId, accountId),
  )).limit(1);
  const cards = settings.cardDisplayEnabled && seat?.status === "active"
    ? await db.select({
      dealNumber: roomCardGameDeals.dealNumber,
      cardCode: roomCardGameDeals.cardCode,
      dealtAt: roomCardGameDeals.dealtAt,
    }).from(roomCardGameDeals).where(and(
      eq(roomCardGameDeals.roomId, roomId), eq(roomCardGameDeals.gameNumber, clock.gameNumber),
      eq(roomCardGameDeals.accountId, accountId),
    )).orderBy(roomCardGameDeals.dealNumber)
    : [];
  const [result] = settings.cardDisplayEnabled
    ? await db.select({
      status: roomCardGameResults.status, announcement: roomCardGameResults.announcement,
      shares: roomCardGameResults.shares,
    }).from(roomCardGameResults).where(and(
      eq(roomCardGameResults.roomId, roomId),
      eq(roomCardGameResults.gameNumber, clock.gameNumber - 1),
    )).limit(1)
    : [];
  const [run] = await db.select({ cardsDealt: roomCardGameRuns.cardsDealt }).from(roomCardGameRuns)
    .where(and(eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, clock.gameNumber)))
    .limit(1);
  return {
    serverNow: new Date(clock.serverNowMs).toISOString(),
    gameNumber: clock.gameNumber,
    cardsDealt: run?.cardsDealt ?? 0,
    nextDealTime: clock.nextDealAtMs === null ? null : new Date(clock.nextDealAtMs).toISOString(),
    nextGameStart: new Date(clock.nextGameStartMs).toISOString(),
    inThisGame: seat?.status === "active",
    cards: cards.map(card => ({
      dealNumber: card.dealNumber, card: parseCardCode(card.cardCode), dealtAt: card.dealtAt.toISOString(),
    })),
    previousResult: result ?? null,
    displayEnabled: settings.cardDisplayEnabled,
  };
}

export async function getRoomCardGameSettings() {
  return getSettings();
}

export async function updateRoomCardGameSettings(update: Partial<Pick<GameSettings,
  "dealsEnabled" | "payoutsEnabled" | "cardDisplayEnabled">>) {
  await getSettings();
  const settings = await db.transaction(async tx => {
    const [current] = await tx.select().from(roomCardGameSettings)
      .where(eq(roomCardGameSettings.id, SETTINGS_ID)).for("update").limit(1);
    if (!current) throw new Error("Card-game settings are unavailable");
    const now = new Date();
    const [changed] = await tx.update(roomCardGameSettings).set({
      ...update,
      ...(update.dealsEnabled === undefined ? {} : {
        dealsEnabledAt: update.dealsEnabled ? now : null,
      }),
      updatedAt: now,
    }).where(eq(roomCardGameSettings.id, SETTINGS_ID)).returning();
    return changed;
  });
  return { ...settings!, dailyWinningsCap: CARD_GAME_DAILY_WIN_CAP };
}

export async function cancelRoomCardGame(roomId: string, reason: string) {
  const [run] = await db.select().from(roomCardGameRuns).where(and(
    eq(roomCardGameRuns.roomId, roomId), inArray(roomCardGameRuns.status, ["running", "showdown"]),
  )).orderBy(sql`${roomCardGameRuns.gameNumber} DESC`).limit(1);
  if (!run) return;
  await db.transaction(async tx => {
    await lockRoomCardGame(tx, roomId);
    const [current] = await tx.select().from(roomCardGameRuns).where(and(
      eq(roomCardGameRuns.roomId, roomId), eq(roomCardGameRuns.gameNumber, run.gameNumber),
    )).for("update").limit(1);
    if (current && ["running", "showdown"].includes(current.status)) {
      await recordVoid(tx, roomId, run.gameNumber, reason);
    }
  });
}

const cardGameTick = setInterval(() => {
  void (async () => {
    const settings = await getSettings();
    if (!settings.dealsEnabled && !settings.payoutsEnabled) return;
    for (const roomId of roomStore.communityRoomIds()) await advanceRoomCardGame(roomId);
  })().catch(error => logger.warn({ error }, "Card-game scheduler tick failed"));
}, CARD_GAME_TICK_MS);
cardGameTick.unref();
roomStore.setCommunityEndListener(roomId => {
  void cancelRoomCardGame(roomId, "The room session ended.")
    .catch(error => logger.warn({ roomId, error }, "Could not void a card game when its room ended"));
});
