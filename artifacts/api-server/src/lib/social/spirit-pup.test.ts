import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  db, accountProfiles, socialWallets, socialSettings, chatAdmissions, socialGiftEvents,
  socialGiftBag, giftStudioAssets, socialGiftCatalogSettings,
} from '@workspace/db';
import { gift, giftLedgerDebit, serializeGiftSends } from './rewards';
import { getMe } from './people';
import { relationship } from './people';
import { getProfile } from '../account-profiles';
import { roomGiftEvents } from './room-gifts';
import { roomStore } from '../room-store';
import { SPIRIT_PUP, spiritSplit } from './spirit-pup-policy';
import { MOONFOX } from './moonfox-policy';
import { giftCatalogWithActiveNames, listGiftCatalogForOwner, updateGiftCatalogItem } from '../gift-studio-catalog';
import { giftChargeTotal } from './gift-quantity';

test('Spirit Pup has one changeable price and an exact 50/50 split', () => {
  assert.equal(SPIRIT_PUP.cost, 100);
  assert.deepEqual(spiritSplit(), { recipientCredits: 50, houseCredits: 50 });
  assert.deepEqual(spiritSplit(101), { recipientCredits: 50, houseCredits: 51 });
});

test('Moonfox is a changeable 500-credit room gift with an even recipient/house split', () => {
  assert.equal(MOONFOX.cost, 500);
  assert.deepEqual(spiritSplit(MOONFOX.cost), { recipientCredits: 250, houseCredits: 250 });
});

test('unlimited test gifts record nominal value without debiting the wallet', () => {
  assert.equal(giftLedgerDebit(0, 2500, true), 2500);
  assert.equal(giftLedgerDebit(500, 500, false), 500);
});

test('gift sends for one room are accepted and published in FIFO server order', async () => {
  const scope = `gift-fifo-test:${randomUUID()}`;
  const order: string[] = [];
  const first = serializeGiftSends(scope, async () => {
    await new Promise(resolve => setTimeout(resolve, 15));
    order.push('sender one');
  });
  const second = serializeGiftSends(scope, async () => { order.push('sender two'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['sender one', 'sender two']);
});

test('development database: atomic split, bag, retry, funds, membership, blocks and room isolation', async t => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
  const item = (await listGiftCatalogForOwner()).find(candidate => candidate.status === 'active' && candidate.roomGift);
  if (!item) {
    t.skip('The development gift catalog has no active sendable room gifts.');
    return;
  }
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = [0, 1, 2].map(i => `spirit-fixture-${token}-${i}`);
  const names = [0, 1, 2].map(i => `pup${token}${i}`);
  const historyId = randomUUID(), overflowHistory = randomUUID();
  const roomId = `PUP${token}`.toUpperCase(), overflowId = `${roomId}2`;
  const stamp = new Date();
  t.after(async () => {
    await db.delete(socialGiftEvents).where(inArray(socialGiftEvents.historyId, [historyId, overflowHistory]));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
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
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), context), /Not enough coins/);
  assert.equal((await getMe(ids[1]!)).giftQuantities[item.id], undefined);
  await db.update(socialWallets).set({ balance: item.cost * 2 }).where(eq(socialWallets.accountId, ids[0]!));
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID()), /room or livestream gift panel/);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), { roomId, sessionId: sessions[1]!.participantSessionId }), /does not belong/);
  const key = randomUUID();
  await Promise.all([gift(ids[0]!, names[1]!, item.id, key, context), gift(ids[0]!, names[1]!, item.id, key, context)]);
  assert.equal((await getMe(ids[0]!)).wallet.balance, item.cost);
  assert.equal((await getMe(ids[1]!)).wallet.balance, spiritSplit(item.cost).recipientCredits);
  assert.equal((await getMe(ids[1]!)).giftQuantities[item.id], 1);
  let receipts = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.houseCredits, spiritSplit(item.cost).houseCredits);
  assert.equal((await roomGiftEvents(ids[2]!, roomId, sessions[2]!.participantSessionId)).events.length, 1, 'another room member receives the gift notice');
  assert.equal((await roomGiftEvents(ids[2]!, overflowId, overflow.participantSessionId)).events.length, 0);
  await assert.rejects(roomGiftEvents(ids[0]!, overflowId, context.sessionId), /does not belong/);
  await relationship(ids[1]!, names[0]!, 'block', true);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), context), /blocked/);
  assert.equal((await roomGiftEvents(ids[1]!, roomId, sessions[1]!.participantSessionId)).events.length, 0);
  await relationship(ids[1]!, names[0]!, 'block', false);
  await relationship(ids[0]!, names[1]!, 'block', true);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), context), /blocked/);
  await relationship(ids[0]!, names[1]!, 'block', false);
  roomStore.leave(roomId, sessions[2]!.participantSessionId);
  await assert.rejects(gift(ids[0]!, names[2]!, item.id, randomUUID(), context), /no longer in/);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, key, { roomId: overflowId, sessionId: overflow.participantSessionId }), /retry key/);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), { roomId: overflowId, sessionId: overflow.participantSessionId }), /does not belong/);
  await Promise.allSettled([gift(ids[0]!, names[1]!, item.id, randomUUID(), context), gift(ids[0]!, names[1]!, item.id, randomUUID(), context)]);
  assert.equal((await getMe(ids[0]!)).wallet.balance, 0, 'concurrent sends cannot overdraw');
  const recipient = await getMe(ids[1]!);
  assert.equal(recipient.wallet.balance, spiritSplit(item.cost).recipientCredits * 2);
  assert.equal(recipient.giftQuantities[item.id], 2);
  assert.ok(recipient.inventory.includes(item.id));
  receipts = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(receipts.reduce((sum, r) => sum + r.houseCredits, 0), spiritSplit(item.cost).houseCredits * 2);
  const [bag] = await db.select().from(socialGiftBag).where(and(eq(socialGiftBag.accountId, ids[1]!), eq(socialGiftBag.giftId, item.id)));
  assert.equal(bag!.quantity, 2);
});

