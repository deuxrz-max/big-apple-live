import { accountProfiles, coinTestActions, coinTesters, db, socialLedger } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { RoomError } from "../room-store";
import { requireOwner } from "../community";
import { lockAccounts, type Tx } from "./core";
import { testCoinsClosed } from "./coin-test-launch";

export async function testerState(id: string, tx: Tx | typeof db = db) {
  if (await testCoinsClosed(tx)) return null;
  const [row] = await tx.select().from(coinTesters).where(eq(coinTesters.accountId, id));
  return row?.enabled ? row : null;
}
export async function listCoinTesters(ownerId: string) {
  await requireOwner(ownerId);
  const rows = await db.select({ username: accountProfiles.username, enabled: coinTesters.enabled })
    .from(coinTesters).innerJoin(accountProfiles, eq(accountProfiles.accountId, coinTesters.accountId));
  return { testers: rows };
}
export async function setCoinTester(ownerId: string, username: string, enabled: boolean) {
  await requireOwner(ownerId);
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.nameKey, username.toLowerCase()));
  if (!profile) throw new RoomError(404, "No account has that exact username.");
  await db.transaction(async tx => {
    // Same lock as purchases/sends: revocation cannot race a gift into real funds.
    await lockAccounts(tx, [profile.accountId]);
    if (enabled && await testCoinsClosed(tx))
      throw new RoomError(409, "Free test coins were retired at launch. New tester grants are disabled.");
    await tx.insert(coinTesters).values({ accountId: profile.accountId, enabled, designatedBy: ownerId })
      .onConflictDoUpdate({ target: coinTesters.accountId, set: {
        enabled, designatedBy: ownerId, updatedAt: new Date(),
        ...(!enabled ? { bag: [], effectIds: [] } : {}),
      } });
  });
  return listCoinTesters(ownerId);
}
/** Also checks paid receipts so retrying after designation/revocation cannot charge twice. */
export async function replayTestAction(tx: Tx, id: string, key: string, ref: string) {
  const [testRow] = await tx.select().from(coinTestActions).where(and(
    eq(coinTestActions.accountId, id), eq(coinTestActions.requestKey, key)));
  const [paidRow] = await tx.select().from(socialLedger).where(and(
    eq(socialLedger.accountId, id), eq(socialLedger.requestKey, key)));
  const row = testRow ?? paidRow;
  if (!row) return false;
  if (row.refKey !== ref) throw new RoomError(409, "This retry key belongs to a different action");
  return true;
}
export async function recordTestAction(tx: Tx, id: string, key: string, ref: string) {
  await tx.insert(coinTestActions).values({ accountId: id, requestKey: key, refKey: ref });
}
export function assertCoinMode(testing: boolean, expectedTesting: boolean) {
  if (testing !== expectedTesting) throw new RoomError(409,
    "Your test-coin access changed. Refresh before trying again. No real coins were charged.");
}
export async function consumeTestBag(tx: Tx, id: string, giftId: string, requested: number, bagOnly: boolean) {
  const state = await testerState(id, tx);
  if (!state) throw new RoomError(409, "Test access changed. Refresh before sending.");
  let remaining = requested;
  const bag = state.bag.filter(lot => new Date(lot.expiresAt).getTime() > Date.now()).flatMap(lot => {
    const used = lot.giftId === giftId ? Math.min(remaining, lot.quantity) : 0;
    remaining -= used;
    return lot.quantity > used ? [{ ...lot, quantity: lot.quantity - used }] : [];
  });
  if (bagOnly && remaining) throw new RoomError(409, "That stored test gift is no longer available in My Bag.");
  await tx.update(coinTesters).set({ bag }).where(eq(coinTesters.accountId, id));
}
