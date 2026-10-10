import { db, socialInventory, socialLoginStreaks } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { lockAccounts, type Tx } from './core';
import { NIGHT_OWL, TIMED_BADGES, extendMarathon, nextLoginStreak, type TimedBadgePolicy } from './marathon-policy';

export async function grantTimedBadge(tx: Tx, id: string, badge: TimedBadgePolicy, days: number, now: Date) {
  const [owned] = await tx.select().from(socialInventory).where(and(
    eq(socialInventory.accountId, id), eq(socialInventory.itemId, badge.id),
  ));
  // Pre-existing Night Owl purchases promised permanent ownership.
  if (badge.id === NIGHT_OWL.id && owned && !owned.expiresAt) return null;
  const expiresAt = extendMarathon(now, owned?.expiresAt, days);
  await tx.insert(socialInventory).values({ accountId: id, itemId: badge.id, expiresAt, purchasedAt: now })
    .onConflictDoUpdate({ target: [socialInventory.accountId, socialInventory.itemId], set: { expiresAt } });
  return expiresAt;
}

/** Called only on the authenticated own-profile path, never for viewing another user. */
export async function recordDailyLogin(id: string, now = new Date()) {
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    const [row] = await tx.select().from(socialLoginStreaks).where(eq(socialLoginStreaks.accountId, id));
    const next = nextLoginStreak(row, now);
    if (!next.changed) return next.count;
    await tx.insert(socialLoginStreaks).values({ accountId: id, lastLoginDay: next.day, consecutiveDays: next.count })
      .onConflictDoUpdate({ target: socialLoginStreaks.accountId, set: { lastLoginDay: next.day, consecutiveDays: next.count } });
    for (const badge of TIMED_BADGES) {
      if (next.count % badge.streakDays === 0) await grantTimedBadge(tx, id, badge, badge.earnedDays, now);
    }
    return next.count;
  });
}
