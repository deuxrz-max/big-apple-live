import { db, socialInventory, socialLoginStreaks } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { lockAccounts, type Tx } from './core';
import { MARATHON, extendMarathon, nextLoginStreak } from './marathon-policy';

export async function grantMarathon(tx: Tx, id: string, days: number, now: Date) {
  const [owned] = await tx.select().from(socialInventory).where(and(
    eq(socialInventory.accountId, id), eq(socialInventory.itemId, MARATHON.id),
  ));
  const expiresAt = extendMarathon(now, owned?.expiresAt, days);
  await tx.insert(socialInventory).values({ accountId: id, itemId: MARATHON.id, expiresAt, purchasedAt: now })
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
    if (next.award) await grantMarathon(tx, id, MARATHON.earnedDays, now);
    return next.count;
  });
}
