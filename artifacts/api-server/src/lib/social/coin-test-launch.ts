import { createHash } from "node:crypto";
import { accountRoomEntranceEffects, coinTestLaunchControl, coinTestResetPlans, coinTesters, db, socialSettings } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { RoomError } from "../room-store";
import { requireOwner } from "../community";
import { TEST_COIN_LIFECYCLE_LOCK } from "./credits-policy";
import type { Tx } from "./core";

export const TEST_COIN_RESET_PHRASE = "END FREE TEST COINS";
export async function testCoinsClosed(tx: Tx | typeof db = db) {
  const [row] = await tx.select().from(coinTestLaunchControl).where(eq(coinTestLaunchControl.id, "global"));
  return row?.closedAt?.toISOString() ?? null;
}
async function resetContents(tx: Tx | typeof db) {
  const rows = await tx.select().from(coinTesters).orderBy(coinTesters.accountId);
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return {
    rows, fingerprint,
    summary: {
      activeTesters: rows.filter(row => row.enabled).length,
      testGiftQuantity: rows.reduce((sum, row) => sum + row.bag.reduce((n, lot) => n + lot.quantity, 0), 0),
      testEffects: rows.reduce((sum, row) => sum + row.effectIds.length, 0),
      // Unlimited allowances were never deposited into the real wallet.
      freeTestCoinBalanceAfterReset: 0,
      realWalletsPreserved: true as const,
      levelsAndXpPreserved: true as const,
    },
  };
}
export async function getTestCoinLaunchStatus(ownerId: string) {
  await requireOwner(ownerId);
  const [closedAt, contents] = await Promise.all([testCoinsClosed(), resetContents(db)]);
  return { closedAt, ...contents.summary };
}
export async function prepareTestCoinLaunchReset(ownerId: string) {
  await requireOwner(ownerId);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${TEST_COIN_LIFECYCLE_LOCK}, 0))`);
    if (await testCoinsClosed(tx)) throw new RoomError(409, "Free test coins have already been retired.");
    const contents = await resetContents(tx);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const [plan] = await tx.insert(coinTestResetPlans).values({
      ownerId, fingerprint: contents.fingerprint, expiresAt,
    }).returning();
    return { planId: plan!.id, expiresAt: expiresAt.toISOString(), closedAt: null, ...contents.summary };
  });
}
export type ConfirmTestCoinLaunchInput = { planId: string; confirmation: string; endingTesting: boolean };

/** Transaction body exported for isolated temporary-table regression tests only.
 * No real wallet, paid purchase, paid inventory, XP or financial-ledger writes belong here.
 * Retirement is not an account reset: earned levels and partial level progress survive.
 */
export async function applyTestCoinLaunchReset(tx: Tx, ownerId: string, input: ConfirmTestCoinLaunchInput) {
  if (input.confirmation !== TEST_COIN_RESET_PHRASE || input.endingTesting !== true)
    throw new RoomError(400, "Confirm that testing is ending and type END FREE TEST COINS.");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${TEST_COIN_LIFECYCLE_LOCK}, 0))`);
  const [plan] = await tx.select().from(coinTestResetPlans).where(and(
    eq(coinTestResetPlans.id, input.planId), eq(coinTestResetPlans.ownerId, ownerId))).for("update");
  if (!plan) throw new RoomError(404, "Prepare a launch-reset preview first.");
  // Completed retries must not perform any writes, even with a different plan.
  if (plan.completedAt) return { closedAt: plan.completedAt.toISOString(), alreadyCompleted: true };
  if (plan.expiresAt.getTime() <= Date.now()) throw new RoomError(409, "This reset preview expired. Preview it again.");
  if (await testCoinsClosed(tx)) throw new RoomError(409, "Free test coins have already been retired.");
  const contents = await resetContents(tx);
  if (contents.fingerprint !== plan.fingerprint)
    throw new RoomError(409, "Testers or test inventory changed. Review a fresh preview before resetting.");
  for (const row of contents.rows) {
    const [settings] = await tx.select().from(socialSettings).where(eq(socialSettings.accountId, row.accountId));
    const equipped = settings?.equippedEntranceEffectId;
    if (equipped && row.effectIds.includes(equipped)) {
      const [paid] = await tx.select().from(accountRoomEntranceEffects).where(and(
        eq(accountRoomEntranceEffects.accountId, row.accountId), eq(accountRoomEntranceEffects.effectId, equipped)));
      if (!paid) await tx.update(socialSettings).set({ equippedEntranceEffectId: null })
        .where(eq(socialSettings.accountId, row.accountId));
    }
  }
  const at = new Date();
  await tx.update(coinTesters).set({ enabled: false, bag: [], effectIds: [], updatedAt: at });
  await tx.insert(coinTestLaunchControl).values({ id: "global", closedAt: at, closedBy: ownerId })
    .onConflictDoUpdate({ target: coinTestLaunchControl.id, set: { closedAt: at, closedBy: ownerId } });
  await tx.update(coinTestResetPlans).set({ completedAt: at }).where(eq(coinTestResetPlans.id, plan.id));
  // Test receipts remain for audit/idempotency but never join paid ledgers or rewards.
  return { closedAt: at.toISOString(), alreadyCompleted: false };
}
export async function confirmTestCoinLaunchReset(ownerId: string, input: ConfirmTestCoinLaunchInput) {
  await requireOwner(ownerId);
  return db.transaction(tx => applyTestCoinLaunchReset(tx, ownerId, input));
}