test('development database: custom gift quantity is charged atomically, recorded and paged in order', async t => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
  const item = (await listGiftCatalogForOwner()).find(candidate => candidate.status === 'active' && candidate.roomGift);
  if (!item) {
    t.skip('The development gift catalog has no active sendable room gifts.');
    return;
  }
  const quantity = 37;
  const total = giftChargeTotal(item.cost, quantity);
  assert.notEqual(total, null);
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = [0, 1].map(index => `gift-quantity-fixture-${token}-${index}`);
  const names = [0, 1].map(index => `qty${token}${index}`);
  const historyId = randomUUID();
  const roomId = `QTY${token}`.toUpperCase();
  const stamp = new Date();
  t.after(async () => {
    await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    await db.delete(socialGiftBag).where(inArray(socialGiftBag.accountId, ids));
    await db.delete(socialWallets).where(inArray(socialWallets.accountId, ids));
    await db.delete(socialSettings).where(inArray(socialSettings.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
  });
  await db.insert(accountProfiles).values(ids.map((accountId, index) => ({
    accountId, username: names[index]!, nameKey: names[index]!.toLowerCase(),
    displayName: `Gift quantity test ${index}`, emojiId: 'neutral', gender: 'Male' as const,
    color: '#ffffff', hairColor: '#000000',
  })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  await db.insert(socialWallets).values(ids.map((accountId, index) => ({
    accountId, balance: index === 0 ? total! - 1 : 0,
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  roomStore.registerCommunity({ roomId, label: 'Gift quantity test room', historyId, createdAt: stamp });
  const profiles = await Promise.all(ids.map(getProfile));
  const sessions = ids.map((accountId, index) =>
    roomStore.join(roomId, names[index]!, { accountId, identity: profiles[index]!.identity }));
  const senderSession = sessions[0]!.participantSessionId;
  const recipientSession = sessions[1]!.participantSessionId;
  const senderBefore = await getMe(ids[0]!);
  const recipientBefore = await getMe(ids[1]!);

  await assert.rejects(
    gift(ids[0]!, names[1]!, item.id, randomUUID(), { roomId, sessionId: senderSession }, quantity),
    /Not enough coins/,
  );
  assert.equal((await getMe(ids[0]!)).wallet.balance, senderBefore.wallet.balance,
    'an underfunded quantity leaves the sender balance unchanged');
  assert.equal((await getMe(ids[1]!)).wallet.balance, recipientBefore.wallet.balance,
    'an underfunded quantity gives the recipient nothing');
  assert.equal((await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId))).length, 0);

  await db.update(socialWallets).set({ balance: total! }).where(eq(socialWallets.accountId, ids[0]!));
  await gift(ids[0]!, names[1]!, item.id, randomUUID(), { roomId, sessionId: senderSession }, quantity);
  assert.equal((await getMe(ids[0]!)).wallet.balance, 0);
  assert.equal((await getMe(ids[0]!)).wallet.sent, total);
  assert.equal((await getMe(ids[1]!)).wallet.balance, spiritSplit(total!).recipientCredits);
  assert.equal((await getMe(ids[1]!)).wallet.received, spiritSplit(total!).recipientCredits);
  assert.equal((await getMe(ids[1]!)).giftQuantities[item.id], quantity);

  const [receipt] = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(receipt?.quantity, quantity);
  assert.equal(receipt?.cost, total);
  assert.equal(receipt?.recipientCredits, spiritSplit(total!).recipientCredits);
  const page = await roomGiftEvents(ids[1]!, roomId, recipientSession, {
    since: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.quantity, quantity);
  assert.ok(page.nextCursor);
  const nextPage = await roomGiftEvents(ids[1]!, roomId, recipientSession, { after: page.nextCursor! });
  assert.equal(nextPage.events.length, 0);
});

test('development database: active catalog gifts create room animation events without changing their economics', async t => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
  const genericGift = (await listGiftCatalogForOwner()).find(item =>
    item.id === 'good-vibes' && item.status === 'active' && item.productType === 'gift');
  assert.ok(genericGift, 'Good vibes is an active built-in gift fixture');
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = [0, 1].map(index => `gift-display-fixture-${token}-${index}`);
  const names = [0, 1].map(index => `display${token}${index}`);
  const historyId = randomUUID();
  const roomId = `DISPLAY${token}`.toUpperCase();
  const assetId = randomUUID();
  const studioGiftId = `studio-${assetId}`;
  const customUnitCost = 37;
  const genericUnits = genericGift ? 100 : 0;
  const senderStartingBalance = (genericGift?.cost ?? 0) * genericUnits + customUnitCost * 100;
  const sessions: Array<{ participantSessionId: string }> = [];

  t.after(async () => {
    for (const session of sessions) roomStore.leave(roomId, session.participantSessionId);
    await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    await db.delete(socialGiftBag).where(inArray(socialGiftBag.accountId, ids));
    await db.delete(giftStudioAssets).where(eq(giftStudioAssets.id, assetId));
    await db.delete(socialGiftCatalogSettings).where(eq(socialGiftCatalogSettings.giftId, studioGiftId));
    await db.delete(socialWallets).where(inArray(socialWallets.accountId, ids));
    await db.delete(socialSettings).where(inArray(socialSettings.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
  });

  await db.insert(accountProfiles).values(ids.map((accountId, index) => ({
    accountId, username: names[index]!, nameKey: names[index]!.toLowerCase(),
    displayName: `Gift display fixture ${index}`, emojiId: 'neutral', gender: 'Male' as const,
    color: '#ffffff', hairColor: '#000000',
  })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  await db.insert(socialWallets).values(ids.map((accountId, index) => ({
    accountId, balance: index === 0 ? senderStartingBalance : 0,
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  await db.insert(socialGiftCatalogSettings).values({
    giftId: studioGiftId, displayName: 'Custom animation fixture', cost: customUnitCost,
    productType: 'gift', status: 'active',
  });
  await db.insert(giftStudioAssets).values({
    id: assetId, ownerId: ids[0]!, giftId: studioGiftId, version: 1, status: 'active',
    originalName: 'fixture.mp4', originalExtension: 'mp4', durationMs: 1000,
    originalBytes: 1, webmBytes: 1, safariBytes: 1,
    settings: { draftName: 'Custom animation fixture', productType: 'gift' },
    activatedAt: new Date(),
  });
  const meCatalog = (await getMe(ids[0]!)).gifts;
  assert.ok(meCatalog.some(item => item.id === studioGiftId && item.name === 'Custom animation fixture' && item.cost === customUnitCost),
    'an active Gift Studio gift is present in the same /social/me catalog consumed by Store and room gift box');
  const sendableCatalog = await giftCatalogWithActiveNames();
  assert.deepEqual(
    meCatalog.map(({ id, name, cost, iconUrl }) => ({ id, name, cost, iconUrl })).sort((a, b) => a.id.localeCompare(b.id)),
    sendableCatalog.map(({ id, name, cost, iconUrl }) => ({ id, name, cost, iconUrl })).sort((a, b) => a.id.localeCompare(b.id)),
    'the profile/Store feed and the room gift catalog serialize the same active sendable items',
  );
  roomStore.registerCommunity({ roomId, label: 'Gift display fixture room', historyId, createdAt: new Date() });
  const profiles = await Promise.all(ids.map(getProfile));
  sessions.push(...ids.map((accountId, index) =>
    roomStore.join(roomId, names[index]!, { accountId, identity: profiles[index]!.identity })));

  const expected: Array<{ giftId: string; quantity: number }> = [];
  if (genericGift) {
    for (const quantity of [1, 99]) {
      await gift(ids[0]!, names[1]!, genericGift.id, randomUUID(),
        { roomId, sessionId: sessions[0]!.participantSessionId }, quantity);
      expected.push({ giftId: genericGift.id, quantity });
    }
  }
  for (const quantity of [1, 99]) {
    await gift(ids[0]!, names[1]!, studioGiftId, randomUUID(),
      { roomId, sessionId: sessions[0]!.participantSessionId }, quantity);
    expected.push({ giftId: studioGiftId, quantity });
  }

  const totalGenericCost = (genericGift?.cost ?? 0) * genericUnits;
  const totalCustomCost = customUnitCost * 100;
  const customRecipientCredits = spiritSplit(customUnitCost).recipientCredits
    + spiritSplit(customUnitCost * 99).recipientCredits;
  const senderAfter = await getMe(ids[0]!);
  const recipientAfter = await getMe(ids[1]!);
  assert.equal(senderAfter.wallet.balance, 0);
  assert.equal(senderAfter.wallet.sent, totalGenericCost + totalCustomCost);
  assert.equal(recipientAfter.wallet.balance,
    totalGenericCost + customRecipientCredits,
    'the pre-existing full-credit generic-gift path and room-gift split remain unchanged');
  assert.equal(recipientAfter.giftQuantities[studioGiftId], 100);
  assert.equal(recipientAfter.giftQuantities[genericGift?.id ?? 'not-present'], undefined,
    'the generic gift inventory behavior is unchanged');

  const receipts = await db.select().from(socialGiftEvents)
    .where(eq(socialGiftEvents.historyId, historyId))
    .orderBy(asc(socialGiftEvents.eventOrder));
  assert.deepEqual(receipts.map(({ giftId, quantity }) => ({ giftId, quantity })), expected);
  assert.equal(receipts.reduce((sum, event) => sum + event.cost, 0), totalGenericCost + totalCustomCost);

  const senderEvents = await roomGiftEvents(ids[0]!, roomId, sessions[0]!.participantSessionId);
  const viewerEvents = await roomGiftEvents(ids[1]!, roomId, sessions[1]!.participantSessionId);
  assert.deepEqual(senderEvents.events.map(({ id, giftId, quantity }) => ({ id, giftId, quantity })),
    viewerEvents.events.map(({ id, giftId, quantity }) => ({ id, giftId, quantity })),
    'the sender and a second room member receive the same animation events');
  assert.deepEqual(viewerEvents.events.map(({ giftId, quantity }) => ({ giftId, quantity })), expected);

  await updateGiftCatalogItem({ giftId: studioGiftId, status: 'inactive' });
  assert.equal((await getMe(ids[0]!)).gifts.some(item => item.id === studioGiftId), false,
    'an inactive gift disappears from the shared catalog used by Store and room panels');
  await updateGiftCatalogItem({ giftId: studioGiftId, status: 'active' });
  assert.equal((await getMe(ids[0]!)).gifts.some(item => item.id === studioGiftId), true,
    'reactivating the gift makes it available in both panels again');
  await updateGiftCatalogItem({ giftId: studioGiftId, status: 'deleted' });
  assert.equal((await getMe(ids[0]!)).gifts.some(item => item.id === studioGiftId), false,
    'a deleted gift disappears from the shared Store and room gift catalog');
  assert.equal((await giftCatalogWithActiveNames()).some(item => item.id === studioGiftId), false);
  await db.update(socialWallets).set({ balance: 10_000 }).where(eq(socialWallets.accountId, ids[0]!));
  const beforeRejectedSend = await getMe(ids[0]!);
  await assert.rejects(
    gift(ids[0]!, names[1]!, studioGiftId, randomUUID(),
      { roomId, sessionId: sessions[0]!.participantSessionId }, 1),
    /This gift isn't available right now\./,
  );
  assert.equal((await getMe(ids[0]!)).wallet.balance, beforeRejectedSend.wallet.balance,
    'a stale deleted-gift send is rejected before any coin is charged');
  assert.equal((await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId))).length,
    receipts.length, 'a rejected send does not create a room animation receipt');
});

test('development database: Moonfox charges once, splits 250/250, enters the bag and stays room-isolated', async t => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
  const item = (await listGiftCatalogForOwner()).find(candidate =>
    candidate.id === MOONFOX.id && candidate.status === 'active' && candidate.roomGift);
  if (!item) {
    t.skip('Moonfox is not an active sendable gift in the current development catalog.');
    return;
  }
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = [0, 1].map(i => `moonfox-fixture-${token}-${i}`);
  const names = [0, 1].map(i => `fox${token}${i}`);
  const historyId = randomUUID(), otherHistoryId = randomUUID();
  const roomId = `FOX${token}`.toUpperCase(), otherRoomId = `${roomId}2`;
  const stamp = new Date();
  t.after(async () => {
    await db.delete(socialGiftEvents).where(inArray(socialGiftEvents.historyId, [historyId, otherHistoryId]));
    await db.delete(socialGiftBag).where(inArray(socialGiftBag.accountId, ids));
    await db.delete(socialWallets).where(inArray(socialWallets.accountId, ids));
    await db.delete(socialSettings).where(inArray(socialSettings.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(), displayName: `Moonfox test ${i}`,
    emojiId: 'neutral', gender: 'Male' as const, color: '#ffffff', hairColor: '#000000',
  })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  await db.insert(socialWallets).values(ids.map((accountId, i) => ({ accountId, balance: i === 0 ? item.cost : 0 })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  roomStore.registerCommunity({ roomId, label: 'Moonfox test room', historyId, createdAt: stamp });
  roomStore.registerCommunity({ roomId: otherRoomId, label: 'Moonfox test room 2', historyId: otherHistoryId, createdAt: stamp });
  const profiles = await Promise.all(ids.map(getProfile));
  const sessions = ids.map((accountId, i) => roomStore.join(roomId, names[i]!, { accountId, identity: profiles[i]!.identity }));
  const otherSession = roomStore.join(otherRoomId, names[1]!, { accountId: ids[1]!, identity: profiles[1]!.identity });
  const context = { roomId, sessionId: sessions[0]!.participantSessionId };
  const key = randomUUID();
  await gift(ids[0]!, names[1]!, item.id, key, context);
  await gift(ids[0]!, names[1]!, item.id, key, context);
  const sender = await getMe(ids[0]!);
  const recipient = await getMe(ids[1]!);
  assert.equal(sender.wallet.balance, 0);
  assert.equal(recipient.wallet.balance, spiritSplit(item.cost).recipientCredits);
  assert.equal(recipient.giftQuantities[item.id], 1);
  const events = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.giftId, item.id);
  assert.equal(events[0]!.cost, item.cost);
  assert.equal(events[0]!.recipientCredits, spiritSplit(item.cost).recipientCredits);
  assert.equal(events[0]!.houseCredits, spiritSplit(item.cost).houseCredits);
  assert.equal((await roomGiftEvents(ids[1]!, roomId, sessions[1]!.participantSessionId)).events.length, 1);
  assert.equal((await roomGiftEvents(ids[1]!, otherRoomId, otherSession.participantSessionId)).events.length, 0);
  await assert.rejects(gift(ids[0]!, names[1]!, item.id, randomUUID(), context), /Not enough coins/);
  assert.equal((await getMe(ids[1]!)).giftQuantities[item.id], 1);

  await db.update(socialWallets).set({ balance: item.cost }).where(eq(socialWallets.accountId, ids[0]!));
  await gift(ids[0]!, names[0]!, item.id, randomUUID(), { roomId, sessionId: sessions[0]!.participantSessionId });
  const self = await getMe(ids[0]!);
  assert.equal(self.wallet.balance, spiritSplit(item.cost).recipientCredits,
    'self-gifting charges the full price, then credits the recipient share');
  assert.equal(self.wallet.sent, item.cost * 2);
  assert.equal(self.wallet.received, spiritSplit(item.cost).recipientCredits);
  assert.equal(self.giftQuantities[item.id], 1);
  const selfRoomNotices = (await roomGiftEvents(ids[0]!, roomId, sessions[0]!.participantSessionId)).events;
  assert.ok(selfRoomNotices.some(event =>
    event.senderUsername === names[0] && event.recipientUsername === names[0] && event.giftId === item.id),
  'the sender receives the same room animation event for a self-gift');
  const selfReceipt = (await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId)))
    .find(event => event.senderId === ids[0] && event.recipientId === ids[0]);
  assert.equal(selfReceipt?.cost, item.cost);
  assert.equal(selfReceipt?.recipientCredits, spiritSplit(item.cost).recipientCredits);
  assert.equal(selfReceipt?.houseCredits, spiritSplit(item.cost).houseCredits);
});
