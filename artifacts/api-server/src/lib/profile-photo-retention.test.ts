import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, accountProfiles, profilePhotos } from "@workspace/db";
import { cleanupProfilePhotos, PHOTO_GRACE_MS, reportPhotoRetention } from "./profile-photo-retention";
import { stageProfilePhoto, readablePhoto, deleteFixturePhoto } from "./profile-photo-storage";
import { saveProfile } from "./account-profiles";

test("real storage retention deletes only expired synthetic unused photos and serializes saves", async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = `retention-fixture-${suffix}`;
  const username = `Ret_${suffix}`;
  const ids: string[] = [];
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#bbbbbb" } }).png().toBuffer();
  const currentBefore = await db.select().from(accountProfiles);
  const currentPhotoIds = currentBefore.flatMap(p => /^\/api\/photos\/([a-f0-9-]{36})$/.exec(p.photoUrl ?? "")?.[1] ?? []);
  const beforeBytes = new Map<string, Buffer>();
  for (const p of currentBefore) {
    const id = /^\/api\/photos\/([a-f0-9-]{36})$/.exec(p.photoUrl ?? "")?.[1];
    if (id) beforeBytes.set(id, (await (await readablePhoto(id, p.accountId)).file.download())[0]);
  }
  const counts = `SELECT (SELECT count(*)::int FROM room_messages) messages,
    (SELECT count(*)::int FROM social_ledger) ledger`;
  const countsBefore = (await pool.query(counts)).rows;
  t.after(async () => {
    await db.delete(accountProfiles).where(eq(accountProfiles.accountId, owner));
    for (const id of ids) await deleteFixturePhoto(id);
    await pool.end();
  });
  const stage = async () => {
    const photo = await stageProfilePhoto(owner, png);
    ids.push(photo.photoUrl.split("/").at(-1)!);
    return { url: photo.photoUrl, id: ids.at(-1)! };
  };
  const old = new Date(Date.now() - PHOTO_GRACE_MS - 60_000);
  const abandoned = await stage();
  const current = await stage();
  const recent = await stage();
  const replaced = await stage();
  const removed = await stage();
  const busy = await stage();
  const interrupted = await stage();
  const brokenKey = await stage();
  await db.update(profilePhotos).set({ createdAt: old, unusedSince: old })
    .where(inArray(profilePhotos.id, ids.filter(id => id !== recent.id)));
  await saveProfile(owner, { username, photoUrl: current.url });
  // Even stale metadata cannot override a current reference.
  await db.update(profilePhotos).set({ unusedSince: old }).where(eq(profilePhotos.id, current.id));
  const dry = await cleanupProfilePhotos({ onlyIds: ids });
  assert.equal(dry.deleted, 0);
  assert.ok(dry.eligible >= 6);
  assert.ok(dry.eligibleBytes > 0);
  assert.equal((await db.select().from(profilePhotos).where(inArray(profilePhotos.id, ids))).length, ids.length);
  assert.ok(!(await reportPhotoRetention()).candidates.some(p => p.id === current.id));

  // Changing a long-lived image starts a fresh clock at replacement/removal.
  await saveProfile(owner, { username, photoUrl: replaced.url });
  await saveProfile(owner, { username, photoUrl: removed.url });
  await saveProfile(owner, { username, photoUrl: null });
  await saveProfile(owner, { username, photoUrl: current.url });
  for (const photo of [replaced, removed]) {
    const [row] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, photo.id));
    assert.ok(row!.unusedSince!.getTime() > Date.now() - 60_000);
  }
  // A genuine concurrent save queues behind the account lock; cleanup skips it.
  const connection = await pool.connect();
  let saving: ReturnType<typeof saveProfile> | undefined;
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
    saving = saveProfile(owner, { username, photoUrl: busy.url });
    const result = await cleanupProfilePhotos({ dryRun: false, onlyIds: [busy.id] });
    assert.equal(result.deleted, 0);
    assert.equal(result.skipped, 1);
    await connection.query("COMMIT");
    await saving;
    assert.equal((await cleanupProfilePhotos({ dryRun: false, onlyIds: [busy.id] })).deleted, 0);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await saving;
  }
  await saveProfile(owner, { username, photoUrl: current.url });
  // Simulate interruption after deletion but before removing the database row.
  await db.update(profilePhotos).set({ deletionStartedAt: new Date() }).where(eq(profilePhotos.id, interrupted.id));
  const interruptedFile = (await readablePhoto(abandoned.id, owner)).file;
  const interruptedKey = `${interrupted.id}.webp`;
  await interruptedFile.bucket.file(interruptedFile.name.replace(`${abandoned.id}.webp`, interruptedKey))
    .delete({ ignoreNotFound: true });
  await assert.rejects(saveProfile(owner, { username, photoUrl: interrupted.url }), /expired/);
  // Invalid keys fail safely without touching any other object; record is retained.
  await db.update(profilePhotos).set({ objectKey: "not-a-generated-key" }).where(eq(profilePhotos.id, brokenKey.id));
  const broken = await cleanupProfilePhotos({ dryRun: false, onlyIds: [brokenKey.id] });
  assert.equal(broken.failed, 1);
  assert.equal(broken.deleted, 0);
  await assert.rejects(saveProfile(owner, { username, photoUrl: brokenKey.url }), /expired/);
  await db.update(profilePhotos).set({ objectKey: `${brokenKey.id}.webp` }).where(eq(profilePhotos.id, brokenKey.id));
  const abandonedFile = (await readablePhoto(abandoned.id, owner)).file;
  const result = await cleanupProfilePhotos({ dryRun: false, onlyIds: ids });
  assert.equal(result.deleted, 3); // abandoned, interrupted and repaired key only
  assert.equal(result.failed, 0);
  assert.equal((await abandonedFile.exists())[0], false);
  assert.equal((await cleanupProfilePhotos({ dryRun: false, onlyIds: ids })).deleted, 0);
  const remaining = await db.select().from(profilePhotos).where(inArray(profilePhotos.id, ids));
  assert.deepEqual(new Set(remaining.map(p => p.id)), new Set([current.id, recent.id, replaced.id, removed.id, busy.id]));
  for (const photo of remaining)
    assert.ok((await (await readablePhoto(photo.id, owner)).file.download())[0].length > 0);

  // No original profile/file/account/message/financial data changed.
  assert.deepEqual(await db.select().from(accountProfiles).where(sql`${accountProfiles.accountId} <> ${owner}`), currentBefore);
  assert.deepEqual((await pool.query(counts)).rows, countsBefore);
  for (const id of currentPhotoIds) {
    const p = currentBefore.find(p => p.photoUrl === `/api/photos/${id}`)!;
    assert.deepEqual((await (await readablePhoto(id, p.accountId)).file.download())[0], beforeBytes.get(id));
  }
  // The destructive scope cannot become global when the fixture list is empty.
  assert.equal((await cleanupProfilePhotos({ dryRun: false, onlyIds: [] })).deleted, 0);
  // Synthetic absent objects exercise bounded batches and ignore-not-found retries.
  const batchIds = Array.from({ length: 26 }, () => randomUUID());
  ids.push(...batchIds);
  await db.insert(profilePhotos).values(batchIds.map(id => ({
    id, accountId: owner, objectKey: `${id}.webp`, size: 1, createdAt: old, unusedSince: old,
  })));
  const batch = await cleanupProfilePhotos({ dryRun: false, onlyIds: batchIds });
  assert.equal(batch.deleted, 25);
  assert.equal((await db.select().from(profilePhotos).where(inArray(profilePhotos.id, batchIds))).length, 1);
  assert.equal((await cleanupProfilePhotos({ dryRun: false, onlyIds: batchIds })).deleted, 1);
});
