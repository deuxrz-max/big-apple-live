import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import express, { type Request, type ErrorRequestHandler } from "express";
import { db, accountProfiles, profilePhotos, chatAdmissions, chatRooms, chatMemberships, roomMessages } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { normalizePhoto, PHOTO_LIMIT, deleteFixturePhoto } from "./profile-photo-storage";
import { saveProfile, getProfile } from "./account-profiles";
import { RoomStore } from "./room-store";
import { acceptMessage, getMessages } from "./room-chat";
import photoRouter from "../routes/profile-photos";
import { cleanupProfilePhotos, PHOTO_GRACE_MS } from "./profile-photo-retention";

test("photo decoding rejects invalid formats/size and strips metadata", async () => {
  for (const invalid of [Buffer.from("<svg></svg>"), Buffer.from("not an image"), Buffer.from([0xff, 0xd8, 0xff, 0x01])])
    await assert.rejects(normalizePhoto(invalid), /file type|decoded/);
  await assert.rejects(normalizePhoto(Buffer.alloc(PHOTO_LIMIT + 1)), /5 MiB/);
  const jpeg = await sharp({ create: { width: 1024, height: 768, channels: 3, background: "#414141" } })
    .withMetadata({ exif: { IFD0: { Artist: "synthetic test" } } }).jpeg().toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif);
  const cleaned = await normalizePhoto(jpeg);
  const meta = await sharp(cleaned).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.iptc, undefined);
  assert.equal(meta.xmp, undefined);
});

