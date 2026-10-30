import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request, type ErrorRequestHandler } from "express";
import sharp from "sharp";
import { eq, inArray, and } from "drizzle-orm";
import { db, accountProfiles, chatRooms, chatAdmissions, chatModerators, profilePhotos, chatMemberships, roomMessages, chatReports, socialRelations } from "@workspace/db";
import router from "../routes";
import { initializeCommunities } from "./community";
import { RoomStore, SESSION_TIMEOUT_MS, roomStore } from "./room-store";
import { deleteFixturePhoto } from "./profile-photo-storage";
import { person } from "./social/core";
import { CreateAccountRoomResponse, GetMyProfileResponse, GetPhotoReviewQueueResponse, JoinAccountRoomResponse, GetChatDirectoryResponse, GetRoomMessagesResponse } from "@workspace/api-zod";

test("public community rooms allow more than 24 audience members and reconnects", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  store.registerCommunity({ roomId: "LIVEME", label: "LiveMe", historyId: randomUUID(), createdAt: new Date() });
  const identity = { emojiId: "1F600", gender: "Female" as const, color: "#FFFFFF", hairColor: "#000000" };
  const sessions = Array.from({ length: 32 }, (_, i) =>
    store.join("LIVEME", `Member ${i}`, { accountId: `member-${i}`, identity }));
  assert.equal(store.get("LIVEME").capacity, 0, "zero represents unlimited community capacity");
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), true);
  assert.equal(store.join("LIVEME", "Next", { accountId: "next", identity }).room.participants.length, 33);
  assert.equal(store.join("LIVEME", "Member 0", { accountId: "member-0", identity }).participantSessionId, sessions[0]!.participantSessionId);
  store.join("LIVEME", "Moderator", { accountId: "moderator", identity, capExempt: true });
  assert.equal(store.get("LIVEME").participants.length, 34);
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), true);
  now = SESSION_TIMEOUT_MS;
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), true);
});

