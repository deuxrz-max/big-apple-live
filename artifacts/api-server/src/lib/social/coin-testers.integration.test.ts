import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { accountProfiles, accountRoomEntranceEffects, chatAdmissions, coinTestActions, coinTesters,
  db, giftStudioAssets, socialGiftBag, socialGiftBagLots, socialGiftCatalogSettings,
  socialGiftEvents, socialLedger, socialSettings, socialWallets } from "@workspace/db";
import { getMe } from "./people";
import { gift, purchase } from "./rewards";
import { listCoinTesters, setCoinTester, testerState } from "./coin-testers";
import { purchaseEntranceEffect, equipEntranceEffect, listEntranceEffectShop } from "./entrance-effect-shop";
import { requireOwner } from "../community";
import { nameColorProfileForAccount } from "./gift-name-color-data";
import { roomStore } from "../room-store";
import { liveStreamIdForAccount } from "../live-stream-policy";
import { GetSocialMeResponse } from "@workspace/api-zod";

test("explicit tester grants isolate every test purchase/send from paid money and inventory", async t => {
  assert.equal(process.env.NODE_ENV, "development");
  const token = randomUUID();
  const ids = [`coin-fixture-${token}-a`, `coin-fixture-${token}-b`];
  const names = [`Coin_${token.slice(0, 8)}_a`, `Coin_${token.slice(0, 8)}_b`];
  const giftId = `studio-${randomUUID()}`;
  const effectId = `studio-${randomUUID()}`;
  const roomId = `COIN-${token.slice(0, 8)}`.toUpperCase();
  const historyId = `coin-fixture-${token}`;
  const sentTestKey = randomUUID();
  // Owner identity is only read to exercise the same authorization as the HTTP route.
  // No owner settings, messages, wallet or grants are changed.
  const [owner] = await db.select().from(accountProfiles).where(and(
    eq(accountProfiles.nameKey, "vampsquad"), eq(accountProfiles.isTestAccount, false)));
  assert.ok(owner, "Canonical owner must already exist; never seed one");
  t.after(async () => {
    roomStore.deactivateCommunity(roomId);
    await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    await db.delete(socialGiftCatalogSettings).where(inArray(socialGiftCatalogSettings.giftId, [giftId, effectId]));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(),
    emojiId: "1F600", gender: "Male" as const, color: "#FFFFFF", hairColor: "#000000", isTestAccount: true,
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  for (const id of ids) await getMe(id);
  await db.update(socialSettings).set({ discoverable: true }).where(inArray(socialSettings.accountId, ids));
  await db.update(socialWallets).set({ balance: 1000 }).where(inArray(socialWallets.accountId, ids));
  for (const [id, type] of [[giftId, "gift"], [effectId, "entrance-effect"]] as const) {
    await db.insert(socialGiftCatalogSettings).values({ giftId: id, cost: 20, productType: type });
    await db.insert(giftStudioAssets).values({
      ownerId: ids[0]!, giftId: id, version: 1, status: "active", originalName: "coin-fixture.webm",
      originalExtension: "webm", durationMs: 1000, originalBytes: 1, webmBytes: 1, safariBytes: 1,
      settings: { draftName: `Isolated ${type} fixture` },
    });
  }
  roomStore.registerCommunity({ roomId, historyId, label: "Coin fixture", createdAt: new Date(), testOnly: true });
  const identity = { emojiId: "1F600", gender: "Male" as const, color: "#FFFFFF", hairColor: "#000000" };
  const session = roomStore.join(roomId, names[0]!, { accountId: ids[0]!, identity });
  roomStore.join(roomId, names[1]!, { accountId: ids[1]!, identity });
  const context = { roomId, sessionId: session.participantSessionId };
  const wallets = () => db.select().from(socialWallets).where(inArray(socialWallets.accountId, ids)).orderBy(socialWallets.accountId);
  const paidLedger = () => db.select().from(socialLedger).where(inArray(socialLedger.accountId, ids));
  const sendTest = (key = randomUUID(), bagOnly = false) =>
    gift(ids[0]!, names[1]!, giftId, key, context, 1, bagOnly, true);

  await t.test("no implicit grants, exact owner designation, no unrelated admin access", async () => {
    assert.equal((await getMe(ids[0]!)).wallet.unlimited, false);
    assert.equal(await testerState(owner.accountId), null);
    await assert.rejects(setCoinTester(ids[0]!, names[0]!, true), /Owner access/);
    await assert.rejects(listCoinTesters(ids[0]!), /Owner access/);
    await assert.rejects(setCoinTester(owner.accountId, `No_${token.slice(0, 8)}`, true), /No account/);
    await setCoinTester(owner.accountId, names[0]!, true);
    assert.equal(GetSocialMeResponse.parse(await getMe(ids[0]!)).wallet.unlimited, true);
    assert.equal((await getMe(ids[1]!)).wallet.unlimited, false);
    await assert.rejects(requireOwner(ids[0]!), /Owner access/);
  });
  await t.test("room test gifts animate, never mint money, recipient stock, XP or house revenue", async () => {
    const before = await wallets();
    const xp = await nameColorProfileForAccount(ids[0]!);
    const key = sentTestKey;
    await Promise.all([sendTest(key), sendTest(key), sendTest(key)]);
    assert.deepEqual(await wallets(), before);
    assert.deepEqual(await paidLedger(), []);
    assert.equal((await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased, xp.lifetimeCoinsPurchased);
    assert.deepEqual(await db.select().from(socialGiftBag).where(inArray(socialGiftBag.accountId, ids)), []);
    const events = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    assert.equal(events.length, 1, "one animation event per idempotent send");
    assert.equal(events[0]!.testMode, true);
    assert.equal(events[0]!.cost, 0);
    assert.equal(events[0]!.recipientCredits, 0);
    assert.equal(events[0]!.houseCredits, 0);
  });
  await t.test("designated testers cannot send direct/private gifts either", async () => {
    const before = await wallets();
    const receipts = await paidLedger();
    await assert.rejects(gift(ids[0]!, names[1]!, giftId, randomUUID(), undefined, 99, false, true),
      /Direct\/private-message gifts are disabled/);
    assert.deepEqual(await wallets(), before);
    assert.deepEqual(await paidLedger(), receipts);
  });
  await t.test("livestream test gifts return an animation without invoking PK scoring", async () => {
    // Service-level stream context, not a real live camera or browser fixture.
    const before = await wallets();
    const result = await gift(ids[0]!, names[0]!, giftId, randomUUID(),
      { streamId: liveStreamIdForAccount(ids[0]!) }, 10, false, true);
    assert.ok("liveGiftEvent" in result && result.liveGiftEvent);
    assert.equal(result.liveGiftEvent.cost, 0);
    assert.equal(result.liveGiftEvent.quantity, 10);
    assert.deepEqual(await wallets(), before);
  });
  await t.test("test My Bag purchases and sends are isolated and expire after a week", async () => {
    await db.insert(socialGiftBag).values({ accountId: ids[0]!, giftId, quantity: 2 });
    await db.insert(socialGiftBagLots).values({ accountId: ids[0]!, giftId, quantity: 2, source: "reward" });
    const before = await wallets();
    const key = randomUUID();
    await Promise.all([purchase(ids[0]!, giftId, key, true), purchase(ids[0]!, giftId, key, true)]);
    const me = GetSocialMeResponse.parse(await getMe(ids[0]!));
    assert.equal(me.giftQuantities?.[giftId], 1, "test bag does not expose or spend paid/reward inventory");
    assert.ok(new Date(me.giftBagLots![0]!.expiresAt!).getTime() > Date.now() + 6.99 * 86400000);
    await sendTest(randomUUID(), true);
    assert.equal((await getMe(ids[0]!)).giftQuantities[giftId] ?? 0, 0);
    assert.equal((await db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, ids[0]!)))[0]!.quantity, 2);
    await purchase(ids[0]!, giftId, randomUUID(), true);
    await db.update(coinTesters).set({ bag: [{ giftId, quantity: 1, expiresAt: new Date(0).toISOString() }] })
      .where(eq(coinTesters.accountId, ids[0]!));
    await assert.rejects(sendTest(randomUUID(), true), /no longer available/);
    assert.deepEqual(await wallets(), before);
    assert.deepEqual(await paidLedger(), []);
  });
  await t.test("test effects stay separate, equip and revoke without minting paid ownership", async () => {
    const before = await wallets();
    await purchaseEntranceEffect(ids[0]!, effectId, randomUUID(), true);
    assert.ok((await listEntranceEffectShop(ids[0]!)).items.find(item => item.id === effectId)?.owned);
    await equipEntranceEffect(ids[0]!, effectId);
    assert.deepEqual(await db.select().from(accountRoomEntranceEffects).where(eq(accountRoomEntranceEffects.accountId, ids[0]!)), []);
    await setCoinTester(owner.accountId, names[0]!, false);
    const [settings] = await db.select().from(socialSettings).where(eq(socialSettings.accountId, ids[0]!));
    assert.equal(settings!.equippedEntranceEffectId, null);
    assert.equal((await listEntranceEffectShop(ids[0]!)).items.find(item => item.id === effectId)?.owned, false);
    assert.deepEqual(await wallets(), before);
  });
  await t.test("revocation blocks stale test sends; retries never become real charges", async () => {
    const before = await wallets();
    await assert.rejects(sendTest(), /test-coin access changed/);
    await assert.rejects(purchase(ids[0]!, giftId, randomUUID(), true), /test-coin access changed/);
    const [receipt] = await db.select().from(coinTestActions).where(and(
      eq(coinTestActions.accountId, ids[0]!), eq(coinTestActions.requestKey, sentTestKey)));
    assert.ok(receipt);
    await sendTest(sentTestKey);
    await assert.rejects(gift(ids[0]!, names[0]!, giftId, receipt.requestKey, context, 1, false, true), /different action/);
    assert.deepEqual(await wallets(), before);
  });
  await t.test("ordinary paid gifting and paid bag return unchanged after revocation", async () => {
    const me = await getMe(ids[0]!);
    assert.equal(me.wallet.unlimited, false);
    assert.equal(me.giftQuantities[giftId], 2);
    await gift(ids[0]!, names[1]!, giftId, randomUUID(), context, 1, true);
    const rows = await wallets();
    assert.equal(rows[0]!.balance, 1000, "paid held gift does not charge twice");
    assert.ok(rows[1]!.balance > 1000);
    assert.equal((await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased, 20);
    await db.update(socialWallets).set({ balance: 0 }).where(eq(socialWallets.accountId, ids[0]!));
    // Drain last held paid gift, then ordinary insufficient-funds behavior.
    await gift(ids[0]!, names[1]!, giftId, randomUUID(), context, 1, true);
    await assert.rejects(gift(ids[0]!, names[1]!, giftId, randomUUID(), context), /Not enough coins/);
  });
});
