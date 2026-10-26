import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, liveStreamSessions, pkBattleGifts, pkBattleSearchQueue, pkBattles } from "@workspace/db";
import {
  cancelPkSearch, finishPkBattlesForStreamEnd, getPkBattleStateForStream, recordPkGiftInTransaction, searchPkOpponent,
} from "./pk-battles";
import { PK_SEARCH_TIMEOUT_MS } from "./pk-battle-policy";

after(async () => { await db.$client.end(); });

test("PK matchmaking pairs two concurrent searches once, times out and settles an early exit", async t => {
  if (process.env.NODE_ENV !== "development") throw new Error("PK fixtures are development-only");
  const token = randomUUID();
  const accountIds = [`pk-test-${token}-a`, `pk-test-${token}-b`, `pk-test-${token}-c`, `pk-test-${token}-d`];
  const streamIds = accountIds.map((_, index) => `${index + 1}`.padStart(32, "0"));
  const battleIds: string[] = [];
  t.after(async () => {
    await db.delete(pkBattleSearchQueue).where(inArray(pkBattleSearchQueue.accountId, accountIds));
    if (battleIds.length) await db.delete(pkBattleGifts).where(inArray(pkBattleGifts.battleId, battleIds));
    if (battleIds.length) await db.delete(pkBattles).where(inArray(pkBattles.id, battleIds));
    await db.delete(liveStreamSessions).where(inArray(liveStreamSessions.accountId, accountIds));
  });

  const now = new Date();
  await db.insert(liveStreamSessions).values(accountIds.map((accountId, index) => ({
    accountId, streamId: streamIds[index]!, state: "live" as const,
    startedAt: new Date(now.getTime() - 30_000), lastHeartbeatAt: now, updatedAt: now,
  })));

  const [one, two] = await Promise.all([
    searchPkOpponent(accountIds[0]!, streamIds[0]!, now),
    searchPkOpponent(accountIds[1]!, streamIds[1]!, now),
  ]);
  assert.deepEqual([one.state, two.state].sort(), ["battle", "searching"]);
  const battleId = one.battle?.id ?? two.battle?.id;
  assert.ok(battleId, "one search receives a matched battle");
  battleIds.push(battleId);
  const sideA = await getPkBattleStateForStream(streamIds[0]!, new Date(now.getTime() + 1_000));
  const sideB = await getPkBattleStateForStream(streamIds[1]!, new Date(now.getTime() + 1_000));
  assert.equal(sideA.battle?.id, battleId);
  assert.equal(sideB.battle?.id, battleId);
  assert.deepEqual(
    [sideA.battle?.sideA.streamId, sideA.battle?.sideB.streamId].sort(),
    [sideB.battle?.sideA.streamId, sideB.battle?.sideB.streamId].sort(),
    "both broadcasters resolve the same shared battle sides",
  );

  await finishPkBattlesForStreamEnd(streamIds[0]!, accountIds[0]!);
  const ended = await getPkBattleStateForStream(streamIds[1]!, new Date(now.getTime() + 2_000));
  assert.equal(ended.battle?.status, "finished");
  assert.equal(ended.battle?.finishReason, "opponent-left");

  const timeoutAt = new Date(now.getTime() + 5_000);
  assert.equal((await searchPkOpponent(accountIds[2]!, streamIds[2]!, timeoutAt)).state, "searching");
  const timeout = await getPkBattleStateForStream(
    streamIds[2]!, new Date(timeoutAt.getTime() + PK_SEARCH_TIMEOUT_MS + 1),
  );
  assert.equal(timeout.state, "timed_out");

  const cancelAt = new Date(now.getTime() + 7_000);
  assert.equal((await searchPkOpponent(accountIds[3]!, streamIds[3]!, cancelAt)).state, "searching");
  assert.equal(await cancelPkSearch(accountIds[3]!, streamIds[3]!), true);
  assert.equal((await getPkBattleStateForStream(streamIds[3]!, new Date(cancelAt.getTime() + 1_000))).state, "idle");
});

test("a PK gift's doubled bonus points are recorded atomically without changing its coin value", async () => {
  if (process.env.NODE_ENV !== "development") throw new Error("PK fixtures are development-only");
  const token = randomUUID();
  const battleId = randomUUID();
  const accountA = `pk-gift-test-${token}-a`;
  const accountB = `pk-gift-test-${token}-b`;
  const start = new Date();
  const end = new Date(start.getTime() + 303_000);
  const giftTime = new Date(start.getTime() + 120_000);
  const rollback = new Error("rollback isolated PK gift fixture");
  await assert.rejects(db.transaction(async tx => {
    await tx.insert(pkBattles).values({
      id: battleId, streamA: "a".repeat(32), streamB: "b".repeat(32), accountA, accountB,
      status: "active", matchedAt: start, startsAt: start, endsAt: end,
    });
    const giftCoins = 125;
    await recordPkGiftInTransaction(tx, {
      senderAccountId: "pk-gifter-test", recipientAccountId: accountA,
      giftId: "test-gift", giftName: "Test gift", coins: giftCoins, createdAt: giftTime,
    });
    const [battle] = await tx.select().from(pkBattles).where(eq(pkBattles.id, battleId));
    const [gift] = await tx.select().from(pkBattleGifts).where(eq(pkBattleGifts.battleId, battleId));
    assert.equal(battle?.scoreA, 250);
    assert.equal(gift?.coins, 125, "the bonus changes PK points, not the gift's coin value");
    assert.equal(gift?.points, 250);
    throw rollback;
  }), /rollback isolated PK gift fixture/);
  const leftovers = await db.select().from(pkBattles).where(eq(pkBattles.id, battleId));
  assert.equal(leftovers.length, 0, "test rows roll back and do not persist");
});
