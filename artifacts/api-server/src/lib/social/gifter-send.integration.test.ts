import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db, accountProfiles, chatAdmissions, giftStudioAssets, socialGiftCatalogSettings,
  socialGiftEvents, socialLedger, socialWallets, socialSettings,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getMe } from "./people";
import { gift, purchase } from "./rewards";
import { getGiftCatalogItem, updateGiftCatalogItem } from "../gift-studio-catalog";
import { nameColorProfileForAccount, setNameColorPurchaseTotalOverride } from "./gift-name-color-data";
import { roomStore } from "../room-store";
import { GetSocialMeResponse } from "@workspace/api-zod";

test("gifter XP, exclusivity and atomic spending with isolated development fixtures", async t => {
  if (process.env.NODE_ENV !== "development") throw new Error("Development-only gift fixture");
  const token = randomUUID();
  const ids = [`gifter-test-${token}-a`, `gifter-test-${token}-b`];
  const names = [`Gifter_${token.slice(0, 8)}_a`, `Gifter_${token.slice(0, 8)}_b`];
  const giftId = `studio-${randomUUID()}`;
  const roomId = `GIFTER-${token.slice(0, 8)}`.toUpperCase();
  const historyId = `gifter-history-${token}`;
  t.after(async () => {
    for (const id of ids) setNameColorPurchaseTotalOverride(id, null);
    roomStore.deactivateCommunity(roomId);
    await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    await db.delete(socialGiftCatalogSettings).where(eq(socialGiftCatalogSettings.giftId, giftId));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(),
    emojiId: "1F600", gender: "Male" as const, color: "#FFFFFF", hairColor: "#000000",
    isTestAccount: true,
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  for (const id of ids) await getMe(id);
  await db.update(socialSettings).set({ discoverable: true }).where(inArray(socialSettings.accountId, ids));
  await db.update(socialWallets).set({ balance: 1_000_000 }).where(eq(socialWallets.accountId, ids[0]!));
  await db.insert(socialGiftCatalogSettings).values({ giftId, cost: 20, productType: "gift" });
  await db.insert(giftStudioAssets).values({
    ownerId: ids[0]!, giftId, version: 1, status: "active",
    originalName: "isolated-fixture.webm", originalExtension: "webm", durationMs: 1000,
    originalBytes: 1, webmBytes: 1, safariBytes: 1, settings: { draftName: "Isolated gifter fixture" },
  });
  roomStore.registerCommunity({ roomId, historyId, label: "Isolated gifter test", createdAt: new Date(), testOnly: true });
  const identity = { emojiId: "1F600", gender: "Male" as const, color: "#FFFFFF", hairColor: "#000000" };
  const session = roomStore.join(roomId, names[0]!, { accountId: ids[0]!, identity });
  roomStore.join(roomId, names[1]!, { accountId: ids[1]!, identity });
  const context = { roomId, sessionId: session.participantSessionId };
  const balance = async () => (await getMe(ids[0]!)).wallet.balance;

  await t.test("first gift earns Level 1; quantity total counts once under concurrent retry", async () => {
    const before = await balance();
    await gift(ids[0]!, names[1]!, giftId, randomUUID(), context);
    assert.equal((await nameColorProfileForAccount(ids[0]!)).tierIndex, 1);
    assert.equal((await nameColorProfileForAccount(ids[1]!)).tierIndex, 0);
    const key = randomUUID();
    await Promise.all([1, 2, 3].map(() => gift(ids[0]!, names[1]!, giftId, key, context, 10)));
    assert.equal(await balance(), before - 220);
    const me = GetSocialMeResponse.parse(await getMe(ids[0]!));
    assert.equal(me.nameColorProgress.lifetimeCoinsPurchased, 220);
    assert.equal(me.nameColorProgress.tierIndex, 2);
    assert.equal(me.gifterAccessLevel, 2);
  });
  await t.test("insufficient balance has no charge, no XP and no recipient XP", async () => {
    const before = await balance();
    const xp = (await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased;
    await db.update(socialWallets).set({ balance: 0 }).where(eq(socialWallets.accountId, ids[0]!));
    await assert.rejects(gift(ids[0]!, names[1]!, giftId, randomUUID(), context), /Not enough coins/);
    assert.equal(await balance(), 0);
    assert.equal((await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased, xp);
    await db.update(socialWallets).set({ balance: before }).where(eq(socialWallets.accountId, ids[0]!));
  });
  await t.test("Studio exclusivity persists; preview level cannot bypass purchase or send authorization", async () => {
    assert.equal((await getGiftCatalogItem(giftId))!.platinumExclusive, false);
    await updateGiftCatalogItem({ giftId, platinumExclusive: true });
    assert.equal((await getGiftCatalogItem(giftId))!.platinumExclusive, true);
    const before = await balance();
    setNameColorPurchaseTotalOverride(ids[0]!, 2_995_500);
    assert.equal((await getMe(ids[0]!)).gifterAccessLevel, 2);
    await assert.rejects(gift(ids[0]!, names[1]!, giftId, randomUUID(), context), /Level 61/);
    await assert.rejects(purchase(ids[0]!, giftId, randomUUID()), /Level 61/);
    assert.equal(await balance(), before);
    setNameColorPurchaseTotalOverride(ids[0]!, null);
  });
  await t.test("Platinum unlocks from existing successful total, store purchase adds no XP", async () => {
    await db.insert(socialLedger).values({
      accountId: ids[0]!, kind: "gift_sent", delta: -(355000 - 220),
      description: "Isolated historical successful gifting fixture",
    });
    assert.equal((await nameColorProfileForAccount(ids[0]!)).tierIndex, 61);
    await purchase(ids[0]!, giftId, randomUUID());
    assert.equal((await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased, 355000);
    await gift(ids[0]!, names[1]!, giftId, randomUUID(), context);
    assert.equal((await nameColorProfileForAccount(ids[0]!)).lifetimeCoinsPurchased, 355020);
    await updateGiftCatalogItem({ giftId, platinumExclusive: false });
    assert.equal((await getGiftCatalogItem(giftId))!.platinumExclusive, false);
  });
});
