import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, accountProfiles, socialWallets, socialSettings, chatAdmissions, socialGiftEvents, socialGiftBag } from '@workspace/db';
import { gift } from './rewards';
import { getMe } from './people';
import { relationship } from './people';
import { getProfile } from '../account-profiles';
import { roomGiftEvents } from './room-gifts';
import { roomStore } from '../room-store';
import { SPIRIT_PUP, spiritSplit } from './spirit-pup-policy';

test('Spirit Pup has one changeable price and an exact 50/50 split', () => {
  assert.equal(SPIRIT_PUP.cost, 100);
  assert.deepEqual(spiritSplit(), { recipientCredits: 50, houseCredits: 50 });
  assert.deepEqual(spiritSplit(101), { recipientCredits: 50, houseCredits: 51 });
});

test('development database: atomic split, bag, retry, funds, membership, blocks and room isolation', async t => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = [0, 1, 2].map(i => `spirit-fixture-${token}-${i}`);
  const names = [0, 1, 2].map(i => `pup${token}${i}`);
  const historyId = randomUUID(), overflowHistory = randomUUID();
  const roomId = `PUP${token}`.toUpperCase(), overflowId = `${roomId}2`;
  const stamp = new Date();
  t.after(async () => {
    await db.delete(socialGiftEvents).where(inArray(socialGiftEvents.historyId, [historyId, overflowHistory]));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(), displayName: `Pup test ${i}`,
    emojiId: 'neutral', gender: 'Male' as const, color: '#ffffff', hairColor: '#000000',
  })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  await db.insert(socialWallets).values(ids.map(accountId => ({ accountId, balance: 0 })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  roomStore.registerCommunity({ roomId, label: 'Pup test room', historyId, createdAt: stamp });
  roomStore.registerCommunity({ roomId: overflowId, label: 'Pup test room 2', historyId: overflowHistory, createdAt: stamp });
  const profiles = await Promise.all(ids.map(getProfile));
  const sessions = ids.map((accountId, i) => roomStore.join(roomId, names[i]!, { accountId, identity: profiles[i]!.identity }));
  const overflow = roomStore.join(overflowId, names[2]!, { accountId: ids[2]!, identity: profiles[2]!.identity });
  const context = { roomId, sessionId: sessions[0]!.participantSessionId };
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), context), /Not enough credits/);
  assert.equal((await getMe(ids[1]!)).giftQuantities[SPIRIT_PUP.id], undefined);
  await db.update(socialWallets).set({ balance: 200 }).where(eq(socialWallets.accountId, ids[0]!));
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID()), /university gift tab/);
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), { roomId, sessionId: sessions[1]!.participantSessionId }), /does not belong/);
  const key = randomUUID();
  await Promise.all([gift(ids[0]!, names[1]!, SPIRIT_PUP.id, key, context), gift(ids[0]!, names[1]!, SPIRIT_PUP.id, key, context)]);
  assert.equal((await getMe(ids[0]!)).wallet.balance, 100);
  assert.equal((await getMe(ids[1]!)).wallet.balance, 50);
  assert.equal((await getMe(ids[1]!)).giftQuantities[SPIRIT_PUP.id], 1);
  let receipts = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.houseCredits, 50);
  assert.equal((await roomGiftEvents(ids[2]!, roomId, sessions[2]!.participantSessionId)).events.length, 1, 'another room member receives the gift notice');
  assert.equal((await roomGiftEvents(ids[2]!, overflowId, overflow.participantSessionId)).events.length, 0);
  await assert.rejects(roomGiftEvents(ids[0]!, overflowId, context.sessionId), /does not belong/);
  await relationship(ids[1]!, names[0]!, 'block', true);
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), context), /blocked/);
  assert.equal((await roomGiftEvents(ids[1]!, roomId, sessions[1]!.participantSessionId)).events.length, 0);
  await relationship(ids[1]!, names[0]!, 'block', false);
  await relationship(ids[0]!, names[1]!, 'block', true);
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), context), /blocked/);
  await relationship(ids[0]!, names[1]!, 'block', false);
  roomStore.leave(roomId, sessions[2]!.participantSessionId);
  await assert.rejects(gift(ids[0]!, names[2]!, SPIRIT_PUP.id, randomUUID(), context), /no longer in/);
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, key, { roomId: overflowId, sessionId: overflow.participantSessionId }), /retry key/);
  await assert.rejects(gift(ids[0]!, names[0]!, SPIRIT_PUP.id, randomUUID(), context), /another person/);
  await assert.rejects(gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), { roomId: overflowId, sessionId: overflow.participantSessionId }), /does not belong/);
  await Promise.allSettled([gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), context), gift(ids[0]!, names[1]!, SPIRIT_PUP.id, randomUUID(), context)]);
  assert.equal((await getMe(ids[0]!)).wallet.balance, 0, 'concurrent sends cannot overdraw');
  const recipient = await getMe(ids[1]!);
  assert.equal(recipient.wallet.balance, 100);
  assert.equal(recipient.giftQuantities[SPIRIT_PUP.id], 2);
  assert.ok(recipient.inventory.includes(SPIRIT_PUP.id));
  receipts = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(receipts.reduce((sum, r) => sum + r.houseCredits, 0), 100);
  const [bag] = await db.select().from(socialGiftBag).where(and(eq(socialGiftBag.accountId, ids[1]!), eq(socialGiftBag.giftId, SPIRIT_PUP.id)));
  assert.equal(bag!.quantity, 2);
});
