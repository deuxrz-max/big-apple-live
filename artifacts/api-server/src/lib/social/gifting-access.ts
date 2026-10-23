import { db, socialLedger } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { giftingProgress } from "@workspace/beam-identity";
import { RoomError } from "../room-store";

export function canAccessGiftingExclusive(platinumExclusive: boolean | undefined, xp: number): boolean {
  return !platinumExclusive || giftingProgress(xp).level >= 61;
}

export async function realGiftingLevel(accountId: string, executor: Pick<typeof db, "select"> = db) {
  const [row] = await executor.select({
    xp: sql<string>`coalesce(sum(-${socialLedger.delta}), 0)::text`,
  }).from(socialLedger).where(and(
    eq(socialLedger.accountId, accountId), eq(socialLedger.kind, "gift_sent"), lt(socialLedger.delta, 0),
  ));
  return giftingProgress(Number(row?.xp ?? 0)).level;
}

/** Real committed spending only: owner appearance overrides never unlock gifts. */
export async function assertGiftingAccess(
  accountId: string,
  item: { platinumExclusive?: boolean },
  executor: Pick<typeof db, "select"> = db,
) {
  if (!item.platinumExclusive) return;
  if (await realGiftingLevel(accountId, executor) < 61) {
    throw new RoomError(403, "This exclusive gift unlocks at Platinum, gifter Level 61.");
  }
}
