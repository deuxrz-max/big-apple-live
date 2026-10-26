import { db, socialLedger } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { giftingProgress } from "@workspace/beam-identity";

export function canAccessGiftingExclusive(_platinumExclusive: boolean | undefined, _xp: number): boolean {
  return true;
}

export async function realGiftingLevel(accountId: string, executor: Pick<typeof db, "select"> = db) {
  const [row] = await executor.select({
    xp: sql<string>`coalesce(sum(-${socialLedger.delta}), 0)::text`,
  }).from(socialLedger).where(and(
    eq(socialLedger.accountId, accountId), eq(socialLedger.kind, "gift_sent"), lt(socialLedger.delta, 0),
  ));
  return giftingProgress(Number(row?.xp ?? 0)).level;
}

/** Compatibility boundary: gifting-tier exclusivity has been retired.
 * Existing flags stay stored without a data migration, but cannot restrict access.
 */
export async function assertGiftingAccess(
  _accountId: string,
  _item: { platinumExclusive?: boolean },
  _executor: Pick<typeof db, "select"> = db,
) {
  // Normal balance, availability and send validations remain at each caller.
}
