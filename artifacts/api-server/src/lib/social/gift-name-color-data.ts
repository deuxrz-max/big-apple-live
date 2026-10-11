import { db, socialWallets } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { giftNameColorForSentCredits } from "./gift-name-color";

const DEFAULT_NAME_COLOR = "#FFFFFF";

/** Read the existing lifetime sent-credit counters; this does not mutate wallets or gift history. */
export async function giftNameColorsForAccounts(accountIds: readonly string[]) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({
    accountId: socialWallets.accountId,
    sent: socialWallets.sent,
  }).from(socialWallets).where(inArray(socialWallets.accountId, ids));
  const byAccount = new Map(rows.map(row => [row.accountId, giftNameColorForSentCredits(row.sent)]));
  return new Map(ids.map(id => [id, byAccount.get(id) ?? DEFAULT_NAME_COLOR]));
}
