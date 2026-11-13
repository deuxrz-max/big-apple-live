import { randomInt } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, accountProfiles, pinkRewardDraws, pinkRewardEntries, pinkRewardPreferences } from "@workspace/db";
import type { Tx } from "./social/core";
import { listGiftCatalogForOwner } from "./gift-studio-catalog";
import { isSystemCauldronProduct } from "./system-cauldron-assets";
import { addGiftBagLot } from "./social/gift-bag-inventory";
import { rewardCycleBounds, rewardCycleKey, rewardDrawTimes, WIN_COOLDOWN_MS } from "./pink-card-policy";
import { logger } from "./logger";

// Shared across processes and every mutation path; award + receipt are one DB commit.
export async function lockPinkRewards(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('deux-wild-pink-rewards-v1'))`);
}

export async function enterPinkReward(tx: Tx, accountId: string, at: Date) {
  await lockPinkRewards(tx);
  const [pref] = await tx.select().from(pinkRewardPreferences).where(eq(pinkRewardPreferences.accountId, accountId));
  if (pref?.optedOut) return;
  await tx.insert(pinkRewardEntries).values({ cycle: rewardCycleKey(at), accountId, claimedAt: at }).onConflictDoNothing();
}

export async function pinkRewardEntry(accountId: string) {
  const cycle = rewardCycleKey(new Date());
  const [pref] = await db.select().from(pinkRewardPreferences).where(eq(pinkRewardPreferences.accountId, accountId));
  const [entry] = await db.select().from(pinkRewardEntries).where(and(eq(pinkRewardEntries.accountId, accountId), eq(pinkRewardEntries.cycle, cycle)));
  return { entered: !!entry && !pref?.optedOut, optedOut: pref?.optedOut ?? false };
}

export async function setPinkRewardPreference(accountId: string, optedOut: boolean) {
  await db.transaction(async tx => {
    await lockPinkRewards(tx);
    await tx.insert(pinkRewardPreferences).values({ accountId, optedOut })
      .onConflictDoUpdate({ target: pinkRewardPreferences.accountId, set: { optedOut } });
    if (optedOut) await tx.delete(pinkRewardEntries).where(eq(pinkRewardEntries.accountId, accountId));
    // Opting back in does not invent a daily claim or silently grant an entry.
  });
  return pinkRewardEntry(accountId);
}

export async function pinkRewardStatus() {
  const [winner] = await db.select().from(pinkRewardDraws)
    .where(isNotNull(pinkRewardDraws.prizeId)).orderBy(desc(pinkRewardDraws.settledAt)).limit(1);
  return {
    cycle: rewardCycleKey(new Date()),
    serverTime: new Date().toISOString(),
    winner: winner ? { id: winner.id, name: winner.winnerName!, prizeName: winner.prizeName!, drawnAt: winner.settledAt!.toISOString() } : null,
  };
}

/** Startup/retry safe. Never pays coins, XP or changes wallets. */
export async function runPinkRewardDraws(at = new Date()) {
  // This implementation is preview only, even if the code is later published.
  if (process.env.NODE_ENV !== "development") return;
  const bounds = rewardCycleBounds(at);
  const catalog = await listGiftCatalogForOwner();
  await db.transaction(async tx => {
    await processPinkRewardCycle(tx, at, catalog);
    // Expire entries, not receipts or cooldown history, at the daily boundary.
    await tx.delete(pinkRewardEntries).where(sql`${pinkRewardEntries.cycle} < ${bounds.cycle}`);
  });
}

export async function processPinkRewardCycle(tx: Tx, at: Date, available: Awaited<ReturnType<typeof listGiftCatalogForOwner>>) {
    const bounds = rewardCycleBounds(at);
    const catalog = available.filter(item =>
      item.status === "active" && !isSystemCauldronProduct(item.id)
      && item.productType === "gift");
    await lockPinkRewards(tx);
    const existing = await tx.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.cycle, bounds.cycle));
    if (!existing.length) {
      await tx.insert(pinkRewardDraws).values(rewardDrawTimes(bounds.start, bounds.end, max => randomInt(max)).map((scheduledAt, slot) => ({
        id: `${bounds.cycle}:${slot}`, cycle: bounds.cycle, slot, scheduledAt,
        // No retroactive draws for times before this feature was installed.
        settledAt: scheduledAt < at ? at : null,
        outcome: scheduledAt < at ? "before-start" : null,
      }))).onConflictDoNothing();
    }
    const due = await tx.select().from(pinkRewardDraws).where(and(
      eq(pinkRewardDraws.cycle, bounds.cycle), isNull(pinkRewardDraws.settledAt), lte(pinkRewardDraws.scheduledAt, at),
    )).orderBy(pinkRewardDraws.scheduledAt);
    for (const draw of due) {
      const entries = await tx.select({ id: accountProfiles.accountId, name: accountProfiles.username })
        .from(pinkRewardEntries).innerJoin(accountProfiles, eq(accountProfiles.accountId, pinkRewardEntries.accountId))
        .leftJoin(pinkRewardPreferences, eq(pinkRewardPreferences.accountId, accountProfiles.accountId))
        .where(and(
          eq(pinkRewardEntries.cycle, bounds.cycle),
          lte(pinkRewardEntries.claimedAt, draw.scheduledAt),
          eq(accountProfiles.isTestAccount, false),
          sql`COALESCE(${pinkRewardPreferences.optedOut}, false) = false`,
          sql`NOT EXISTS (SELECT 1 FROM pink_reward_draws previous
            WHERE previous.winner_id = ${accountProfiles.accountId}
            AND previous.prize_id IS NOT NULL
            AND previous.settled_at > ${new Date(at.getTime() - WIN_COOLDOWN_MS)})`,
        ));
      if (!entries.length || !catalog.length) {
        await tx.update(pinkRewardDraws).set({ settledAt: at, outcome: entries.length ? "no-prizes" : "no-eligible-entries" })
          .where(eq(pinkRewardDraws.id, draw.id));
        continue;
      }
      const winner = entries[randomInt(entries.length)]!;
      const prize = catalog[randomInt(catalog.length)]!;
      await addGiftBagLot(tx, winner.id, prize.id, 1, "reward", at);
      await tx.update(pinkRewardDraws).set({ settledAt: at, outcome: "awarded", winnerId: winner.id,
        winnerName: winner.name, prizeId: prize.id, prizeName: prize.name }).where(eq(pinkRewardDraws.id, draw.id));
    }
}

export function startPinkRewardScheduler() {
  if (process.env.NODE_ENV !== "development") return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runPinkRewardDraws(); }
    catch (error) { logger.error({ error }, "Pink-card reward draw failed; atomic draw will retry"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 10_000);
  timer.unref();
}
