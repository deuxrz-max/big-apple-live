import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Request } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, accountProfiles, chatRooms, chatAdmissions, chatMemberships, chatModerators,
  profilePhotos, socialSettings, socialRelations, socialMessages, roomMessages, universityPreferences } from "@workspace/db";
import router from "../routes";
import { roomStore } from "./room-store";
import { getProfile } from "./account-profiles";
import { acceptMessage, getMessages } from "./room-chat";
import { COMMUNITY_ROOMS } from "./community";
import { UNIVERSITY_TOPICS } from "./university-chat";
import { GetUniversitySessionResponse, GetSocialConversationResponse } from "@workspace/api-zod";

test("Phase 3 real database and authenticated HTTP privacy safeguards (synthetic identities)", async t => {
  const token = randomUUID().replaceAll("-", "").slice(0, 7);
  const ids = ["a", "b", "c"].map(s => `phase3-fixture-${token}-${s}`);
  const names = ids.map((_, i) => `Chat_${token}_${i}`);
  const codes = [`U${token}`, `V${token}`].map(s => s.toUpperCase());
  const histories = [randomUUID(), randomUUID()];
  const photoId = randomUUID();
  const app = express();
  app.use((req, _res, next) => {
    const actor = req.get("X-Fixture-User") ?? null;
    const auth = () => ({ userId: actor, tokenType: "session_token", sessionId: actor ? "fixture" : null });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    (req as Request & { auth: typeof auth }).auth = auth;
    next();
  });
  app.use(express.json());
  app.use(router);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message });
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sessions: { participantSessionId: string; participantId: string }[] = [];
  const request = (index: number, path: string, body?: unknown, method = "GET", session?: string) => fetch(base + path, {
    method, headers: { "X-Fixture-User": ids[index]!, "Content-Type": "application/json",
      "X-Room-Session": session ?? sessions[index]?.participantSessionId ?? "" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const feed = async (index: number, code = codes[0]!) => {
    const res = await request(index, `/account/rooms/${code}/university-session`);
    assert.equal(res.status, 200);
    return GetUniversitySessionResponse.parse(await res.json());
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(roomMessages).where(inArray(roomMessages.historyId, histories));
    await db.delete(socialMessages).where(inArray(socialMessages.senderId, ids));
    await db.delete(chatMemberships).where(inArray(chatMemberships.historyId, histories));
    await db.delete(chatRooms).where(inArray(chatRooms.roomId, codes));
    await db.delete(profilePhotos).where(eq(profilePhotos.id, photoId));
    await db.delete(chatModerators).where(inArray(chatModerators.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(), displayName: `Fixture member ${i}`,
    emojiId: "1F600", gender: "Female" as const, color: "#FFFFFF", hairColor: "#000000",
    ...(i === 0 ? { photoUrl: `/api/photos/${photoId}`, photoUrls: [`/api/photos/${photoId}`] } : {}),
  })));
  await db.insert(profilePhotos).values({ id: photoId, accountId: ids[0]!, objectKey: `fixture-only/${photoId}`, size: 100, status: "pending" });
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  await db.insert(chatModerators).values({ accountId: ids[2]! });
  await db.insert(chatRooms).values([
    { roomId: codes[0]!, historyId: histories[0]!, label: "Fixture university", parentRoomId: "LIVEME", overflowNumber: "50" },
    { roomId: codes[1]!, historyId: histories[1]!, label: "Separate fixture university", topic: "Separate fixture topic" },
  ]);
  for (const row of await db.select().from(chatRooms).where(inArray(chatRooms.roomId, codes))) roomStore.registerCommunity(row);
  for (let i = 0; i < ids.length; i++) {
    const profile = (await getProfile(ids[i]!))!;
    const joined = roomStore.join(codes[0]!, profile.displayName ?? profile.username, { accountId: ids[i]!, identity: profile.identity });
    sessions.push(joined);
    await db.insert(chatMemberships).values({ accountId: ids[i]!, historyId: histories[0]!, participantId: joined.participantId });
  }
  const whisper = (from: number, to: number, body = "Private fixture whisper", key = randomUUID()) =>
    request(from, `/account/rooms/${codes[0]}/whispers`, { username: names[to], body, idempotencyKey: key }, "POST");

  await t.test("only sender and recipient can see inline whispers; normal private conversations also retain them", async () => {
    const key = randomUUID();
    assert.equal((await whisper(0, 1, "Only A and B", key)).status, 201);
    assert.equal((await whisper(0, 1, "Only A and B", key)).status, 201);
    assert.equal((await feed(0)).whispers.length, 1);
    assert.equal((await feed(1)).whispers[0]!.body, "Only A and B");
    assert.equal((await feed(2)).whispers.length, 0);
    const normal = await request(1, `/social/messages/${names[0]}`);
    assert.equal(GetSocialConversationResponse.parse(await normal.json()).messages[0]!.body, "Only A and B");
    assert.equal((await getMessages(codes[0]!, roomStore, ids[2]!)).length, 0);
    const separate = roomStore.join(codes[1]!, names[0]!, { accountId: ids[0]!, identity: (await getProfile(ids[0]!))!.identity });
    const other = await request(0, `/account/rooms/${codes[1]}/university-session`, undefined, "GET", separate.participantSessionId);
    assert.equal(GetUniversitySessionResponse.parse(await other.json()).whispers.length, 0);
    assert.equal((await request(2, `/account/rooms/${codes[0]}/university-session`, undefined, "GET", sessions[0]!.participantSessionId)).status, 401);
  });
  await t.test("a block in either direction stops whispers on the server", async () => {
    for (const [ownerId, targetId] of [[ids[0]!, ids[1]!], [ids[1]!, ids[0]!]]) {
      await db.insert(socialRelations).values({ ownerId, targetId, kind: "block" });
      assert.equal((await whisper(0, 1)).status, 403);
      await db.delete(socialRelations).where(eq(socialRelations.ownerId, ownerId));
    }
  });
  await t.test("ignore affects only that viewer's room flow, not Messages; unignore restores history", async () => {
    await acceptMessage(codes[0]!, sessions[0]!.participantSessionId, ids[0]!, { text: "Public fixture message", kind: "text" });
    assert.equal((await request(1, `/account/chat/ignores/${names[0]}`, { active: true }, "PUT")).status, 200);
    assert.equal((await getMessages(codes[0]!, roomStore, ids[1]!)).length, 0);
    assert.equal((await getMessages(codes[0]!, roomStore, ids[2]!)).length, 1);
    assert.equal((await feed(1)).whispers.length, 0);
    assert.equal((await feed(1)).people.find(p => p.username === names[0])!.ignored, true);
    assert.equal(GetSocialConversationResponse.parse(await (await request(1, `/social/messages/${names[0]}`)).json()).messages.length, 1);
    assert.equal((await request(1, `/account/chat/ignores/${names[1]}`, { active: true }, "PUT")).status, 400);
    await request(1, `/account/chat/ignores/${names[0]}`, { active: false }, "PUT");
    assert.equal((await feed(1)).whispers.length, 1);
    assert.equal((await getMessages(codes[0]!, roomStore, ids[1]!)).length, 1);
  });
  await t.test("people list withholds pending/rejected/flagged photos from others; own pending status and moderator badge are returned", async () => {
    for (const status of ["pending", "rejected", "flagged"] as const) {
      await db.update(profilePhotos).set({ status }).where(eq(profilePhotos.id, photoId));
      assert.equal((await feed(1)).people.find(p => p.username === names[0])!.photoUrl, null);
    }
    await db.update(profilePhotos).set({ status: "pending" }).where(eq(profilePhotos.id, photoId));
    const own = (await feed(0)).people.find(p => p.self)!;
    assert.equal(own.photoUrl, `/api/photos/${photoId}`);
    assert.equal(own.photoStatus, "pending");
    assert.equal((await feed(0)).people.find(p => p.username === names[2])!.moderator, true);
    await db.update(profilePhotos).set({ status: "approved" }).where(eq(profilePhotos.id, photoId));
    assert.equal((await feed(1)).people.find(p => p.username === names[0])!.photoUrl, `/api/photos/${photoId}`);
  });
  await t.test("overflow topic inherits parent; all six initial topics are available", async () => {
    assert.equal((await feed(0)).topic, UNIVERSITY_TOPICS.LIVEME);
    assert.deepEqual(COMMUNITY_ROOMS.map(r => UNIVERSITY_TOPICS[r.roomId]), [
      "Beam tips, camera presence and keeping viewers", "Growing on Bigo, PK battles and fan clubs",
      "Tango streams, gifting etiquette and building regulars", "TikTok LIVE, short clips and going viral",
      "IG Lives, collabs and growing followers", "Super Live hosting, events and audience tips",
    ]);
  });
  await t.test("rules acknowledgement saves per account and remains unseen for another account", async () => {
    assert.equal((await feed(0)).rulesSeen, false);
    assert.equal((await request(0, "/account/chat/rules/seen", {}, "POST")).status, 200);
    assert.equal((await feed(0)).rulesSeen, true);
    assert.equal((await feed(1)).rulesSeen, false);
    const [saved] = await db.select().from(universityPreferences).where(eq(universityPreferences.accountId, ids[0]!));
    assert.ok(saved!.rulesSeenAt);
  });
  await t.test("whisper validation, retry collision and existing private-message rate limit remain enforced", async () => {
    assert.equal((await whisper(0, 1, "x".repeat(1001))).status, 400);
    assert.equal((await whisper(0, 1, "x".repeat(1000))).status, 201);
    const key = randomUUID();
    assert.equal((await whisper(0, 1, "Original", key)).status, 201);
    assert.equal((await whisper(0, 1, "Changed", key)).status, 409);
    for (let i = 0; i < 27; i++) assert.equal((await whisper(0, 1, `Rate fixture ${i}`)).status, 201);
    assert.equal((await whisper(0, 1, "Too many")).status, 429);
  });
});
