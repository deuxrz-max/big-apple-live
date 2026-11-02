import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialWallets, socialLedger, profilePhotos, chatAdmissions, socialGiftBag, socialGiftEvents } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getMe, getPerson, listPeople, relationship, saveSocialProfile, blocks } from "./people";
import { claimDaily, gift, purchase, ledger } from "./rewards";
import { getGiftCatalogItem } from "../gift-studio-catalog";
import { sendMessage, thread, inbox, clearThread } from "./messages";
import { GetSocialMeResponse, GetSocialPeopleResponse, GetSocialConversationResponse, GetSocialInboxResponse } from "@workspace/api-zod";
import { roomStore } from "../room-store";

test("persistent social privacy, messages, credits and atomic rewards", async t => {
  const token = randomUUID().replaceAll("-", "").slice(0, 8);
  const ids = ["a", "b", "c"].map(s => `social-fixture-${token}-${s}`);
  const names = ["a", "b", "c"].map(s => `Social_${token}_${s}`);
  const roomId = `SOC-${token}`.toUpperCase();
  const historyId = `social-history-${token}`;
  t.after(async () => {
    roomStore.deactivateCommunity(roomId);
    await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(profilePhotos).where(inArray(profilePhotos.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((id, i) => ({ accountId: id, username: names[i]!, nameKey: names[i]!.toLowerCase(),
    emojiId: "1F600", gender: i === 1 ? "Female" as const : "Male" as const, color: "#ffffff", hairColor: "#000000",
    isTestAccount: i === 2 })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  const a = ids[0]!, b = ids[1]!, c = ids[2]!;
  roomStore.registerCommunity({ roomId, historyId, label: "Social test room", createdAt: new Date(), testOnly: true });
  const identity = { emojiId: "1F600", gender: "Male" as const, color: "#ffffff", hairColor: "#000000" };
  const aSession = roomStore.join(roomId, names[0]!, { accountId: a, identity });
  const bSession = roomStore.join(roomId, names[1]!, { accountId: b, identity });
  const aContext = { roomId, sessionId: aSession.participantSessionId };
  const bContext = { roomId, sessionId: bSession.participantSessionId };
  const prefs = { bio: "A real community member", country: "US", interests: ["music"], discoverable: true, badgeId: null };

  await t.test("People includes accounts without opting in; filters and profile clears persist", async () => {
    GetSocialMeResponse.parse(await getMe(a));
    await getMe(b); await getMe(c);
    assert.equal((await listPeople(a, { search: token })).total, 2);
    await saveSocialProfile(a, prefs);
    await saveSocialProfile(b, { ...prefs, country: "CA", bio: "Canada fixture", interests: ["art"] });
    const people = GetSocialPeopleResponse.parse(await listPeople(a, { search: token, country: "CA", gender: "Female" }));
    assert.equal(people.total, 1);
    assert.equal(people.people[0]!.username, names[1]);
    await saveSocialProfile(a, { ...prefs, country: null, bio: "", interests: [] });
    assert.equal((await getMe(a)).profile.country, null);
    assert.equal((await getMe(a)).profile.bio, "");
    await assert.rejects(saveSocialProfile(a, { ...prefs, badgeId: "beam-champion" }), /cannot be selected manually/);
    await assert.rejects(saveSocialProfile(a, { ...prefs, country: "XX" }), /country/);
  });
  await t.test("a concurrent daily claim pays exactly once per Eastern 3 AM cycle", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => claimDaily(a)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await getMe(a)).wallet.balance, 25);
    assert.equal((await ledger(a)).transactions.length, 1);
    await claimDaily(b);
  });
  await t.test("private messages are idempotent, isolated and survive reload-style reads", async () => {
    const key = randomUUID();
    await sendMessage(a, names[1]!, "Go fuck yourself", key);
    await sendMessage(a, names[1]!, "Go fuck yourself", key);
    await assert.rejects(sendMessage(a, names[1]!, "different message", key), /retry key/);
    const pendingPhoto = randomUUID();
    const displayName = "ᥬ😱᭄ Fixture Q̶";
    await db.insert(profilePhotos).values({ id: pendingPhoto, accountId: a, objectKey: `${pendingPhoto}.webp`, size: 100, status: "pending" });
    await db.update(accountProfiles).set({ displayName, photoUrl: `/api/photos/${pendingPhoto}`, photoUrls: [`/api/photos/${pendingPhoto}`] }).where(eq(accountProfiles.accountId, a));
    const incoming = GetSocialInboxResponse.parse(await inbox(b)).conversations[0]!;
    assert.equal(incoming.unreadCount, 1);
    assert.equal(incoming.lastMessage, "Go $%<& yourself");
    assert.equal(incoming.displayName, displayName);
    assert.equal(incoming.photoUrl, null, "Pending photos are not disclosed in the inbox");
    assert.equal(incoming.lastMessageFromMe, false);
    assert.ok(incoming.lastUnreadAt);
    await db.update(profilePhotos).set({ status: "approved" }).where(eq(profilePhotos.id, pendingPhoto));
    assert.equal((await inbox(b)).conversations[0]!.photoUrl, `/api/photos/${pendingPhoto}`);
    await db.update(profilePhotos).set({ status: "rejected" }).where(eq(profilePhotos.id, pendingPhoto));
    assert.equal((await inbox(b)).conversations[0]!.photoUrl, null);
    const outgoing = (await inbox(a)).conversations[0]!;
    assert.equal(outgoing.lastMessageFromMe, true);
    assert.equal(outgoing.lastUnreadAt, null);
    const received = GetSocialConversationResponse.parse(await thread(b, names[0]!));
    assert.equal(received.messages.length, 1);
    assert.equal(received.messages[0]!.body, "Go $%<& yourself");
    assert.equal((await inbox(b)).conversations[0]!.unreadCount, 0);
    assert.equal((await inbox(b)).conversations[0]!.lastUnreadAt, null);
    assert.equal((await thread(c, names[1]!)).messages.length, 0);
    await clearThread(a, names[1]!);
    assert.equal((await thread(a, names[1]!)).messages.length, 0);
    assert.equal((await thread(b, names[0]!)).messages.length, 1);
  });
  await t.test("legacy direct/private gift attempts cannot move coins, inventory or XP", async () => {
    const walletsBefore = await db.select().from(socialWallets).where(inArray(socialWallets.accountId, ids));
    const ledgerBefore = await db.select().from(socialLedger).where(inArray(socialLedger.accountId, ids));
    const bagBefore = await db.select().from(socialGiftBag).where(inArray(socialGiftBag.accountId, ids));
    const key = randomUUID();
    for (const giftId of ["good-vibes", "spirit-pup"]) {
      for (const testMode of [false, true]) {
        await assert.rejects(gift(a, names[1]!, giftId, key, undefined, 10, false, testMode),
          error => error instanceof Error && /Direct\/private-message gifts are disabled/.test(error.message));
        await assert.rejects(gift(a, names[1]!, giftId, key, undefined, 1, true, testMode), /Direct\/private-message/);
      }
    }
    await assert.rejects(gift(a, names[1]!, "good-vibes", key, { streamId: " " }), /Direct\/private-message/);
    await assert.rejects(gift(a, names[1]!, "good-vibes", key, { roomId: roomId, sessionId: "invalid" }), /session|room/i);
    assert.deepEqual(await db.select().from(socialWallets).where(inArray(socialWallets.accountId, ids)), walletsBefore);
    assert.deepEqual(await db.select().from(socialLedger).where(inArray(socialLedger.accountId, ids)), ledgerBefore);
    assert.deepEqual(await db.select().from(socialGiftBag).where(inArray(socialGiftBag.accountId, ids)), bagBefore);
    assert.deepEqual(await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId)), []);
    // Message sending still succeeds after a rejected gift request.
    await sendMessage(a, names[1]!, "Text still works", randomUUID());
    assert.equal((await thread(b, names[0]!)).messages.some(message => message.body === "Text still works"), true);
  });
  await t.test("concurrent room gifts cannot overdraw; retired badge purchases do not spend credits", async () => {
    const giftCost = (await getGiftCatalogItem("good-vibes"))!.cost;
    const [senderWallet] = await db.select().from(socialWallets).where(eq(socialWallets.accountId, a));
    const fixtureFunding = giftCost * 5 - senderWallet!.balance;
    await db.update(socialWallets).set({ balance: giftCost * 5 }).where(eq(socialWallets.accountId, a));
    if (fixtureFunding) await db.insert(socialLedger).values({
      accountId: a, delta: fixtureFunding, kind: "reward", description: "Isolated concurrent-gift test funding",
    });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => gift(a, names[1]!, "good-vibes", randomUUID(), aContext)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 5);
    assert.equal((await getMe(a)).wallet.balance, 0);
    assert.equal((await getMe(b)).wallet.balance, 25 + giftCost * 5);
    await assert.rejects(purchase(b, "good-neighbor", randomUUID()), /confirmed coin purchases/);
    const me = await getMe(b);
    assert.equal(me.wallet.balance, 25 + giftCost * 5);
    assert.deepEqual(me.inventory, []);
    assert.equal(me.profile.badgeId, null);
    assert.deepEqual(me.profile.badges, []);
    await assert.rejects(purchase(b, "night-owl", randomUUID()), /confirmed coin purchases/);
    const storePurchaseKey = randomUUID();
    await purchase(b, "good-vibes", storePurchaseKey);
    await purchase(b, "good-vibes", storePurchaseKey);
    assert.equal((await getMe(b)).wallet.balance, 25 + giftCost * 4, "a repeated Store request does not debit twice");
    assert.deepEqual((await getMe(b)).inventory, ["good-vibes"], "a Store purchase adds a collectible, not a sent gift");
    assert.equal((await getMe(b)).giftQuantities?.["good-vibes"], 1);
    const giftKey = randomUUID();
    await gift(b, names[0]!, "good-vibes", giftKey, bContext);
    await gift(b, names[0]!, "good-vibes", giftKey, bContext);
    assert.equal((await getMe(a)).wallet.balance, giftCost);
    assert.equal((await getMe(b)).wallet.balance, 25 + giftCost * 4, "sending the gift already in the bag does not charge its price twice");
    await assert.rejects(gift(b, names[0]!, "big-love", giftKey, bContext), /retry key/);
    const [row] = await db.select().from(socialWallets).where(eq(socialWallets.accountId, b));
    assert.equal(row!.received, giftCost * 5);
    assert.equal(row!.sent, giftCost);
    const publicStats = await getPerson(a, names[1]!);
    assert.equal(publicStats.receivedCredits, giftCost * 5);
    assert.equal(publicStats.sentCredits, giftCost);
    await db.update(socialWallets).set({ received: 1000000 }).where(eq(socialWallets.accountId, c));
    const leader = await listPeople(b, { search: token }, true);
    assert.equal(leader.people[0]!.username, names[1]);
    assert.equal(leader.people.some(person => person.username === names[2]), false, "test accounts are excluded from public leaderboards");
    const bTransactions = (await ledger(b)).transactions;
    assert.equal(bTransactions.filter(r => r.kind === "purchase").length, 1);
    assert.ok(bTransactions.some(r => r.kind === "purchase" && r.delta === -giftCost), "a Store purchase is recorded as coins out");
    assert.ok(bTransactions.some(r => r.kind === "gift_sent" && r.delta === 0), "a stored gift send is recorded without a second coin debit");
    assert.ok(bTransactions.some(r => r.kind === "gift_received" && r.delta > 0), "a received gift is recorded as coins in");
    assert.equal((await ledger(a)).transactions.some(r => r.kind === "purchase"), false, "one account's ledger never contains another account's purchase");
  });
  await t.test("blocking is bilateral and stops discovery, favorites, gifts and new messages without deleting other history", async () => {
    await relationship(a, names[1]!, "favorite", true);
    assert.equal((await getMe(a)).profile.followingCount, 1);
    assert.equal((await getPerson(a, names[1]!)).followerCount, 1);
    assert.equal((await listPeople(a, { search: token, favorites: true })).total, 1);
    await relationship(b, names[0]!, "block", true);
    assert.equal((await blocks(b)).people[0]!.username, names[0]);
    assert.equal((await listPeople(a, { search: token })).total, 1);
    await assert.rejects(getPerson(a, names[1]!), /blocked/);
    await assert.rejects(gift(a, names[1]!, "good-vibes", randomUUID(), aContext), /blocked/);
    await assert.rejects(sendMessage(a, names[1]!, "not allowed", randomUUID()), /blocked/);
    await assert.rejects(relationship(a, names[1]!, "favorite", true), /blocked/);
    assert.equal((await thread(b, names[0]!)).blocked, true);
    assert.equal((await thread(b, names[0]!)).messages.length, 2);
    await relationship(b, names[0]!, "block", false);
    assert.equal((await listPeople(a, { search: token })).total, 2);
  });
  await t.test("credit ledger reconciles to balances and only fixture data was touched", async () => {
    const entries = await db.select().from(socialLedger).where(inArray(socialLedger.accountId, ids));
    const wallets = await db.select().from(socialWallets).where(inArray(socialWallets.accountId, ids));
    assert.equal(entries.reduce((sum, e) => sum + e.delta, 0), wallets.reduce((sum, w) => sum + w.balance, 0));
    assert.ok(wallets.every(w => w.balance >= 0));
  });
});