test("real HTTP/DB/storage photo moderation and unlimited public rooms; synthetic Clerk identities only", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const ids = Array.from({ length: 32 }, (_, i) => `safety-fixture-${suffix}-${i}`);
  const photos: string[] = [];
  const createdRoomIds: string[] = [];
  const app = express();
  app.use((req, _res, next) => {
    const actor = req.get("X-Fixture-User") ?? null;
    const auth = () => ({ userId: actor, tokenType: "session_token", sessionId: actor ? "fixture-session" : null });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    (req as Request & { auth: typeof auth }).auth = auth;
    next();
  });
  app.use(express.json());
  app.use(router);
  const errors: ErrorRequestHandler = (e, _req, res, _next) => res.status(e.status ?? 500).json({ error: e.message });
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (id: string, path: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init, headers: { "X-Fixture-User": id, ...init.headers },
  });
  const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(chatReports).where(inArray(chatReports.reporterId, ids));
    await db.delete(roomMessages).where(inArray(roomMessages.authorAccountId, ids));
    await db.delete(chatMemberships).where(inArray(chatMemberships.accountId, ids));
    for (const roomId of createdRoomIds) {
      roomStore.discardSocialRoom(roomId);
      await db.delete(chatRooms).where(eq(chatRooms.roomId, roomId));
    }
    await db.delete(chatModerators).where(inArray(chatModerators.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    for (const id of photos) await deleteFixturePhoto(id);
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: `Safety_${suffix}_${i}`, nameKey: `safety_${suffix}_${i}`,
    displayName: `Safety member ${i}`, emojiId: "1F600", gender: "Female" as const,
    color: "#FFFFFF", hairColor: "#000000",
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  const owner = ids[0]!, viewer = ids[1]!, mod = ids.at(-1)!;
  // This trusted test fixture exists only for the test, and is removed afterwards.
  await db.insert(chatModerators).values({ accountId: mod });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ddd" } }).png().toBuffer();
  async function upload() {
    const response = await request(owner, "/me/photo", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: png });
    assert.equal(response.status, 201);
    const result = await response.json() as { photoUrl: string };
    photos.push(result.photoUrl.split("/").at(-1)!);
    return result.photoUrl;
  }
  await t.test("pending private, owner sees pending, moderator queue excludes non-moderators; approve exposes photo", async () => {
    const url = await upload();
    const saved = await request(owner, "/me", { method: "PUT", ...json({ username: `Safety_${suffix}_0`, photoUrl: url, photoUrls: [url] }) });
    assert.equal(saved.status, 200);
    const own = GetMyProfileResponse.parse(await (await request(owner, "/me")).json()).profile!;
    assert.equal(own.photoUrl, url);
    assert.equal(own.photoReviews![0]!.status, "pending");
    const [row] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, owner));
    const hidden = await person(viewer, row!);
    assert.equal(hidden.photoUrl, null, "UI uses initials for null photo");
    assert.deepEqual(hidden.photoUrls, []);
    assert.equal((await request(owner, url.replace("/api", ""))).status, 200);
    assert.equal((await request(viewer, url.replace("/api", ""))).status, 404);
    assert.equal((await request(viewer, "/account/chat/photo-reviews")).status, 403);
    const pending = GetPhotoReviewQueueResponse.parse(await (await request(mod, "/account/chat/photo-reviews")).json());
    assert.ok(pending.some((p: { id: string }) => p.id === photos[0]));
    assert.equal((await request(mod, url.replace("/api", ""))).status, 200);
    assert.equal((await request(viewer, `/account/chat/photo-reviews/${photos[0]}`, { method: "PATCH", ...json({ action: "approve" }) })).status, 403);
    assert.equal((await request(mod, `/account/chat/photo-reviews/${photos[0]}`, { method: "PATCH", ...json({ action: "approve" }) })).status, 200);
    assert.equal((await person(viewer, row!)).photoUrl, url);
    const fetched = await request(viewer, url.replace("/api", ""));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("cache-control"), "private, no-store");
    await db.insert(socialRelations).values({ ownerId: viewer, targetId: owner, kind: "block" });
    assert.equal((await request(viewer, url.replace("/api", ""))).status, 404, "Approval cannot bypass blocking");
    assert.equal((await person(viewer, row!)).photoUrl, null);
    await db.delete(socialRelations).where(and(eq(socialRelations.ownerId, viewer), eq(socialRelations.targetId, owner)));
  });
  await t.test("rejection keeps account and approved other photo, flagged photos fail closed", async () => {
    const url = await upload();
    const approved = `/api/photos/${photos[0]}`;
    assert.equal((await request(owner, "/me", { method: "PUT", ...json({
      username: `Safety_${suffix}_0`, photoUrl: url, photoUrls: [approved, url],
    }) })).status, 200);
    assert.equal((await request(mod, `/account/chat/photo-reviews/${photos[1]}`, { method: "PATCH", ...json({ action: "reject" }) })).status, 200);
    const own = GetMyProfileResponse.parse(await (await request(owner, "/me")).json()).profile!;
    assert.equal(own.photoReviews!.find(p => p.photoUrl === url)!.status, "rejected");
    const [row] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, owner));
    assert.equal((await person(viewer, row!)).photoUrl, null);
    assert.deepEqual((await person(viewer, row!)).photoUrls, [approved]);
    assert.equal((await request(viewer, url.replace("/api", ""))).status, 404);
    assert.equal((await request(owner, url.replace("/api", ""))).status, 200);
    await db.update(profilePhotos).set({ status: "flagged" }).where(eq(profilePhotos.id, photos[1]!));
    assert.equal((await request(viewer, url.replace("/api", ""))).status, 404);
    assert.equal((await db.select().from(profilePhotos).where(inArray(profilePhotos.id, photos))).length, 2);
  });
  await initializeCommunities();
  await t.test("the directory includes Comedy and still hides removed rooms without deleting them", async () => {
    const directory = GetChatDirectoryResponse.parse(
      await (await request(owner, "/account/chat/rooms")).json(),
    );
    assert.deepEqual(directory.map(room => room.label), [
      "Music", "Movies", "Comedy", "Sports", "Pro Wrestling", "Web Series", "History", "News",
    ]);
    assert.equal(directory.length, 8);
    assert.equal(directory.some(room => room.roomId === "LIVEME" || room.roomId === "WORLDNEWS"), false);
    const oldRoomJoin = await request(owner, "/account/rooms/LIVEME/join", { method: "POST" });
    assert.equal(oldRoomJoin.status, 410, await oldRoomJoin.text());
    const hiddenRoomJoin = await request(owner, "/account/rooms/GAMING/join", { method: "POST" });
    assert.equal(hiddenRoomJoin.status, 410, await hiddenRoomJoin.text());
    assert.equal(directory.some(room => room.roomId === "GAMING"), false);
    assert.equal((await db.select().from(chatRooms).where(eq(chatRooms.roomId, "GAMING"))).length, 1,
      "hidden room rows remain stored");

    const created = await request(owner, "/account/rooms", {
      method: "POST", ...json({ name: ` Safety${suffix} `, capacity: 9 }),
    });
    const createdPayload = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdPayload));
    const ownerSession = CreateAccountRoomResponse.parse(createdPayload);
    const roomId = ownerSession.room.roomId;
    createdRoomIds.push(roomId);
    assert.equal(ownerSession.room.roomType, "social");
    assert.equal(ownerSession.room.name, `Safety${suffix}`, "surrounding whitespace is trimmed");
    assert.equal(ownerSession.room.hostParticipantId, ownerSession.participantId);
    assert.equal(roomStore.isCommunity(roomId), true);
    assert.equal(roomStore.publicCommunityRoomIds().includes(roomId), false);
    for (const invalidName of ["Two Words", "Two\tWords", "Two\nWords"]) {
      const rejected = await request(owner, "/account/rooms", {
        method: "POST", ...json({ name: invalidName, capacity: 9 }),
      });
      assert.equal(rejected.status, 400, `multiword title rejected: ${JSON.stringify(invalidName)}`);
      const rejectedPayload = await rejected.json() as { error?: string };
      assert.match(rejectedPayload.error ?? "", /single word/i);
    }
    const missingName = await request(owner, "/account/rooms", { method: "POST" });
    assert.equal(missingName.status, 400, "a room title is required");
    const missingNamePayload = await missingName.json() as { error?: string };
    assert.match(missingNamePayload.error ?? "", /one-word room name/i);
    const guestResponse = await request(viewer, `/account/rooms/${roomId}/join`, { method: "POST" });
    const guestPayload = await guestResponse.json();
    assert.equal(guestResponse.status, 201, JSON.stringify(guestPayload));
    const guestSession = JoinAccountRoomResponse.parse(guestPayload);
    assert.equal(guestSession.room.roomType, "social");
    const roomMessage = `Social room message ${suffix}`;
    const sentMessage = await request(owner, `/account/rooms/${roomId}/messages`, {
      method: "POST",
      ...json({ text: roomMessage, kind: "text" }),
      headers: { "Content-Type": "application/json", "X-Room-Session": ownerSession.participantSessionId },
    });
    assert.equal(sentMessage.status, 201, JSON.stringify(await sentMessage.clone().json()));
    const guestHistory = GetRoomMessagesResponse.parse(await (await request(viewer, `/account/rooms/${roomId}/messages`, {
      headers: { "X-Room-Session": guestSession.participantSessionId },
    })).json());
    assert.ok(guestHistory.some((message: { text: string }) => message.text === roomMessage));
  });
  const sessions: { participantSessionId: string }[] = [];
  await t.test("audience beyond 24 stays in the same room with chat and moderation intact", async () => {
    for (let i = 0; i < 30; i++) {
      const response = await request(ids[i]!, "/account/rooms/MUSIC1/join", { method: "POST" });
      assert.equal(response.status, 201);
      sessions.push(JoinAccountRoomResponse.parse(await response.json()));
    }
    const directoryAtThirty = GetChatDirectoryResponse.parse(await (await request(owner, "/account/chat/rooms")).json());
    assert.equal(directoryAtThirty.find((r: { roomId: string }) => r.roomId === "MUSIC1")?.headcount, 30);
    const publicDirectoryResponse = await fetch(`${base}/account/chat/rooms`);
    assert.equal(publicDirectoryResponse.status, 200);
    const publicDirectory = await publicDirectoryResponse.json() as Record<string, unknown>[];
    assert.ok(publicDirectory.every(r => Object.keys(r).sort().join(",") === "headcount,headcountSince,label,nowPlayingTitle,nowPlayingVideoId,roomId"),
      "Public headcounts must not disclose participants or chat");
    const beyondOldCap = await request(ids[30]!, "/account/rooms/MUSIC1/join", { method: "POST" });
    assert.equal(beyondOldCap.status, 201, "the 31st audience member joins the same room");
    const extraSession = JoinAccountRoomResponse.parse(await beyondOldCap.json());
    assert.equal(extraSession.room.participants.length, 31);
    const send = (actor: string, roomId: string, sessionId: string, text: string) => request(actor, `/account/rooms/${roomId}/messages`, {
      method: "POST", ...json({ text, kind: "text" }),
      headers: { "Content-Type": "application/json", "X-Room-Session": sessionId },
    });
    assert.equal((await send(owner, "MUSIC1", sessions[0]!.participantSessionId, `Base ${suffix}`)).status, 201);
    assert.equal((await send(ids[30]!, "MUSIC1", extraSession.participantSessionId, `Beyond the old cap ${suffix}`)).status, 201);
    const history = GetRoomMessagesResponse.parse(await (await request(ids[30]!, "/account/rooms/MUSIC1/messages", {
      headers: { "X-Room-Session": extraSession.participantSessionId },
    })).json());
    assert.ok(history.some((m: { text: string }) => m.text === `Beyond the old cap ${suffix}`));
    assert.ok(history.some((m: { text: string }) => m.text === `Base ${suffix}`));
    const beyondOldCapMessage = history.find(m => m.text === `Beyond the old cap ${suffix}`)!;
    const report = await request(ids[24]!, "/account/chat/reports", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Room-Session": sessions[24]!.participantSessionId },
      body: JSON.stringify({ roomId: "MUSIC1", messageId: beyondOldCapMessage.id, reason: "harassment" }),
    });
    assert.equal(report.status, 201, "reports continue to work in an unlimited room");
    assert.equal((await request(owner, "/rooms/MUSIC1/audio/events")).status, 410);
    assert.equal((await request(owner, "/rooms/MUSIC1/participants/anything/microphone", { method: "PUT" })).status, 410);
  });
});
