import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request, type ErrorRequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, accountProfiles, profilePhotos, socialRelations, chatAdmissions } from "@workspace/db";
import { RoomStore, roomStore, SESSION_TIMEOUT_MS } from "./room-store";
import { getMe } from "./social/people";
import router from "../routes";
import { GetFavoritesGalleryResponse, GetFavoriteRoomResponse } from "@workspace/api-zod";

const identity = { emojiId: "1F600", gender: "Female" as const, color: "#FFFFFF", hairColor: "#000000" };
test("favorite location follows most recent live heartbeat without renewing presence", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  for (const [roomId, label] of [["BIGOLV", "Bigo Live"], ["BIGOLV2", "Bigo Live 2"]]) {
    store.registerCommunity({ roomId: roomId!, label: label!, historyId: randomUUID(), createdAt: new Date() });
  }
  const base = store.join("BIGOLV", "Person", { accountId: "person", identity });
  now = 100;
  const overflow = store.join("BIGOLV2", "Person", { accountId: "person", identity });
  assert.deepEqual(store.latestUniversityForAccount("person"), { roomId: "BIGOLV2", label: "Bigo Live 2" });
  now = 200;
  store.heartbeat("BIGOLV", base.participantSessionId);
  assert.deepEqual(store.latestUniversityForAccount("person"), { roomId: "BIGOLV", label: "Bigo Live" });
  store.leave("BIGOLV", base.participantSessionId);
  assert.equal(store.latestUniversityForAccount("person")!.label, "Bigo Live 2");
  now = 100 + SESSION_TIMEOUT_MS;
  assert.equal(store.latestUniversityForAccount("person"), null);
  assert.throws(() => store.heartbeat("BIGOLV2", overflow.participantSessionId));
  assert.equal(store.latestUniversityForAccount("unknown"), null);
});

test("favorites gallery HTTP permissions, photo moderation and exact overflow label (fixture identities)", async t => {
  const token = randomUUID().replaceAll("-", "").slice(0, 8);
  const ids = ["a", "b", "c"].map(s => `favorite-fixture-${token}-${s}`);
  const names = ["a", "b", "c"].map(s => `Favorite_${token}_${s}`);
  const photoId = randomUUID();
  const code = `F${token}`.toUpperCase();
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
  const request = (actor: number | null, path: string) => fetch(`${base}/social/favorites${path}`, {
    headers: actor === null ? {} : { "X-Fixture-User": ids[actor]! },
  });
  let session: string | undefined;
  t.after(async () => {
    if (session) roomStore.leave(code, session);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(profilePhotos).where(eq(profilePhotos.id, photoId));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: names[i]!, nameKey: names[i]!.toLowerCase(), displayName: `Favorite person ${i}`,
    ...identity, ...(i === 1 ? { photoUrl: `/api/photos/${photoId}`, photoUrls: [`/api/photos/${photoId}`] } : {}),
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  for (const id of ids) await getMe(id);
  await db.insert(profilePhotos).values({
    id: photoId, accountId: ids[1]!, objectKey: `fixture-only/${photoId}`, size: 1, status: "pending",
  });
  await db.insert(socialRelations).values({ ownerId: ids[0]!, targetId: ids[1]!, kind: "favorite" });
  roomStore.registerCommunity({ roomId: code, label: "Bigo Live 2", historyId: randomUUID(), createdAt: new Date() });

  await t.test("offline favorite has no room, pending photo is hidden and unauthenticated reads fail", async () => {
    const response = await request(0, "/gallery");
    assert.equal(response.status, 200);
    const entries = GetFavoritesGalleryResponse.parse(await response.json());
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.room, null);
    assert.equal(entries[0]!.person.photoUrl, null);
    assert.deepEqual(entries[0]!.person.photoUrls, []);
    assert.equal((await request(null, "/gallery")).status, 401);
  });
  await t.test("exact numbered room is visible only to the person who favorited this account", async () => {
    session = roomStore.join(code, names[1]!, { accountId: ids[1]!, identity }).participantSessionId;
    const response = await request(0, `/${names[1]}/room`);
    assert.equal(response.status, 200);
    assert.deepEqual(GetFavoriteRoomResponse.parse(await response.json()).room, { roomId: code, label: "Bigo Live 2" });
    assert.equal((await request(2, `/${names[1]}/room`)).status, 404);
    const gallery = GetFavoritesGalleryResponse.parse(await (await request(0, "/gallery")).json());
    assert.equal(gallery[0]!.room!.label, "Bigo Live 2");
  });
  await t.test("approved main photo is returned, rejection hides it again", async () => {
    await db.update(profilePhotos).set({ status: "approved" }).where(eq(profilePhotos.id, photoId));
    const approved = GetFavoritesGalleryResponse.parse(await (await request(0, "/gallery")).json());
    assert.equal(approved[0]!.person.photoUrl, `/api/photos/${photoId}`);
    await db.update(profilePhotos).set({ status: "rejected" }).where(eq(profilePhotos.id, photoId));
    const rejected = GetFavoritesGalleryResponse.parse(await (await request(0, "/gallery")).json());
    assert.equal(rejected[0]!.person.photoUrl, null);
  });
  await t.test("a block in either direction hides the gallery entry and prevents the location lookup", async () => {
    for (const [ownerId, targetId] of [[ids[0]!, ids[1]!], [ids[1]!, ids[0]!]]) {
      await db.insert(socialRelations).values({ ownerId, targetId, kind: "block" });
      assert.deepEqual(await (await request(0, "/gallery")).json(), []);
      assert.equal((await request(0, `/${names[1]}/room`)).status, 404);
      await db.delete(socialRelations).where(and(eq(socialRelations.ownerId, ownerId), eq(socialRelations.targetId, targetId), eq(socialRelations.kind, "block")));
    }
  });
  await t.test("leaving clears the recheck result and removing a favorite revokes room visibility", async () => {
    roomStore.leave(code, session!); session = undefined;
    assert.equal(GetFavoriteRoomResponse.parse(await (await request(0, `/${names[1]}/room`)).json()).room, null);
    await db.delete(socialRelations).where(and(eq(socialRelations.ownerId, ids[0]!), eq(socialRelations.targetId, ids[1]!)));
    assert.deepEqual(await (await request(0, "/gallery")).json(), []);
    assert.equal((await request(0, `/${names[1]}/room`)).status, 404);
  });
});
