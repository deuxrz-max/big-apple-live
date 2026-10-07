import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, accountProfiles, chatRooms, chatMemberships, roomMessages, socialRelations } from "@workspace/db";
import { RoomStore } from "./room-store";
import { acceptMessage, getMessages } from "./room-chat";
import { CommunityAtmosphereTracker, atmosphereConfig } from "./community-atmosphere";
import { getProfile } from "./account-profiles";

test("real PostgreSQL text-room persistence, isolation, mood sync, blocking, pagination and rate limiting", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
  const ids = ["a", "b", "c"].map(x => `pivot-test-${suffix}-${x}`);
  const codes = [`Z${suffix.slice(0, 5)}`, `Y${suffix.slice(0, 5)}`].map(x => x.toUpperCase());
  const histories = [randomUUID(), randomUUID()];
  t.after(async () => {
    await db.delete(roomMessages).where(inArray(roomMessages.historyId, histories));
    await db.delete(chatMemberships).where(inArray(chatMemberships.historyId, histories));
    await db.delete(chatRooms).where(inArray(chatRooms.roomId, codes));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: `Pivot_${suffix}_${i}`, nameKey: `pivot_${suffix}_${i}`,
    emojiId: "1F600", gender: i === 1 ? "Female" as const : "Male" as const,
    color: "#ffffff", hairColor: "#000000",
    portraitId: i === 1 ? "ponytail-smile" : "spiked-smile",
  })));
  await db.insert(chatRooms).values(codes.map((roomId, i) => ({ roomId, historyId: histories[i]!, label: "Isolated test room" })));
  const store = new RoomStore();
  const savedRooms = await db.select().from(chatRooms).where(inArray(chatRooms.roomId, codes));
  savedRooms.forEach(row => store.registerCommunity(row));
  const profiles = await Promise.all(ids.map(getProfile));
  const sessions = ids.map((accountId, i) => store.join(codes[0]!, profiles[i]!.username, { accountId, identity: profiles[i]!.identity }));
  await db.insert(chatMemberships).values(ids.map((accountId, i) => ({
    accountId, historyId: histories[0]!, participantId: sessions[i]!.participantId,
  })));
  const a = sessions[0]!;
  const accepted = await acceptMessage(codes[0]!, a.participantSessionId, ids[0]!, { text: "hello 😊 then 😂 and music 🎵", kind: "text" }, store);
  assert.equal(accepted.profile.identity.portraitId, "spiked-tears-of-joy");
  const ignored = await acceptMessage(codes[0]!, a.participantSessionId, ids[0]!, { text: "non-face ❤️ 🎤", kind: "text" }, store);
  assert.equal(ignored.profile.identity.portraitId, "spiked-tears-of-joy");
  assert.equal((await getProfile(ids[1]!))!.identity.portraitId, "ponytail-smile");
  assert.equal((await getMessages(codes[1]!, store)).length, 0);
  assert.equal((await getMessages(codes[0]!, store)).length, 2);
  for (let i = 0; i < 3; i++) await acceptMessage(codes[0]!, a.participantSessionId, ids[0]!, { text: `rate test ${i}`, kind: "text" }, store);
  await assert.rejects(acceptMessage(codes[0]!, a.participantSessionId, ids[0]!, { text: "too fast", kind: "text" }, store), /Slow down/);
  await db.insert(socialRelations).values({ ownerId: ids[1]!, targetId: ids[0]!, kind: "block" });
  assert.equal((await getMessages(codes[0]!, store, ids[1]!)).length, 0);
  assert.equal((await getMessages(codes[0]!, store, ids[2]!)).length, 5);
  await db.update(chatMemberships).set({ muted: true }).where(eq(chatMemberships.accountId, ids[2]!));
  await assert.rejects(acceptMessage(codes[0]!, sessions[2]!.participantSessionId, ids[2]!, { text: "muted", kind: "text" }, store), /cannot send/);
  const fresh = new RoomStore();
  savedRooms.forEach(row => fresh.registerCommunity(row));
  assert.equal(fresh.getHistoryId(codes[0]!), histories[0]);
  assert.equal((await getMessages(codes[0]!, fresh)).length, 5);
  assert.notEqual(fresh.getHistoryId(codes[0]!), fresh.getHistoryId(codes[1]!));
  // Insert test-owned history with old timestamps, not fictitious production chat.
  await db.insert(roomMessages).values(Array.from({ length: 65 }, (_, i) => ({
    roomId: codes[0]!, historyId: histories[0]!, authorId: a.participantId,
    authorAccountId: ids[0]!, username: profiles[0]!.username, identity: profiles[0]!.identity,
    text: `pagination fixture ${i}`, kind: "text" as const, createdAt: new Date(Date.now() - (1000 + i) * 1000),
  })));
  const latest = await getMessages(codes[0]!, fresh);
  assert.equal(latest.length, 60);
  const older = await getMessages(codes[0]!, fresh, undefined, latest[0]!.id);
  assert.equal(older.length, 10);
  assert.equal(new Set([...latest, ...older].map(m => m.id)).size, 70);
  await assert.rejects(getMessages(codes[1]!, fresh, undefined, latest[0]!.id), /not found in this room/);
  // Text presence has no inherited 12-seat ceiling.
  for (let i = 0; i < 20; i++) fresh.join(codes[1]!, `Synthetic${i}`, { accountId: `capacity-fixture-${i}`, identity: profiles[0]!.identity });
  assert.equal(fresh.get(codes[1]!).participants.length, 20);
});

test("activity is not hostility; scenes sustain and dwell instead of switching per loop", () => {
  let now = 0;
  const roomA = new CommunityAtmosphereTracker(() => now);
  const roomB = new CommunityAtmosphereTracker(() => now);
  assert.equal(roomA.evaluate({ count: 15, authors: 1 }).scene, "calm");
  roomA.evaluate({ count: 15, authors: 3 });
  now = 19_000; assert.equal(roomA.evaluate({ count: 15, authors: 3 }).scene, "calm");
  now = 60_000; assert.equal(roomA.evaluate({ count: 15, authors: 3 }).scene, "city");
  assert.equal(roomA.current().sentimentEnabled, false);
  assert.equal(roomB.current().scene, "calm");
  now += 6000; assert.equal(roomA.evaluate({ count: 15, authors: 3 }).scene, "city");
  roomA.evaluate({ count: 0, authors: 0 });
  now = 110_000; assert.equal(roomA.evaluate({ count: 0, authors: 0 }).scene, "city");
  now = 120_000; assert.equal(roomA.evaluate({ count: 0, authors: 0 }).scene, "calm");
  assert.equal(roomA.current().windowMs, atmosphereConfig.windowMs);
});

test("disabled sentiment cannot invent a volcano; uncertain assessment does not classify hostility", () => {
  let now = 0;
  const room = new CommunityAtmosphereTracker(() => now);
  for (let i = 0; i < 10; i++) { now += 30_000; assert.notEqual(room.evaluate({ count: 100, authors: 10 }).scene, "volcano"); }
  const uncertain = { samples: 20, authors: 10, hostileShare: .9, hostileConfidence: .4, friendlyConfidence: .2 };
  now += 60_000; assert.notEqual(room.evaluate({ count: 100, authors: 10 }, uncertain).scene, "volcano");
});
