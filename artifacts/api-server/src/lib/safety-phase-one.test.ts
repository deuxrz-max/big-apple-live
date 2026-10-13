import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request, type ErrorRequestHandler } from "express";
import sharp from "sharp";
import { eq, inArray, and } from "drizzle-orm";
import { db, accountProfiles, chatAdmissions, chatModerators, profilePhotos, chatMemberships, roomMessages, chatReports, socialRelations } from "@workspace/db";
import router from "../routes";
import { initializeCommunities } from "./community";
import { RoomStore, SESSION_TIMEOUT_MS } from "./room-store";
import { UNIVERSITY_MEMBER_CAP } from "./university-config";
import { deleteFixturePhoto } from "./profile-photo-storage";
import { person } from "./social/core";
import { GetMyProfileResponse, GetPhotoReviewQueueResponse, JoinAccountRoomResponse, GetChatDirectoryResponse, GetRoomMessagesResponse } from "@workspace/api-zod";

test("24-seat setting, moderator exemption, reconnect and expired seats", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  store.registerCommunity({ roomId: "LIVEME", label: "LiveMe", historyId: randomUUID(), createdAt: new Date() });
  const identity = { emojiId: "1F600", gender: "Female" as const, color: "#FFFFFF", hairColor: "#000000" };
  const sessions = Array.from({ length: UNIVERSITY_MEMBER_CAP }, (_, i) =>
    store.join("LIVEME", `Member ${i}`, { accountId: `member-${i}`, identity }));
  assert.equal(store.get("LIVEME").capacity, UNIVERSITY_MEMBER_CAP);
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), false);
  assert.throws(() => store.join("LIVEME", "Next", { accountId: "next", identity }), /capacity/);
  assert.equal(store.join("LIVEME", "Member 0", { accountId: "member-0", identity }).participantSessionId, sessions[0]!.participantSessionId);
  store.join("LIVEME", "Moderator", { accountId: "moderator", identity, capExempt: true });
  assert.equal(store.get("LIVEME").participants.length, UNIVERSITY_MEMBER_CAP + 1);
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), false);
  now = SESSION_TIMEOUT_MS;
  assert.equal(store.hasUniversitySeat("LIVEME", "next"), true);
});

