import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { db, accountProfiles, socialWallets, socialInventory, socialSettings, socialLedger } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { nextLoginStreak, extendMarathon, MARATHON } from './marathon-policy';
import { recordDailyLogin } from './marathon';
import { getMe, getPerson, saveSocialProfile } from './people';
import { purchase } from './rewards';

test('UTC streak handles repeats, boundaries, gaps and recurring seven-day milestones', () => {
  let previous: { lastLoginDay: string; consecutiveDays: number } | undefined;
  for (let day = 1; day <= 14; day++) {
    const now = new Date(Date.UTC(2090, 0, day, 23, 59));
    const next = nextLoginStreak(previous, now);
    assert.equal(next.count, day);
    assert.equal(next.award, day % 7 === 0);
    previous = { lastLoginDay: next.day, consecutiveDays: next.count };
    assert.equal(nextLoginStreak(previous, now).award, false);
  }
  assert.equal(nextLoginStreak(previous, new Date('2090-01-16T00:00:00Z')).count, 1);
  const midnight = nextLoginStreak({ lastLoginDay: '2090-01-01', consecutiveDays: 1 }, new Date('2090-01-02T00:00:00Z'));
  assert.equal(midnight.count, 2);
  assert.equal(nextLoginStreak({ lastLoginDay: '2090-01-02', consecutiveDays: 2 }, new Date('2090-01-01T23:00:00Z')).changed, false);
});

test('grants preserve remaining time and expired badges restart now', () => {
  const now = new Date('2090-01-01T00:00:00Z');
  assert.equal(extendMarathon(now, new Date('2090-01-05T00:00:00Z'), 3).toISOString(), '2090-01-08T00:00:00.000Z');
  assert.equal(extendMarathon(now, new Date('2089-01-01T00:00:00Z'), 7).toISOString(), '2090-01-08T00:00:00.000Z');
});

test('development DB: free award, atomic debit, retries, renewal, expiry and legacy ownership', async t => {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Fixtures must never run in production');
  const token = randomUUID().replaceAll('-', '').slice(0, 8);
  const id = `marathon-fixture-${token}`;
  const username = `Marathon_${token}`;
  t.after(async () => {
    await db.delete(accountProfiles).where(eq(accountProfiles.accountId, id));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values({
    accountId: id, username, nameKey: username.toLowerCase(),
    emojiId: 'neutral', gender: 'Male', color: '#ffffff', hairColor: '#000000',
  });
  await getMe(id);
  await db.insert(socialInventory).values({ accountId: id, itemId: 'beam-champion' });
  await db.update(socialWallets).set({ balance: 199 }).where(eq(socialWallets.accountId, id));
  await assert.rejects(purchase(id, MARATHON.id, randomUUID()), /Not enough credits/);
  assert.equal((await getMe(id)).wallet.balance, 199);
  assert.equal((await getMe(id)).inventory.includes(MARATHON.id), false);

  for (let day = 1; day <= 6; day++) await recordDailyLogin(id, new Date(Date.UTC(2090, 0, day)));
  assert.equal((await getMe(id)).inventory.includes(MARATHON.id), false);
  await Promise.all(Array.from({ length: 5 }, () => recordDailyLogin(id, new Date('2090-01-07T00:00:00Z'))));
  let me = await getMe(id);
  assert.equal(me.loginStreak, 7);
  assert.equal(me.badgeExpirations[MARATHON.id], '2090-01-14T00:00:00.000Z');
  assert.equal(me.wallet.balance, 199, 'free grant changes no credits');
  assert.ok(me.inventory.includes('beam-champion'), 'legacy ownership stays intact');

  await db.update(socialWallets).set({ balance: 600 }).where(eq(socialWallets.accountId, id));
  const key = randomUUID();
  await Promise.all([purchase(id, MARATHON.id, key), purchase(id, MARATHON.id, key)]);
  me = await getMe(id);
  assert.equal(me.wallet.balance, 400);
  assert.equal(me.badgeExpirations[MARATHON.id], '2090-01-17T00:00:00.000Z');
  await purchase(id, MARATHON.id, randomUUID());
  assert.equal((await getMe(id)).wallet.balance, 200);
  assert.equal((await getMe(id)).badgeExpirations[MARATHON.id], '2090-01-20T00:00:00.000Z');
  const ledger = await db.select().from(socialLedger).where(and(eq(socialLedger.accountId, id), eq(socialLedger.kind, 'purchase')));
  assert.equal(ledger.length, 2);
  await db.update(socialInventory).set({ expiresAt: new Date('2000-01-01T00:00:00Z') })
    .where(and(eq(socialInventory.accountId, id), eq(socialInventory.itemId, MARATHON.id)));
  me = await getMe(id);
  assert.equal(me.inventory.includes(MARATHON.id), false);
  assert.equal(me.profile.badgeId, null);
  assert.equal(me.profile.badges?.some(b => b.id === MARATHON.id), false);
  assert.equal((await getPerson(id, username)).badgeId, null);
  await assert.rejects(saveSocialProfile(id, { bio: '', country: null, interests: [], discoverable: true, badgeId: MARATHON.id }), /Only owned/);
  const [settings] = await db.select().from(socialSettings).where(eq(socialSettings.accountId, id));
  assert.equal(settings.badgeId, MARATHON.id, 'expiry hides display without deleting history');
  await purchase(id, MARATHON.id, randomUUID());
  me = await getMe(id);
  assert.equal(me.wallet.balance, 0);
  const left = new Date(me.badgeExpirations[MARATHON.id]).getTime() - Date.now();
  assert.ok(left > 3 * 86400000 - 10000 && left <= 3 * 86400000);
});
