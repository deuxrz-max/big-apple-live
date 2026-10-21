import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  accountProfiles, chatRooms, db, pool, roomCardGameDailyWinnings, roomCardGameDeals,
  roomCardGamePots, roomCardGameResults, roomCardGameRuns, roomCardGameSeats,
  roomCardGameSettings, socialLedger, socialWallets,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { createDeck } from "./room-card-game-policy";
import { easternHangoutDayKey } from "./community-hangout-policy";
import { settleRoomCardGameForDevelopmentTest } from "./room-card-game-service";

type TestAccount = { accountId: string; username: string };
type HandSet = Array<{ account: TestAccount; seatNumber: number; cards: string[] }>;

const highHand = ["AS", "AH", "AD", "AC", "KS"];
const threeKings = ["KH", "KD", "KC", "QS", "JD"];
const lowPair = ["9S", "9H", "8D", "7C", "6S"];
const acePairA = ["AS", "AH", "KD", "QC", "JS"];
const acePairB = ["AD", "AC", "KH", "QS", "JD"];
const tenPair = ["10S", "10H", "8D", "7C", "6S"];

test("development database settlement is capped, atomic, persistent and idempotent", async t => {
  if (process.env.NODE_ENV === "production" || process.env.CARD_GAME_TEST_SETTLEMENT !== "true") {
    t.skip("requires an explicit development-only database test opt-in");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const accountIds: string[] = [];
  const roomIds: string[] = [];
  const now = new Date();
  const dayKey = easternHangoutDayKey(now);

  async function addAccount(label: string): Promise<TestAccount> {
    const accountId = `card-test-${suffix}-${label}`;
    const username = `cg${suffix}${label}`.slice(0, 24);
    accountIds.push(accountId);
    await db.insert(accountProfiles).values({
      accountId, username, nameKey: username.toLowerCase(), emojiId: "1F600",
      gender: "Male", color: "#FFFFFF", hairColor: "#000000", isTestAccount: true,
    });
    await db.insert(socialWallets).values({ accountId, balance: 1000, earned: 0, received: 0, sent: 0 });
    return { accountId, username };
  }

  async function makeHand(label: string, players: HandSet, carryoverGold = 0) {
    const roomId = `CG${suffix}${label}`.toUpperCase();
    roomIds.push(roomId);
    const gameNumber = 900_000 + roomIds.length;
    await db.insert(chatRooms).values({
      roomId, historyId: randomUUID(), label: `Card test ${label}`,
    });
    await db.insert(roomCardGamePots).values({ roomId, carryoverGold });
    await db.insert(roomCardGameRuns).values({
      roomId, gameNumber, gameStartAt: now, status: "showdown", deck: createDeck(), cardsDealt: 5,
    });
    await db.insert(roomCardGameSeats).values(players.map(player => ({
      roomId, gameNumber, accountId: player.account.accountId,
      seatNumber: player.seatNumber, status: "active" as const,
    })));
    await db.insert(roomCardGameDeals).values(players.flatMap(player => player.cards.map((cardCode, index) => ({
      roomId, gameNumber, dealNumber: index + 1, seatNumber: player.seatNumber,
      accountId: player.account.accountId, cardCode,
    }))));
    return { roomId, gameNumber };
  }

  async function daily(account: TestAccount, winningsGold: number) {
    await db.insert(roomCardGameDailyWinnings).values({
      accountId: account.accountId, dayKey, winningsGold,
    }).onConflictDoUpdate({
      target: [roomCardGameDailyWinnings.accountId, roomCardGameDailyWinnings.dayKey],
      set: { winningsGold, updatedAt: now },
    });
  }

  async function walletBalance(account: TestAccount) {
    const [row] = await db.select({ balance: socialWallets.balance }).from(socialWallets)
      .where(eq(socialWallets.accountId, account.accountId));
    return row?.balance ?? 0;
  }

  try {
    const [acrossRoomsWinner, supportA, supportB] = await Promise.all([
      addAccount("winner"), addAccount("supporta"), addAccount("supportb"),
    ]);
    const baseline = await walletBalance(acrossRoomsWinner);
    for (let hand = 1; hand <= 6; hand += 1) {
      const fixture = await makeHand(`cross${hand}`, [
        { account: acrossRoomsWinner, seatNumber: 1, cards: highHand },
        { account: supportA, seatNumber: 2, cards: threeKings },
        { account: supportB, seatNumber: 3, cards: lowPair },
      ]);
      await settleRoomCardGameForDevelopmentTest(fixture.roomId, fixture.gameNumber, now);
    }
    assert.equal(await walletBalance(acrossRoomsWinner), baseline + 500,
      "winnings from different rooms share one account-wide daily limit");
    const [crossRoomCap] = await db.select().from(roomCardGameDailyWinnings).where(and(
      eq(roomCardGameDailyWinnings.accountId, acrossRoomsWinner.accountId),
      eq(roomCardGameDailyWinnings.dayKey, dayKey),
    ));
    assert.equal(crossRoomCap?.winningsGold, 500);

    const partial = await addAccount("partial");
    const tiePartner = await addAccount("tiepartner");
    const tieThird = await addAccount("tiethird");
    await daily(partial, 499);
    const tie = await makeHand("partialtie", [
      { account: partial, seatNumber: 1, cards: acePairA },
      { account: tiePartner, seatNumber: 2, cards: acePairB },
      { account: tieThird, seatNumber: 3, cards: tenPair },
    ]);
    await settleRoomCardGameForDevelopmentTest(tie.roomId, tie.gameNumber, now);
    const [tieResult] = await db.select().from(roomCardGameResults).where(and(
      eq(roomCardGameResults.roomId, tie.roomId), eq(roomCardGameResults.gameNumber, tie.gameNumber),
    ));
    assert.equal(tieResult?.prizeGold, 100);
    assert.equal(tieResult?.carryoverGold, 49);
    assert.match(tieResult?.announcement ?? "", /^We have a tie:/);
    assert.deepEqual(tieResult?.shares.map(share => share.coins), [1, 50]);
    const [partialDaily] = await db.select().from(roomCardGameDailyWinnings).where(and(
      eq(roomCardGameDailyWinnings.accountId, partial.accountId),
      eq(roomCardGameDailyWinnings.dayKey, dayKey),
    ));
    assert.equal(partialDaily?.winningsGold, 500);

    const fullyCapped = await addAccount("fullcap");
    const fullSupportA = await addAccount("fulla");
    const fullSupportB = await addAccount("fullb");
    await daily(fullyCapped, 500);
    const capped = await makeHand("maxpot", [
      { account: fullyCapped, seatNumber: 1, cards: highHand },
      { account: fullSupportA, seatNumber: 2, cards: threeKings },
      { account: fullSupportB, seatNumber: 3, cards: lowPair },
    ], 400);
    await settleRoomCardGameForDevelopmentTest(capped.roomId, capped.gameNumber, now);
    const [cappedResult] = await db.select().from(roomCardGameResults).where(and(
      eq(roomCardGameResults.roomId, capped.roomId), eq(roomCardGameResults.gameNumber, capped.gameNumber),
    ));
    assert.equal(cappedResult?.prizeGold, 500, "base plus carryover never exceeds the 500-gold pot ceiling");
    assert.equal(cappedResult?.status, "no_prize", "a fully capped winner gets no false paid result");
    assert.equal(cappedResult?.carryoverGold, 400, "excess beyond the ceiling is not added to the next pot");
    assert.equal(cappedResult?.shares[0]?.coins, 0);

    const tooFewA = await addAccount("fewone");
    const tooFewB = await addAccount("fewtwo");
    const tooFew = await makeHand("minimum", [
      { account: tooFewA, seatNumber: 1, cards: highHand },
      { account: tooFewB, seatNumber: 2, cards: threeKings },
    ], 200);
    await settleRoomCardGameForDevelopmentTest(tooFew.roomId, tooFew.gameNumber, now);
    const [fewResult] = await db.select().from(roomCardGameResults).where(and(
      eq(roomCardGameResults.roomId, tooFew.roomId), eq(roomCardGameResults.gameNumber, tooFew.gameNumber),
    ));
    const [fewPot] = await db.select().from(roomCardGamePots).where(eq(roomCardGamePots.roomId, tooFew.roomId));
    assert.equal(fewResult?.status, "no_prize");
    assert.equal(fewPot?.carryoverGold, 0, "chosen safe default discards carryover after a hand with fewer than three players");

    const raceWinner = await addAccount("racewin");
    const raceSupportA = await addAccount("racea");
    const raceSupportB = await addAccount("raceb");
    const race = await makeHand("race", [
      { account: raceWinner, seatNumber: 1, cards: highHand },
      { account: raceSupportA, seatNumber: 2, cards: threeKings },
      { account: raceSupportB, seatNumber: 3, cards: lowPair },
    ]);
    const raceBaseline = await walletBalance(raceWinner);
    await Promise.all([
      settleRoomCardGameForDevelopmentTest(race.roomId, race.gameNumber, now),
      settleRoomCardGameForDevelopmentTest(race.roomId, race.gameNumber, now),
    ]);
    await settleRoomCardGameForDevelopmentTest(race.roomId, race.gameNumber, now);
    assert.equal(await walletBalance(raceWinner), raceBaseline + 100,
      "simultaneous calls and post-commit re-entry do not pay twice");
    const ledger = await db.select().from(socialLedger).where(and(
      eq(socialLedger.accountId, raceWinner.accountId),
      eq(socialLedger.refKey, `card-game:${race.roomId}:${race.gameNumber}`),
    ));
    assert.equal(ledger.length, 1);

    const [switches] = await db.select({
      deals: roomCardGameSettings.dealsEnabled,
      payouts: roomCardGameSettings.payoutsEnabled,
      display: roomCardGameSettings.cardDisplayEnabled,
    }).from(roomCardGameSettings).where(eq(roomCardGameSettings.id, "global"));
    assert.deepEqual(switches, { deals: false, payouts: false, display: false },
      "integration test leaves all real-use card-game switches off");
  } finally {
    if (roomIds.length) {
      await db.transaction(async tx => {
        await tx.delete(roomCardGameResults).where(inArray(roomCardGameResults.roomId, roomIds));
        await tx.delete(roomCardGameDeals).where(inArray(roomCardGameDeals.roomId, roomIds));
        await tx.delete(roomCardGameSeats).where(inArray(roomCardGameSeats.roomId, roomIds));
        await tx.delete(roomCardGameRuns).where(inArray(roomCardGameRuns.roomId, roomIds));
        await tx.delete(roomCardGamePots).where(inArray(roomCardGamePots.roomId, roomIds));
        await tx.delete(chatRooms).where(inArray(chatRooms.roomId, roomIds));
      });
    }
    if (accountIds.length) {
      await db.delete(roomCardGameDailyWinnings).where(inArray(roomCardGameDailyWinnings.accountId, accountIds));
      await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, accountIds));
    }
    await pool.end();
  }
});
