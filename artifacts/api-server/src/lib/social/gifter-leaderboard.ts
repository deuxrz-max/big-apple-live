import { db, accountProfiles, socialSettings, socialLedger } from "@workspace/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { GIFTING_LEVEL_THRESHOLDS } from "@workspace/beam-identity";
import { person } from "./core";

/** A separate board: the existing received-gift leaderboard is unchanged. */
export async function gifterLeaderboard(viewerId: string) {
  const totals = db.select({
    accountId: socialLedger.accountId,
    giftXp: sql<number>`sum(case when ${socialLedger.xpUnits} > 0 then ${socialLedger.xpUnits} else -${socialLedger.delta} end)::bigint`.mapWith(Number).as("gift_xp"),
  }).from(socialLedger).where(and(eq(socialLedger.kind, "gift_sent")))
    .groupBy(socialLedger.accountId).as("gift_totals");
  const rows = await db.select({
    accountId: totals.accountId, giftXp: totals.giftXp,
  }).from(totals)
    .innerJoin(accountProfiles, eq(accountProfiles.accountId, totals.accountId))
    .innerJoin(socialSettings, eq(socialSettings.accountId, totals.accountId))
    .where(and(
      eq(accountProfiles.isTestAccount, false),
      eq(socialSettings.discoverable, true),
      gt(totals.giftXp, 0),
      sql`NOT EXISTS (SELECT 1 FROM social_relations r WHERE r.kind = 'block'
        AND ((r.owner_id = ${viewerId} AND r.target_id = ${totals.accountId})
        OR (r.owner_id = ${totals.accountId} AND r.target_id = ${viewerId})))`,
    )).orderBy(desc(totals.giftXp), accountProfiles.nameKey);
  let otherCount = 0;
  const selected = rows.filter(row => row.giftXp >= GIFTING_LEVEL_THRESHOLDS[91]!
    || otherCount++ < 10);
  if (!selected.length) return { people: [] };
  const profiles = await db.select().from(accountProfiles)
    .where(inArray(accountProfiles.accountId, selected.map(row => row.accountId)));
  const byId = new Map(profiles.map(profile => [profile.accountId, profile]));
  return {
    people: await Promise.all(selected.map(async row => ({
      ...await person(viewerId, byId.get(row.accountId)!, undefined, false),
      giftXp: row.giftXp,
    }))),
  };
}
