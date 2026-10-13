import { db, socialLoginStreaks } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { lockAccounts } from './core';
import { nextLoginStreak } from './marathon-policy';

/** Called only on the authenticated own-profile path, never for viewing another user. */
export async function recordDailyLogin(id: string, now = new Date()) {
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    const [row] = await tx.select().from(socialLoginStreaks).where(eq(socialLoginStreaks.accountId, id));
    const next = nextLoginStreak(row, now);
    if (!next.changed) return next.count;
    await tx.insert(socialLoginStreaks).values({ accountId: id, lastLoginDay: next.day, consecutiveDays: next.count })
      .onConflictDoUpdate({ target: socialLoginStreaks.accountId, set: { lastLoginDay: next.day, consecutiveDays: next.count } });
    return next.count;
  });
}
