import { and, asc, desc, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import {
  accountProfiles, db, liveStreamSessions, pkBattleGifts, pkBattleSearchQueue, pkBattles,
} from "@workspace/db";
import type { Tx } from "./social/core";
import { RoomError } from "./room-store";
import {
  battleWinner, PK_BATTLE_LENGTH_MS, PK_BONUS_END_MS, PK_BONUS_START_MS,
  PK_COUNTDOWN_MS, PK_RESULT_VISIBLE_MS, PK_SEARCH_TIMEOUT_MS, pkPointsForGift, pkWeeklyReset,
} from "./pk-battle-policy";

export type PkBattlePlayer = { streamId: string; username: string; displayName: string; side: "A" | "B" };
export type PkBattleTopGifter = { username: string; displayName: string; coins: number };
export type PkBattleState = {
  state: "idle" | "searching" | "timed_out" | "battle";
  searchExpiresAtMs: number | null;
  battle: null | {
    id: string;
    status: "countdown" | "active" | "finished";
    sideA: PkBattlePlayer;
    sideB: PkBattlePlayer;
    startsAtMs: number;
    endsAtMs: number;
    bonusStartAtMs: number;
    bonusEndAtMs: number;
    scoreA: number;
    scoreB: number;
    winnerUsername: string | null;
    finishReason: "time" | "opponent-left" | null;
    topGiftersA: PkBattleTopGifter[];
    topGiftersB: PkBattleTopGifter[];
  };
};

export type PkBattleMediaSession = { url: string; token: string; role: "host" | "viewer"; identity: string };
export const pkBattleRoomName = (battleId: string) => `dw-pk-${battleId}`;
const searchingState = (expiresAt: Date): PkBattleState => ({
  state: "searching", searchExpiresAtMs: expiresAt.getTime(), battle: null,
});
const stateCache = new Map<string, { until: number; state: PkBattleState }>();

async function lockPk(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('deux-wild-pk-battle-v1'))`);
}

function battleQueryForStream(streamId: string) {
  return or(eq(pkBattles.streamA, streamId), eq(pkBattles.streamB, streamId));
}

async function readBattleState(battleId: string, now: Date): Promise<PkBattleState> {
  let [row] = await db.select().from(pkBattles).where(eq(pkBattles.id, battleId)).limit(1);
  if (!row) return { state: "idle", searchExpiresAtMs: null, battle: null };
  if ((row.status === "countdown" || row.status === "active") && row.endsAt <= now) {
    await finishPkBattle(row.id, now, "time", null);
    return readBattleState(battleId, now);
  }
  if (row.status === "countdown" && row.startsAt <= now) {
    await db.update(pkBattles).set({ status: "active" }).where(and(
      eq(pkBattles.id, row.id), eq(pkBattles.status, "countdown"),
    ));
    row = { ...row, status: "active" };
  }
  if (row.status === "completed" && row.completedAt
    && now.getTime() - row.completedAt.getTime() > PK_RESULT_VISIBLE_MS) {
    return { state: "idle", searchExpiresAtMs: null, battle: null };
  }
  const [profileA, profileB, gifterTotals] = await Promise.all([
    db.select({ username: accountProfiles.username, displayName: accountProfiles.displayName })
      .from(accountProfiles).where(eq(accountProfiles.accountId, row.accountA)).limit(1),
    db.select({ username: accountProfiles.username, displayName: accountProfiles.displayName })
      .from(accountProfiles).where(eq(accountProfiles.accountId, row.accountB)).limit(1),
    db.select({
      recipientAccountId: pkBattleGifts.recipientAccountId,
      senderAccountId: pkBattleGifts.senderAccountId,
      coins: sql<number>`COALESCE(SUM(${pkBattleGifts.coins}), 0)::int`,
    }).from(pkBattleGifts).where(eq(pkBattleGifts.battleId, row.id))
      .groupBy(pkBattleGifts.recipientAccountId, pkBattleGifts.senderAccountId),
  ]);
  const [winner] = row.winnerAccountId
    ? await db.select({ username: accountProfiles.username }).from(accountProfiles)
      .where(eq(accountProfiles.accountId, row.winnerAccountId)).limit(1)
    : [];
  const gifterIds = [...new Set(gifterTotals.map(gift => gift.senderAccountId))];
  const profiles = gifterIds.length
    ? await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username, displayName: accountProfiles.displayName })
      .from(accountProfiles).where(inArray(accountProfiles.accountId, gifterIds))
    : [];
  const topFor = (accountId: string) => gifterTotals.filter(gift => gift.recipientAccountId === accountId)
    .map(gift => ({
      ...profiles.find(person => person.accountId === gift.senderAccountId),
      coins: Number(gift.coins),
    })).filter((person): person is { username: string; displayName: string | null; coins: number } =>
      Boolean(person.username))
    .sort((a, b) => b.coins - a.coins).slice(0, 3)
    .map(({ username, displayName, coins }) => ({ username, displayName: displayName?.trim() || username, coins }));
  const status = row.status === "completed" ? "finished" : now < row.startsAt ? "countdown" : "active";
  return {
    state: "battle", searchExpiresAtMs: null,
    battle: {
      id: row.id,
      status,
      sideA: { streamId: row.streamA, username: profileA[0]?.username ?? "creator",
        displayName: profileA[0]?.displayName?.trim() || profileA[0]?.username || "Creator", side: "A" },
      sideB: { streamId: row.streamB, username: profileB[0]?.username ?? "creator",
        displayName: profileB[0]?.displayName?.trim() || profileB[0]?.username || "Creator", side: "B" },
      startsAtMs: row.startsAt.getTime(),
      endsAtMs: row.endsAt.getTime(),
      bonusStartAtMs: row.startsAt.getTime() + PK_BONUS_START_MS,
      bonusEndAtMs: row.startsAt.getTime() + PK_BONUS_END_MS,
      scoreA: row.scoreA,
      scoreB: row.scoreB,
      winnerUsername: winner?.username ?? null,
      finishReason: row.finishReason === "time" || row.finishReason === "opponent-left" ? row.finishReason : null,
      topGiftersA: topFor(row.accountA),
      topGiftersB: topFor(row.accountB),
    },
  };
}

async function battleStateForQueue(row: typeof pkBattleSearchQueue.$inferSelect, now: Date): Promise<PkBattleState> {
  if (row.status === "searching") return searchingState(row.expiresAt);
  if (row.status === "timed_out") return { state: "timed_out", searchExpiresAtMs: null, battle: null };
  if (row.battleId) return readBattleState(row.battleId, now);
  return { state: "idle", searchExpiresAtMs: null, battle: null };
}

export async function searchPkOpponent(accountId: string, streamId: string, now = new Date()): Promise<PkBattleState> {
  const state = await db.transaction(async tx => {
    await lockPk(tx);
    await tx.delete(pkBattleSearchQueue).where(and(
      eq(pkBattleSearchQueue.status, "searching"), lte(pkBattleSearchQueue.expiresAt, now),
    ));
    const [existing] = await tx.select().from(pkBattleSearchQueue)
      .where(eq(pkBattleSearchQueue.accountId, accountId)).for("update").limit(1);
    if (existing?.status === "matched") return battleStateForQueue(existing, now);
    if (existing?.status === "searching" && existing.expiresAt > now) return searchingState(existing.expiresAt);
    if (existing) await tx.delete(pkBattleSearchQueue).where(eq(pkBattleSearchQueue.accountId, accountId));
    const [active] = await tx.select({ id: pkBattles.id }).from(pkBattles).where(and(
      or(eq(pkBattles.accountA, accountId), eq(pkBattles.accountB, accountId)),
      inArray(pkBattles.status, ["countdown", "active"]),
    )).limit(1);
    if (active) throw new RoomError(409, "You are already in a PK battle.");

    const expiresAt = new Date(now.getTime() + PK_SEARCH_TIMEOUT_MS);
    await tx.insert(pkBattleSearchQueue).values({ accountId, streamId, status: "searching", queuedAt: now, expiresAt });
    const [candidate] = await tx.select({
      accountId: pkBattleSearchQueue.accountId, streamId: pkBattleSearchQueue.streamId,
    }).from(pkBattleSearchQueue)
      .innerJoin(liveStreamSessions, eq(liveStreamSessions.accountId, pkBattleSearchQueue.accountId))
      .where(and(
        eq(pkBattleSearchQueue.status, "searching"),
        gt(pkBattleSearchQueue.expiresAt, now),
        gt(liveStreamSessions.lastHeartbeatAt, new Date(now.getTime() - 30_000)),
        eq(liveStreamSessions.state, "live"),
        sql`${pkBattleSearchQueue.accountId} <> ${accountId}`,
        sql`NOT EXISTS (SELECT 1 FROM pk_battles b WHERE
          (b.account_a = ${pkBattleSearchQueue.accountId} OR b.account_b = ${pkBattleSearchQueue.accountId})
          AND b.status IN ('countdown', 'active'))`,
      )).orderBy(sql`random()`).for("update", { skipLocked: true }).limit(1);
    if (!candidate) return searchingState(expiresAt);

    const startsAt = new Date(now.getTime() + PK_COUNTDOWN_MS);
    const endsAt = new Date(startsAt.getTime() + PK_BATTLE_LENGTH_MS);
    const [battle] = await tx.insert(pkBattles).values({
      streamA: streamId, streamB: candidate.streamId, accountA: accountId, accountB: candidate.accountId,
      status: "countdown", matchedAt: now, startsAt, endsAt,
    }).returning();
    await tx.update(pkBattleSearchQueue).set({ status: "matched", battleId: battle!.id })
      .where(inArray(pkBattleSearchQueue.accountId, [accountId, candidate.accountId]));
    return { state: "battle", searchExpiresAtMs: null, battle: null } as PkBattleState;
  });
  // A newly created battle is not visible to a separate pooled connection until
  // the matchmaking transaction commits.
  if (state.state === "battle" && !state.battle) {
    stateCache.clear();
    return getPkBattleStateForStream(streamId, now);
  }
  return state;
}

export async function cancelPkSearch(accountId: string, streamId: string): Promise<boolean> {
  const deleted = await db.delete(pkBattleSearchQueue).where(and(
    eq(pkBattleSearchQueue.accountId, accountId), eq(pkBattleSearchQueue.streamId, streamId),
    eq(pkBattleSearchQueue.status, "searching"),
  )).returning({ accountId: pkBattleSearchQueue.accountId });
  stateCache.delete(streamId);
  return deleted.length > 0;
}

export async function getPkBattleStateForStream(streamId: string, now = new Date()): Promise<PkBattleState> {
  const cached = stateCache.get(streamId);
  if (cached && cached.until > now.getTime()) return cached.state;
  const state = await readPkStateUncached(streamId, now);
  stateCache.set(streamId, { until: now.getTime() + 900, state });
  if (stateCache.size > 2_000) {
    for (const [key, value] of stateCache) if (value.until <= now.getTime()) stateCache.delete(key);
  }
  return state;
}

async function readPkStateUncached(streamId: string, now: Date): Promise<PkBattleState> {
  const [queue] = await db.select().from(pkBattleSearchQueue).where(eq(pkBattleSearchQueue.streamId, streamId)).limit(1);
  if (queue?.status === "searching" && queue.expiresAt <= now) {
    await db.update(pkBattleSearchQueue).set({ status: "timed_out" }).where(eq(pkBattleSearchQueue.accountId, queue.accountId));
    return { state: "timed_out", searchExpiresAtMs: null, battle: null };
  }
  if (queue) return battleStateForQueue(queue, now);
  const [battle] = await db.select().from(pkBattles).where(and(
    battleQueryForStream(streamId),
    or(
      inArray(pkBattles.status, ["countdown", "active"]),
      and(eq(pkBattles.status, "completed"), isNotNull(pkBattles.completedAt),
        gt(pkBattles.completedAt, new Date(now.getTime() - PK_RESULT_VISIBLE_MS))),
    ),
  )).orderBy(desc(pkBattles.matchedAt)).limit(1);
  return battle ? readBattleState(battle.id, now) : { state: "idle", searchExpiresAtMs: null, battle: null };
}

async function finishPkBattle(
  battleId: string, now: Date, reason: "time" | "opponent-left", exitingAccountId: string | null,
) {
  const finished = await db.transaction(async tx => {
    await lockPk(tx);
    const [battle] = await tx.select().from(pkBattles).where(eq(pkBattles.id, battleId)).for("update").limit(1);
    if (!battle || battle.status === "completed") return null;
    const winnerAccountId = reason === "opponent-left" && exitingAccountId
      ? exitingAccountId === battle.accountA ? battle.accountB : battle.accountA
      : battleWinner(battle.scoreA, battle.scoreB, battle.accountA, battle.accountB);
    await tx.update(pkBattles).set({
      status: "completed", completedAt: now, winnerAccountId, finishReason: reason,
    }).where(eq(pkBattles.id, battle.id));
    await tx.delete(pkBattleSearchQueue).where(inArray(pkBattleSearchQueue.accountId, [battle.accountA, battle.accountB]));
    return { streamA: battle.streamA, streamB: battle.streamB };
  });
  if (finished) {
    stateCache.delete(finished.streamA);
    stateCache.delete(finished.streamB);
  }
}

export async function finishPkBattlesForStreamEnd(streamId: string, exitingAccountId: string) {
  const battles = await db.select({ id: pkBattles.id }).from(pkBattles).where(and(
    battleQueryForStream(streamId), inArray(pkBattles.status, ["countdown", "active"]),
  ));
  for (const battle of battles) await finishPkBattle(battle.id, new Date(), "opponent-left", exitingAccountId);
  await db.delete(pkBattleSearchQueue).where(eq(pkBattleSearchQueue.streamId, streamId));
  stateCache.delete(streamId);
}

export async function recordPkGiftInTransaction(tx: Tx, gift: {
  senderAccountId: string; recipientAccountId: string; giftId: string; giftName: string; coins: number; createdAt: Date;
}) {
  const [battle] = await tx.select().from(pkBattles).where(and(
    or(eq(pkBattles.accountA, gift.recipientAccountId), eq(pkBattles.accountB, gift.recipientAccountId)),
    inArray(pkBattles.status, ["countdown", "active"]),
  )).for("update").limit(1);
  if (!battle || gift.createdAt < battle.startsAt || gift.createdAt >= battle.endsAt) return;
  const elapsed = gift.createdAt.getTime() - battle.startsAt.getTime();
  const points = pkPointsForGift(gift.coins, elapsed);
  if (gift.recipientAccountId === battle.accountA) {
    await tx.update(pkBattles).set({ scoreA: sql`${pkBattles.scoreA} + ${points}` }).where(eq(pkBattles.id, battle.id));
  } else {
    await tx.update(pkBattles).set({ scoreB: sql`${pkBattles.scoreB} + ${points}` }).where(eq(pkBattles.id, battle.id));
  }
  await tx.insert(pkBattleGifts).values({
    battleId: battle.id, senderAccountId: gift.senderAccountId, recipientAccountId: gift.recipientAccountId,
    giftId: gift.giftId, giftName: gift.giftName, coins: gift.coins, points, createdAt: gift.createdAt,
  });
}

export async function getPkWeeklyLeaderboard(now = new Date()) {
  const weekStartsAt = pkWeeklyReset(now);
  const rows = await db.select({
    accountA: pkBattles.accountA, accountB: pkBattles.accountB,
    winnerAccountId: pkBattles.winnerAccountId, completedAt: pkBattles.completedAt,
  }).from(pkBattles).where(and(
    eq(pkBattles.status, "completed"), isNotNull(pkBattles.completedAt), gt(pkBattles.completedAt, weekStartsAt),
  )).orderBy(asc(pkBattles.completedAt));
  const totals = new Map<string, { wins: number; longestWinStreak: number; currentStreak: number }>();
  for (const row of rows) {
    for (const accountId of [row.accountA, row.accountB]) {
      const stat = totals.get(accountId) ?? { wins: 0, longestWinStreak: 0, currentStreak: 0 };
      if (row.winnerAccountId === accountId) {
        stat.wins += 1;
        stat.currentStreak += 1;
        stat.longestWinStreak = Math.max(stat.longestWinStreak, stat.currentStreak);
      } else stat.currentStreak = 0;
      totals.set(accountId, stat);
    }
  }
  const accounts = [...totals.keys()];
  const profiles = accounts.length ? await db.select({
    accountId: accountProfiles.accountId, username: accountProfiles.username, displayName: accountProfiles.displayName,
  }).from(accountProfiles).where(inArray(accountProfiles.accountId, accounts)) : [];
  const byId = new Map(profiles.map(person => [person.accountId, person]));
  const people = [...totals.entries()].map(([accountId, stats]) => {
    const profile = byId.get(accountId);
    return profile ? {
      username: profile.username, displayName: profile.displayName?.trim() || profile.username,
      wins: stats.wins, longestWinStreak: stats.longestWinStreak,
    } : null;
  }).filter((person): person is NonNullable<typeof person> => Boolean(person))
    .sort((a, b) => b.wins - a.wins || b.longestWinStreak - a.longestWinStreak || a.username.localeCompare(b.username))
    .slice(0, 100);
  return { weekStartsAt: weekStartsAt.toISOString(), people };
}

export async function getBattleByStream(streamId: string) {
  const [battle] = await db.select().from(pkBattles).where(and(
    battleQueryForStream(streamId), inArray(pkBattles.status, ["countdown", "active"]),
  )).orderBy(desc(pkBattles.matchedAt)).limit(1);
  return battle ?? null;
}

export { PK_BONUS_END_MS, PK_BONUS_START_MS };
