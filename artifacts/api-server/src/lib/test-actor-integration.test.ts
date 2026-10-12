import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  accountProfiles, chatAdmissions, chatMemberships, chatRooms, db, moderatorBotFlags,
  roomMessages, socialGiftBag, socialGiftEvents, socialLedger, socialMessages,
  socialRelations, socialSettings, socialWallets,
} from "@workspace/db";
import { getMessages } from "./room-chat";
import { roomStore } from "./room-store";
import { executeTestActorCommand } from "./test-actor-control";

const testIdentity = {
  emojiId: "1F600", gender: "Female" as const, color: "#FFFFFF", hairColor: "#000000",
};

test("test actor commands exercise isolated university, chat, DM, and gift services", async t => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const ids = Array.from({ length: 28 }, (_, i) => `test-actor-fixture-${token}-${i}`);
  const names = Array.from({ length: 28 }, (_, i) => `ta${token}_${i}`);
  const roomId = `T${token.toUpperCase()}`;
  const historyId = randomUUID();
  const eligibleIds = ids.slice(0, 25);
  const unmarkedId = ids[27]!;
  const unmarkedName = names[27]!;
  const actorId = ids[0]!;
  const recipientId = ids[1]!;
  const actorName = names[0]!;
  const recipientName = names[1]!;

  t.after(async () => {
    try {
      try {
        if (roomStore.isCommunity(roomId)) {
          for (const accountId of ids) {
            if (!roomStore.accountSession(roomId, accountId)) continue;
            const profile = await db.select({ username: accountProfiles.username })
              .from(accountProfiles).where(eq(accountProfiles.accountId, accountId)).limit(1);
            if (profile[0]) {
              await executeTestActorCommand({ action: "leave", as: profile[0].username, room: roomId });
            }
          }
          roomStore.unregisterCommunity(roomId);
        }
      } finally {
        await db.delete(moderatorBotFlags).where(inArray(moderatorBotFlags.accountId, ids));
        await db.delete(roomMessages).where(eq(roomMessages.historyId, historyId));
        await db.delete(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
        await db.delete(socialMessages).where(or(
          inArray(socialMessages.senderId, ids), inArray(socialMessages.recipientId, ids),
        ));
        await db.delete(socialRelations).where(or(
          inArray(socialRelations.ownerId, ids), inArray(socialRelations.targetId, ids),
        ));
        await db.delete(chatMemberships).where(or(
          eq(chatMemberships.historyId, historyId), inArray(chatMemberships.accountId, ids),
        ));
        await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
        await db.delete(chatRooms).where(eq(chatRooms.roomId, roomId));
        await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
        assert.equal((await db.select({ accountId: accountProfiles.accountId }).from(accountProfiles)
          .where(inArray(accountProfiles.accountId, ids))).length, 0, "temporary fixture profiles must be deleted");
        assert.equal((await db.select({ roomId: chatRooms.roomId }).from(chatRooms)
          .where(eq(chatRooms.roomId, roomId))).length, 0, "temporary fixture room must be deleted");
        assert.equal(roomStore.isCommunity(roomId), false, "temporary in-memory room must be unregistered");
      }
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      await db.$client.end();
    }
  });

  assert.equal(roomStore.isCommunity(roomId), false, "the temporary room code must not already be active");
  assert.equal((await db.select({ accountId: accountProfiles.accountId }).from(accountProfiles)
    .where(or(inArray(accountProfiles.accountId, ids), inArray(accountProfiles.nameKey, names.map(n => n.toLowerCase()))))).length, 0,
  "fixture accounts must not exist before this test");
  assert.equal((await db.select({ roomId: chatRooms.roomId }).from(chatRooms).where(eq(chatRooms.roomId, roomId))).length, 0,
    "the temporary room code must not exist in the database");

  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(),
    displayName: `Fixture ${i}`, ...testIdentity, isTestAccount: i !== 27,
  })));
  await db.insert(socialSettings).values(ids.map(accountId => ({
    accountId, discoverable: true,
  })));
  await db.insert(socialWallets).values(ids.map(accountId => ({
    accountId, balance: 1000, earned: 1000, received: 0, sent: 0,
  })));
  await db.insert(chatAdmissions).values([
    ...eligibleIds.map(accountId => ({ accountId })),
    { accountId: ids[26]!, suspended: true },
  ]);
  await db.insert(chatRooms).values({
    roomId, historyId, label: `Fixture University ${token}`, createdAt: new Date(),
  });
  roomStore.registerCommunity({
    roomId, historyId, label: `Fixture University ${token}`, createdAt: new Date(),
  });

  await t.test("join enforces adult eligibility and the 24-person room cap; leave clears presence", async () => {
    await assert.rejects(executeTestActorCommand({
      action: "join", as: names[25]!, room: roomId,
    }), { status: 403 });
    await assert.rejects(executeTestActorCommand({
      action: "join", as: names[26]!, room: roomId,
    }), { status: 403 });

    for (let i = 0; i < 24; i++) {
      const result = await executeTestActorCommand({ action: "join", as: names[i]!, room: roomId });
      assert.equal((result as { joined: boolean }).joined, true);
    }
    assert.equal(roomStore.get(roomId).participants.length, 24);
    await assert.rejects(executeTestActorCommand({
      action: "join", as: names[24]!, room: roomId,
    }), { status: 409 });

    await executeTestActorCommand({ action: "leave", as: names[23]!, room: roomId });
    assert.equal(roomStore.accountSession(roomId, ids[23]!), null);
    assert.equal(roomStore.get(roomId).participants.length, 23);
    await executeTestActorCommand({ action: "join", as: names[24]!, room: roomId });
    assert.equal(roomStore.get(roomId).participants.length, 24);
    await executeTestActorCommand({ action: "leave", as: names[24]!, room: roomId });
    assert.equal(roomStore.accountSession(roomId, ids[24]!), null);
    assert.equal(roomStore.get(roomId).participants.length, 23);
  });

  await t.test("room chat moderates, rate-limits, and persists only fixture messages", async () => {
    const clean = await executeTestActorCommand({
      action: "chat", as: actorName, room: roomId, text: "A clean fixture message",
    }) as { messageId: string };
    const cleanRow = await db.select().from(roomMessages).where(eq(roomMessages.id, clean.messageId));
    assert.equal(cleanRow[0]?.text, "A clean fixture message");
    assert.equal(cleanRow[0]?.hidden, "false");
    assert.ok((await getMessages(roomId, roomStore, recipientId)).some(message => message.id === clean.messageId));

    await executeTestActorCommand({ action: "chat", as: actorName, room: roomId, text: "go die" });
    const hidden = await db.select().from(roomMessages).where(and(
      eq(roomMessages.historyId, historyId), eq(roomMessages.authorAccountId, actorId), eq(roomMessages.text, "go die"),
    ));
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0]?.hidden, "true");
    assert.equal((await db.select().from(moderatorBotFlags).where(eq(moderatorBotFlags.accountId, actorId))).length, 1);

    for (let i = 0; i < 3; i++) {
      await executeTestActorCommand({
        action: "chat", as: actorName, room: roomId, text: `Rate fixture message ${i}`,
      });
    }
    await assert.rejects(executeTestActorCommand({
      action: "chat", as: actorName, room: roomId, text: "The rate-limited message is retained for review",
    }), { status: 429 });
    const retained = await db.select().from(roomMessages).where(and(
      eq(roomMessages.historyId, historyId), eq(roomMessages.authorAccountId, actorId),
      eq(roomMessages.text, "The rate-limited message is retained for review"),
    ));
    assert.equal(retained.length, 1);
    assert.equal(retained[0]?.hidden, "true");
  });

  await t.test("DM privacy, blocks, recipient restrictions, rate limits, and persistence remain enforced", async () => {
    await db.update(socialSettings).set({ discoverable: false }).where(eq(socialSettings.accountId, recipientId));
    await assert.rejects(executeTestActorCommand({
      action: "dm", as: actorName, to: recipientName, text: "Private fixture message",
    }), /not available in discovery/);

    await db.insert(socialRelations).values({ ownerId: recipientId, targetId: actorId, kind: "block" });
    await db.update(socialSettings).set({ discoverable: true }).where(eq(socialSettings.accountId, recipientId));
    await assert.rejects(executeTestActorCommand({
      action: "dm", as: actorName, to: recipientName, text: "Blocked fixture message",
    }), /blocked/);
    await db.delete(socialRelations).where(and(
      eq(socialRelations.ownerId, recipientId), eq(socialRelations.targetId, actorId),
    ));

    await assert.rejects(executeTestActorCommand({
      action: "dm", as: actorName, to: unmarkedName, text: "Unmarked recipient is forbidden",
    }), { status: 403 });
    const first = await executeTestActorCommand({
      action: "dm", as: actorName, to: recipientName, text: "Persisted private fixture message",
    }) as { messageId: string };
    const saved = await db.select().from(socialMessages).where(eq(socialMessages.id, first.messageId));
    assert.equal(saved[0]?.body, "Persisted private fixture message");
    assert.equal(saved[0]?.senderId, actorId);
    assert.equal(saved[0]?.recipientId, recipientId);

    for (let i = 1; i < 30; i++) {
      await executeTestActorCommand({
        action: "dm", as: actorName, to: recipientName, text: `Fixture DM ${i}`,
      });
    }
    await assert.rejects(executeTestActorCommand({
      action: "dm", as: actorName, to: recipientName, text: "DM rate limit must reject this",
    }), { status: 429 });
    const persisted = await db.select().from(socialMessages).where(eq(socialMessages.senderId, actorId));
    assert.equal(persisted.length, 30);
    assert.ok(persisted.every(message => message.recipientId === recipientId));
  });

  await t.test("a test gift debits the marked wallet once and applies the existing credit split", async () => {
    const result = await executeTestActorCommand({
      action: "gift", as: actorName, to: recipientName, room: roomId, gift: "spirit-pup",
    }) as { testCreditsRemaining: number };
    assert.equal(result.testCreditsRemaining, 900);

    const wallets = await db.select().from(socialWallets).where(inArray(socialWallets.accountId, [actorId, recipientId, unmarkedId]));
    const senderWallet = wallets.find(wallet => wallet.accountId === actorId)!;
    const recipientWallet = wallets.find(wallet => wallet.accountId === recipientId)!;
    const unmarkedWallet = wallets.find(wallet => wallet.accountId === unmarkedId)!;
    assert.equal(senderWallet.balance, 900);
    assert.equal(senderWallet.sent, 100);
    assert.equal(recipientWallet.balance, 1050);
    assert.equal(recipientWallet.received, 50);
    assert.equal(unmarkedWallet.balance, 1000);
    assert.equal(unmarkedWallet.received, 0);

    const [bag] = await db.select().from(socialGiftBag).where(and(
      eq(socialGiftBag.accountId, recipientId), eq(socialGiftBag.giftId, "spirit-pup"),
    ));
    assert.equal(bag?.quantity, 1);
    const receipts = await db.select().from(socialGiftEvents).where(eq(socialGiftEvents.historyId, historyId));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.senderId, actorId);
    assert.equal(receipts[0]?.recipientId, recipientId);
    assert.equal(receipts[0]?.cost, 100);
    assert.equal(receipts[0]?.recipientCredits, 50);
    assert.equal(receipts[0]?.houseCredits, 50);
    const ledgerRows = await db.select().from(socialLedger).where(inArray(socialLedger.accountId, [actorId, recipientId]));
    assert.equal(ledgerRows.filter(row => row.kind === "gift_sent").length, 1);
    assert.equal(ledgerRows.filter(row => row.kind === "gift_received").length, 1);

    await assert.rejects(executeTestActorCommand({
      action: "gift", as: actorName, to: unmarkedName, room: roomId, gift: "spirit-pup",
    }), { status: 403 });
    const unchanged = await db.select().from(socialWallets).where(eq(socialWallets.accountId, unmarkedId));
    assert.equal(unchanged[0]?.balance, 1000);
  });
});