test("real HTTP/DB/storage photo moderation and university overflow; synthetic Clerk identities only", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const ids = Array.from({ length: UNIVERSITY_MEMBER_CAP + 2 }, (_, i) => `safety-fixture-${suffix}-${i}`);
  const photos: string[] = [];
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
  await t.test("the directory contains only the 20 current rooms and retires the old public room IDs", async () => {
    const directory = GetChatDirectoryResponse.parse(
      await (await request(owner, "/account/chat/rooms")).json(),
    );
    assert.deepEqual(directory.map(room => room.label), [
      "Music", "Gaming", "Kids", "Comedy", "Vlogs", "Sports", "News", "Movies", "Podcasts", "Reactions",
      "Pranks", "Food", "Beauty", "How-To", "Tech", "Education", "Fitness", "Pets", "Travel", "ASMR",
    ]);
    assert.equal(directory.length, 20);
    assert.equal(directory.some(room => room.roomId === "LIVEME" || room.roomId === "WORLDNEWS"), false);
    const oldRoomJoin = await request(owner, "/account/rooms/LIVEME/join", { method: "POST" });
    assert.equal(oldRoomJoin.status, 410, await oldRoomJoin.text());
  });
  const sessions: { participantSessionId: string }[] = [];
  await t.test("25th member gets overflow, moderators can enter full base, empty overflow hidden", async () => {
    for (let i = 0; i < UNIVERSITY_MEMBER_CAP; i++) {
      const response = await request(ids[i]!, "/account/rooms/MUSIC1/join", { method: "POST" });
      assert.equal(response.status, 201);
      sessions.push(JoinAccountRoomResponse.parse(await response.json()));
    }
    const full = await request(ids[UNIVERSITY_MEMBER_CAP]!, "/account/rooms/MUSIC1/join", { method: "POST" });
    assert.equal(full.status, 409);
    const offer = await full.json() as { error: string; overflow: { roomId: string; label: string } };
    assert.equal(offer.overflow.label, "Music 2");
    assert.match(offer.error, /is full/);
    const emptyDirectory = GetChatDirectoryResponse.parse(await (await request(owner, "/account/chat/rooms")).json());
    assert.ok(!emptyDirectory.some((r: { roomId: string }) => r.roomId === offer.overflow.roomId));
    assert.equal(emptyDirectory.find(r => r.roomId === "MUSIC1")?.headcount, UNIVERSITY_MEMBER_CAP);
    const publicDirectoryResponse = await fetch(`${base}/account/chat/rooms`);
    assert.equal(publicDirectoryResponse.status, 200);
    const publicDirectory = await publicDirectoryResponse.json() as Record<string, unknown>[];
    assert.ok(publicDirectory.every(r => Object.keys(r).sort().join(",") === "headcount,label,roomId"),
      "Public headcounts must not disclose participants or chat");
    const joined = await request(ids[UNIVERSITY_MEMBER_CAP]!, `/account/rooms/${offer.overflow.roomId}/join`, { method: "POST" });
    assert.equal(joined.status, 201);
    const overflowSession = JoinAccountRoomResponse.parse(await joined.json());
    assert.equal((await request(mod, "/account/rooms/MUSIC1/join", { method: "POST" })).status, 201);
    const send = (actor: string, roomId: string, sessionId: string, text: string) => request(actor, `/account/rooms/${roomId}/messages`, {
      method: "POST", ...json({ text, kind: "text" }),
      headers: { "Content-Type": "application/json", "X-Room-Session": sessionId },
    });
    assert.equal((await send(owner, "MUSIC1", sessions[0]!.participantSessionId, `Base ${suffix}`)).status, 201);
    assert.equal((await send(ids[UNIVERSITY_MEMBER_CAP]!, offer.overflow.roomId, overflowSession.participantSessionId, `Overflow ${suffix}`)).status, 201);
    const history = GetRoomMessagesResponse.parse(await (await request(ids[UNIVERSITY_MEMBER_CAP]!, `/account/rooms/${offer.overflow.roomId}/messages`, {
      headers: { "X-Room-Session": overflowSession.participantSessionId },
    })).json());
    assert.ok(history.some((m: { text: string }) => m.text === `Overflow ${suffix}`));
    assert.ok(!history.some((m: { text: string }) => m.text === `Base ${suffix}`));
    const visibleDirectory = GetChatDirectoryResponse.parse(await (await request(owner, "/account/chat/rooms")).json());
    assert.ok(visibleDirectory.some((r: { roomId: string }) => r.roomId === offer.overflow.roomId));
    assert.equal(visibleDirectory.find(r => r.roomId === offer.overflow.roomId)?.headcount, 1);
    assert.equal(visibleDirectory.find(r => r.roomId === "MUSIC1")?.headcount, UNIVERSITY_MEMBER_CAP + 1,
      "Presence includes the exempt moderator without changing the member cap");
    const overflowMessage = history.find(m => m.text === `Overflow ${suffix}`)!;
    const report = await request(ids[UNIVERSITY_MEMBER_CAP]!, "/account/chat/reports", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Room-Session": overflowSession.participantSessionId },
      body: JSON.stringify({ roomId: offer.overflow.roomId, messageId: overflowMessage.id, reason: "harassment" }),
    });
    assert.equal(report.status, 201, "Overflow supports the same report system");
    // Existing base members may also visit overflow; each university counts independently.
    for (let i = 0; i < UNIVERSITY_MEMBER_CAP - 1; i++) {
      assert.equal((await request(ids[i]!, `/account/rooms/${offer.overflow.roomId}/join`, { method: "POST" })).status, 201);
    }
    const thirdOffer = await request(ids[UNIVERSITY_MEMBER_CAP - 1]!, `/account/rooms/${offer.overflow.roomId}/join`, { method: "POST" });
    assert.equal(thirdOffer.status, 409);
    const third = await thirdOffer.json() as { overflow: { roomId: string; label: string } };
    assert.equal(third.overflow.label, "Music 3");
    assert.notEqual(third.overflow.roomId, offer.overflow.roomId);
    assert.equal((await request(mod, `/account/rooms/${offer.overflow.roomId}/join`, { method: "POST" })).status, 201);
    assert.equal((await request(owner, "/rooms/MUSIC1/audio/events")).status, 410);
    assert.equal((await request(owner, "/rooms/MUSIC1/participants/anything/microphone", { method: "PUT" })).status, 410);
  });
});