test("real HTTP, PostgreSQL and App Storage upload, replacement, privacy and emoji invariance", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const ids = ["a", "b"].map(x => `photo-fixture-${suffix}-${x}`);
  const names = ["a", "b"].map(x => `Photo_${suffix}_${x}`);
  const codes = ["Z", "Y"].map(x => `${x}${suffix.slice(0, 5)}`.toUpperCase());
  const histories = [randomUUID(), randomUUID()];
  const uploaded: string[] = [];
  let actor: string | null = ids[0]!;
  const app = express();
  app.use((req, _res, next) => {
    const auth = () => ({ userId: actor, tokenType: "session_token", sessionId: actor ? "fixture-session" : null });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    (req as Request & { auth: typeof auth }).auth = auth;
    next();
  });
  app.use(photoRouter);
  const errors: ErrorRequestHandler = (e, _req, res, _next) => { res.status(e.status ?? 500).json({ error: e.message }); };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await db.delete(roomMessages).where(inArray(roomMessages.historyId, histories));
    await db.delete(chatMemberships).where(inArray(chatMemberships.historyId, histories));
    await db.delete(chatRooms).where(inArray(chatRooms.roomId, codes));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    for (const id of uploaded) await deleteFixturePhoto(id);
    await db.$client.end();
  });
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#dddddd" } }).png().toBuffer();
  const upload = (bytes: Buffer) => fetch(`${base}/me/photo`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes),
  });
  actor = null;
  assert.equal((await upload(png)).status, 401);
  actor = ids[0]!;
  assert.equal((await upload(Buffer.from("<svg></svg>"))).status, 400);
  assert.equal((await upload(Buffer.alloc(PHOTO_LIMIT + 1))).status, 413);
  assert.equal(await getProfile(ids[0]!), null);
  const first = await upload(png);
  const result = await first.json() as { photoUrl: string; error?: string };
  assert.equal(first.status, 201, result.error);
  assert.match(result.photoUrl, /^\/api\/photos\/[a-f0-9-]+$/);
  uploaded.push(result.photoUrl.split("/").at(-1)!);
  const urlPath = result.photoUrl.replace("/api", "");
  // A staged image can be seen only by its uploader.
  const ownPreview = await fetch(`${base}${urlPath}`);
  assert.equal(ownPreview.status, 200);
  assert.equal(ownPreview.headers.get("content-type"), "image/webp");
  assert.ok((await ownPreview.arrayBuffer()).byteLength > 0);
  actor = ids[1]!;
  assert.equal((await fetch(`${base}${urlPath}`)).status, 404);
  await assert.rejects(saveProfile(ids[1]!, { username: names[1]!, photoUrl: result.photoUrl }), /only your own/);
  assert.equal(await getProfile(ids[1]!), null);
  await assert.rejects(saveProfile(ids[0]!, { username: names[0]!, photoUrl: "https://example.com/fake.jpg" }), /Upload a photo/);
  const profile = await saveProfile(ids[0]!, { username: names[0]!, displayName: "Photo tester", bio: "Persistent", photoUrl: result.photoUrl });
  assert.equal((await getProfile(ids[0]!))!.photoUrl, result.photoUrl);
  actor = ids[1]!;
  assert.equal((await fetch(`${base}${urlPath}`)).status, 200);
  // Same profile photo everywhere: presence, persisted history, accepted events.
  await db.insert(chatRooms).values(codes.map((roomId, i) => ({ roomId, historyId: histories[i]!, label: "Synthetic university" })));
  const store = new RoomStore();
  codes.forEach((roomId, i) => store.registerCommunity({ roomId, historyId: histories[i]!, label: "Synthetic university", createdAt: new Date(), atmosphere: null }));
  const joined = store.join(codes[0]!, profile.displayName!, { accountId: ids[0]!, identity: profile.identity, photoUrl: profile.photoUrl });
  await db.insert(chatMemberships).values({ accountId: ids[0]!, historyId: histories[0]!, participantId: joined.participantId });
  for (const text of ["😂", "😡", "😭", "😂 😡"]) {
    const accepted = await acceptMessage(codes[0]!, joined.participantSessionId, ids[0]!, { text, kind: "text" }, store);
    assert.equal(accepted.profile.photoUrl, result.photoUrl);
    assert.equal(accepted.message.photoUrl, result.photoUrl);
    assert.deepEqual(accepted.profile.identity, profile.identity);
  }
  assert.equal(store.get(codes[0]!).participants[0]!.photoUrl, result.photoUrl);
  assert.equal((await getMessages(codes[1]!, store)).length, 0);
  assert.equal((await getMessages(codes[0]!, store))[0]!.photoUrl, result.photoUrl);
  actor = ids[0]!;
  const second = await upload(png);
  const replacement = await second.json() as { photoUrl: string; error?: string };
  assert.equal(second.status, 201, replacement.error);
  uploaded.push(replacement.photoUrl.split("/").at(-1)!);
  assert.notEqual(replacement.photoUrl, result.photoUrl);
  await saveProfile(ids[0]!, { username: names[0]!, photoUrl: replacement.photoUrl });
  assert.equal((await getProfile(ids[0]!))!.photoUrl, replacement.photoUrl);
  assert.equal((await getProfile(ids[0]!))!.bio, "Persistent");
  assert.equal((await getMessages(codes[0]!, store))[0]!.photoUrl, replacement.photoUrl);
  actor = ids[1]!;
  assert.equal((await fetch(`${base}${urlPath}`)).status, 404);
  actor = ids[0]!;
  const gallery = [replacement.photoUrl];
  for (let i = 0; i < 3; i++) {
    const response = await upload(png);
    const photo = await response.json() as { photoUrl: string; error?: string };
    assert.equal(response.status, 201, photo.error);
    gallery.push(photo.photoUrl);
    uploaded.push(photo.photoUrl.split("/").at(-1)!);
  }
  const four = await saveProfile(ids[0]!, { username: names[0]!, photoUrls: gallery, photoUrl: gallery[1]! });
  assert.deepEqual(four.photoUrls, gallery);
  assert.equal((await getProfile(ids[0]!))!.photoUrl, gallery[1]);
  assert.deepEqual((await getProfile(ids[0]!))!.photoUrls, gallery);
  await assert.rejects(saveProfile(ids[0]!, { username: names[0]!, photoUrls: [...gallery, result.photoUrl] }), /up to 4/);
  await assert.rejects(saveProfile(ids[0]!, { username: names[0]!, photoUrls: [gallery[0]!, gallery[0]!] }), /different/);
  await assert.rejects(saveProfile(ids[0]!, { username: names[0]!, photoUrls: gallery, photoUrl: result.photoUrl }), /main photo/);
  await assert.rejects(saveProfile(ids[1]!, { username: names[1]!, photoUrls: [gallery[2]!] }), /only your own/);
  assert.deepEqual((await getProfile(ids[0]!))!.photoUrls, gallery);
  // Secondary saved images remain readable and cannot be deleted by retention.
  const secondaryId = gallery[3]!.split("/").at(-1)!;
  await db.update(profilePhotos).set({ unusedSince: new Date(Date.now() - PHOTO_GRACE_MS - 60_000) }).where(eq(profilePhotos.id, secondaryId));
  assert.equal((await cleanupProfilePhotos({ dryRun: false, onlyIds: [secondaryId] })).deleted, 0);
  actor = ids[1]!;
  assert.equal((await fetch(`${base}${gallery[2]!.replace("/api", "")}`)).status, 200);
  // A main-only compatibility edit must retain the other saved photos.
  await saveProfile(ids[0]!, { username: names[0]!, bio: "Three photos retained" });
  assert.deepEqual((await getProfile(ids[0]!))!.photoUrls, gallery);
  await saveProfile(ids[0]!, { username: names[0]!, photoUrls: [gallery[0]!, result.photoUrl, gallery[2]!], photoUrl: result.photoUrl });
  const [removed] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, gallery[1]!.split("/").at(-1)!));
  assert.ok(removed!.unusedSince);
  assert.ok(removed!.unusedSince!.getTime() > Date.now() - 60_000);
  await saveProfile(ids[0]!, { username: names[0]!, photoUrls: [], photoUrl: null });
  assert.equal((await getProfile(ids[0]!))!.photoUrl, null);
  assert.deepEqual((await getProfile(ids[0]!))!.photoUrls, []);
  assert.equal((await getMessages(codes[0]!, store))[0]!.photoUrl, null);
});
