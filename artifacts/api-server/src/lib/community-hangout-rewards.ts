import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  accountProfiles,
  communityCoinDropClaims,
  communityCoinDrops,
  communityHangoutSettings,
  communityHangoutStreaks,
  communitySeatSessions,
  db,
  socialLedger,
  socialWallets,
} from "@workspace/db";
import { logger } from "./logger";
import { RoomError, roomStore, type RoomCoinDropEvent } from "./room-store";
import { lockAccounts, type Tx } from "./social/core";
import { universityVideoBeamStore, type BeamSeatLifecycleEvent } from "./university-video-beam";
import {
  chooseCoinDropRooms,
  coinDropAmount,
  displayHangoutStreakDays,
  easternHangoutDayKey,
  HANGOUT_ROOM_DWELL_MS,
  HANGOUT_SEAT_QUALIFY_MS,
  HANGOUT_STREAK_REWARD,
  isSeatQualified,
  nextHangoutStreakState,
  randomizedDropDelayMs,
  type HangoutStreakState,
} from "./community-hangout-policy";

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 360;
const SCHEDULER_TICK_MS = 30_000;

function secureUnitRandom(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function secureDropAmount(): number {
  return randomInt(1, 101);
}

function deterministicRequestKey(scope: string): string {
  const bytes = createHash("sha256").update(scope).digest("hex").slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = "8";
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function ensureSettingsRow(): Promise<void> {
  const nextDropAt = new Date(Date.now() + randomizedDropDelayMs(DEFAULT_INTERVAL_MINUTES, secureUnitRandom));
  await db.insert(communityHangoutSettings).values({
    id: 1,
    averageDropIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
    nextDropAt,
  }).onConflictDoNothing();
}

export async function getHangoutRewardSettings() {
  await ensureSettingsRow();
  const [row] = await db.select().from(communityHangoutSettings).where(eq(communityHangoutSettings.id, 1));
  return {
    averageIntervalMinutes: row?.averageDropIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
    nextDropAt: (row?.nextDropAt ?? new Date()).toISOString(),
    lastDropAt: row?.lastDropAt?.toISOString() ?? null,
  };
}

export async function setHangoutRewardInterval(averageIntervalMinutes: number) {
  if (!Number.isInteger(averageIntervalMinutes)
    || averageIntervalMinutes < MIN_INTERVAL_MINUTES
    || averageIntervalMinutes > MAX_INTERVAL_MINUTES) {
    throw new RoomError(400, `Choose an average interval from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES} minutes.`);
  }
  await ensureSettingsRow();
  const nextDropAt = new Date(Date.now() + randomizedDropDelayMs(averageIntervalMinutes, secureUnitRandom));
  await db.update(communityHangoutSettings).set({
    averageDropIntervalMinutes: averageIntervalMinutes,
    nextDropAt,
    updatedAt: new Date(),
  }).where(eq(communityHangoutSettings.id, 1));
  return getHangoutRewardSettings();
}

function seatLifecycle(event: BeamSeatLifecycleEvent): void {
  const operation = event.type === "joined"
    ? db.insert(communitySeatSessions).values({
        accountId: event.accountId,
        roomId: event.roomId,
        participantId: event.participantId,
        seatedSince: new Date(event.at),
        updatedAt: new Date(event.at),
      }).onConflictDoNothing()
    : db.delete(communitySeatSessions).where(and(
        eq(communitySeatSessions.accountId, event.accountId),
        eq(communitySeatSessions.roomId, event.roomId),
      ));
  void operation.catch(error => {
    logger.warn({ roomId: event.roomId, error }, "Could not update a speaker's coin-drop seat timer");
  });
}

async function currentEligibleSeatAccounts(roomId: string, nowMs: number): Promise<string[]> {
  const activeMembers = new Set(roomStore.activeAccountIds(roomId));
  const liveOccupants = universityVideoBeamStore.connectedSeatOccupants(roomId)
    .map(occupant => occupant.accountId)
    .filter(id => activeMembers.has(id));
  if (!liveOccupants.length) return [];
  const rows = await db.select({
    accountId: communitySeatSessions.accountId,
    seatedSince: communitySeatSessions.seatedSince,
  }).from(communitySeatSessions).where(and(
    eq(communitySeatSessions.roomId, roomId),
    inArray(communitySeatSessions.accountId, liveOccupants),
    lte(communitySeatSessions.seatedSince, new Date(nowMs - HANGOUT_SEAT_QUALIFY_MS)),
  ));
  return rows.filter(row => isSeatQualified(row.seatedSince.getTime(), nowMs))
    .map(row => row.accountId);
}

async function applyCoinDropClaim(
  tx: Tx,
  dropId: string,
  accountId: string,
  amount: number,
  claimedAt: Date,
): Promise<boolean> {
  await lockAccounts(tx, [accountId]);
  const [claim] = await tx.insert(communityCoinDropClaims).values({
    dropId,
    accountId,
    amount,
    claimedAt,
  }).onConflictDoNothing().returning({ accountId: communityCoinDropClaims.accountId });
  if (!claim) return false;
  await tx.update(socialWallets).set({
    balance: sql`${socialWallets.balance} + ${amount}`,
    earned: sql`${socialWallets.earned} + ${amount}`,
  }).where(eq(socialWallets.accountId, accountId));
  await tx.insert(socialLedger).values({
    accountId,
    delta: amount,
    kind: "reward",
    description: `Room coin drop · ${dropId}`,
    refKey: `hangout-drop:${dropId}`,
    requestKey: deterministicRequestKey(`hangout-drop:${dropId}:${accountId}`),
  }).onConflictDoNothing();
  return true;
}

/** Idempotent server-only coin credit used by the scheduler and the no-sign-in database test. */
export async function creditCoinDropClaimOnce(
  dropId: string,
  accountId: string,
  amount: number,
  claimedAt = new Date(),
): Promise<boolean> {
  return db.transaction(tx => applyCoinDropClaim(tx, dropId, accountId, amount, claimedAt));
}

async function createDropAndAward(roomId: string, amount: number, startedAt: Date): Promise<RoomCoinDropEvent> {
  const dropId = randomUUID();
  const eligibleIds = await currentEligibleSeatAccounts(roomId, startedAt.getTime());
  const validIds = eligibleIds.length
    ? (await db.select({ accountId: accountProfiles.accountId }).from(accountProfiles)
        .where(inArray(accountProfiles.accountId, eligibleIds))).map(row => row.accountId)
    : [];
  const event = await db.transaction(async tx => {
    const [drop] = await tx.insert(communityCoinDrops).values({
      id: dropId,
      roomId,
      amount,
      startedAt,
    }).returning();
    if (!drop) throw new Error("Coin drop event could not be recorded.");
    if (validIds.length) {
      for (const accountId of [...new Set(validIds)].sort()) {
        await applyCoinDropClaim(tx, dropId, accountId, amount, startedAt);
      }
    }
    return {
      eventId: drop.id,
      roomId: drop.roomId,
      amount: drop.amount,
      startedAt: drop.startedAt.getTime(),
    };
  });
  return event;
}

export async function accountReceivedCoinDrop(accountId: string, eventId: string): Promise<boolean> {
  const [claim] = await db.select({ accountId: communityCoinDropClaims.accountId })
    .from(communityCoinDropClaims)
    .where(and(
      eq(communityCoinDropClaims.dropId, eventId),
      eq(communityCoinDropClaims.accountId, accountId),
    )).limit(1);
  return !!claim;
}

export async function recentCoinDrops(roomId: string): Promise<RoomCoinDropEvent[]> {
  const rows = await db.select().from(communityCoinDrops).where(and(
    eq(communityCoinDrops.roomId, roomId),
    lte(communityCoinDrops.startedAt, new Date()),
  )).orderBy(sql`${communityCoinDrops.startedAt} DESC`).limit(5);
  return rows
    .filter(row => Date.now() - row.startedAt.getTime() <= 30_000)
    .map(row => ({
      eventId: row.id,
      roomId: row.roomId,
      amount: row.amount,
      startedAt: row.startedAt.getTime(),
    }));
}

export async function recordHangoutRoomActivity(
  accountId: string,
  roomId: string,
  joinedAt: Date,
  now = new Date(),
): Promise<{ days: number; rewardedNow: boolean; day: string } | null> {
  if (!roomStore.isCommunity(roomId) || roomStore.isTestOnly(roomId)
    || now.getTime() - joinedAt.getTime() < HANGOUT_ROOM_DWELL_MS) return null;
  const day = easternHangoutDayKey(now);
  return db.transaction(async tx => {
    await lockAccounts(tx, [accountId]);
    const [existing] = await tx.select().from(communityHangoutStreaks)
      .where(eq(communityHangoutStreaks.accountId, accountId)).limit(1);
    const previous: HangoutStreakState | null = existing ? {
      lastQualifiedDay: existing.lastQualifiedDay,
      consecutiveDays: existing.consecutiveDays,
      lastRewardDay: existing.lastRewardDay,
    } : null;
    const result = nextHangoutStreakState(previous, day);
    if (result.state === previous) {
      return { days: previous?.consecutiveDays ?? 0, rewardedNow: false, day };
    }
    if (result.rewardedNow) {
      await tx.update(socialWallets).set({
        balance: sql`${socialWallets.balance} + ${HANGOUT_STREAK_REWARD}`,
        earned: sql`${socialWallets.earned} + ${HANGOUT_STREAK_REWARD}`,
      }).where(eq(socialWallets.accountId, accountId));
      await tx.insert(socialLedger).values({
        accountId,
        delta: HANGOUT_STREAK_REWARD,
        kind: "reward",
        description: `Seven-day room hangout streak · ${day}`,
        refKey: `hangout-streak:${day}`,
        requestKey: deterministicRequestKey(`hangout-streak:${accountId}:${day}`),
      }).onConflictDoNothing();
    }
    await tx.insert(communityHangoutStreaks).values({
      accountId,
      lastQualifiedDay: result.state.lastQualifiedDay,
      consecutiveDays: result.state.consecutiveDays,
      lastRewardDay: result.state.lastRewardDay,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: communityHangoutStreaks.accountId,
      set: {
        lastQualifiedDay: result.state.lastQualifiedDay,
        consecutiveDays: result.state.consecutiveDays,
        lastRewardDay: result.state.lastRewardDay,
        updatedAt: now,
      },
    });
    return { days: result.state.consecutiveDays, rewardedNow: result.rewardedNow, day };
  });
}

export async function getHangoutStreakSummary(accountId: string, now = new Date()) {
  const [row] = await db.select().from(communityHangoutStreaks)
    .where(eq(communityHangoutStreaks.accountId, accountId)).limit(1);
  const today = easternHangoutDayKey(now);
  const state: HangoutStreakState | null = row ? {
    lastQualifiedDay: row.lastQualifiedDay,
    consecutiveDays: row.consecutiveDays,
    lastRewardDay: row.lastRewardDay,
  } : null;
  return {
    days: displayHangoutStreakDays(state, today),
    rewardClaimedToday: row?.lastRewardDay === today,
  };
}

let schedulerStarted = false;
let tickRunning = false;

async function runCoinDropTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await ensureSettingsRow();
    const [settings] = await db.select().from(communityHangoutSettings)
      .where(eq(communityHangoutSettings.id, 1)).limit(1);
    if (!settings || settings.nextDropAt.getTime() > Date.now()) return;

    const nextDropAt = new Date(Date.now() + randomizedDropDelayMs(
      settings.averageDropIntervalMinutes,
      secureUnitRandom,
    ));
    const [claimedSchedule] = await db.update(communityHangoutSettings).set({
      nextDropAt,
      updatedAt: new Date(),
    }).where(and(
      eq(communityHangoutSettings.id, 1),
      lte(communityHangoutSettings.nextDropAt, new Date()),
    )).returning({ averageDropIntervalMinutes: communityHangoutSettings.averageDropIntervalMinutes });
    if (!claimedSchedule) return;

    const roomIds = roomStore.publicCommunityRoomIds();
    const eligibleRooms = roomIds.filter(roomId => universityVideoBeamStore.connectedSeatOccupants(roomId)
      .some(occupant => roomStore.activeAccountIds(roomId).includes(occupant.accountId)));
    const selected = chooseCoinDropRooms(eligibleRooms, roomIds.length, secureUnitRandom);
    for (const roomId of selected) {
      const startedAt = new Date();
      try {
        const event = await createDropAndAward(roomId, secureDropAmount(), startedAt);
        roomStore.publishRoomCoinDrop(event);
        await db.update(communityHangoutSettings).set({ lastDropAt: startedAt })
          .where(eq(communityHangoutSettings.id, 1));
        logger.info({ roomId, amount: event.amount, qualifyingAccounts: await currentEligibleSeatAccounts(roomId, startedAt.getTime()).then(ids => ids.length) },
          "Hangout coin drop started");
      } catch (error) {
        logger.warn({ roomId, error }, "Hangout coin drop failed; other rooms remain unaffected");
      }
    }
  } finally {
    tickRunning = false;
  }
}

export async function startHangoutRewardScheduler(): Promise<void> {
  if (schedulerStarted) return;
  schedulerStarted = true;
  universityVideoBeamStore.setSeatLifecycleListener(seatLifecycle);
  try {
    // Beam occupancy is in-memory. After a server restart no prior seat is live,
    // so clear only these transient tenure records; no account or wallet data is touched.
    await db.delete(communitySeatSessions);
    await ensureSettingsRow();
    const interval = setInterval(() => {
      void runCoinDropTick().catch(error => logger.error({ error }, "Hangout reward scheduler tick failed"));
    }, SCHEDULER_TICK_MS);
    interval.unref();
    void runCoinDropTick().catch(error => logger.error({ error }, "Initial hangout reward scheduler tick failed"));
    logger.info({
      intervalMs: SCHEDULER_TICK_MS,
      averageDropIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
      seatQualificationMinutes: HANGOUT_SEAT_QUALIFY_MS / 60_000,
      streakDayStartsAt: "03:00 America/New_York",
    }, "Started server-owned hangout rewards");
  } catch (error) {
    schedulerStarted = false;
    throw error;
  }
}
