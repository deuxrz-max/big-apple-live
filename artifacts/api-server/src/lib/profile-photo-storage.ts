import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, profilePhotos, accountProfiles } from "@workspace/db";
import { RoomError } from "./room-store";
import { canReviewPhotos } from "./photo-visibility";

export const PHOTO_LIMIT = 5 * 1024 * 1024;
const client = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
function objectFile(key: string) {
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Photo storage is not configured");
  return client.bucket(match[1]!).file(`${match[2]!.replace(/\/$/, "")}/profile-photos/${key}`);
}
export async function removeRetiredPhotoObject(id: string, key: string) {
  // Cleanup only owns this exact generated namespace, never arbitrary paths.
  if (key !== `${id}.webp` || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error("Refusing to delete a non-generated profile photo key");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      objectFile(key).delete({ ignoreNotFound: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Photo deletion timed out")), 10_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
export async function normalizePhoto(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length) throw new RoomError(400, "Choose a JPEG, PNG or WebP photo");
  if (bytes.length > PHOTO_LIMIT) throw new RoomError(413, "Photo must be 5 MiB or smaller");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp) throw new RoomError(400, "Actual file type must be JPEG, PNG or WebP");
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height || (meta.pages ?? 1) > 1)
      throw new Error("Unsupported image");
    // Force a full decode, normalize orientation, and re-encode without EXIF/GPS.
    return await image.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new RoomError(400, "Photo could not be decoded. Use a static JPEG, PNG or WebP under 16 megapixels");
  }
}
const inflight = new Set<string>();
export async function stageProfilePhoto(accountId: string, bytes: Buffer) {
  if (inflight.has(accountId) || inflight.size >= 4) throw new RoomError(429, "Another photo is being processed. Please try again shortly");
  inflight.add(accountId);
  try {
    const [rate] = await db.select({ count: sql<number>`count(*)::int` }).from(profilePhotos)
      .where(and(eq(profilePhotos.accountId, accountId), gte(profilePhotos.createdAt, new Date(Date.now() - 3_600_000))));
    if ((rate?.count ?? 0) >= 20) throw new RoomError(429, "Up to 20 photo uploads per hour. Please try later");
    const clean = await normalizePhoto(bytes);
    const id = randomUUID();
    const key = `${id}.webp`; // Never use supplied names, URLs or paths.
    const file = objectFile(key);
    try {
      await file.save(clean, { resumable: false, metadata: { contentType: "image/webp", cacheControl: "private, max-age=3600" } });
    } catch {
      throw new RoomError(503, "Photo storage is unavailable. Your profile has not changed");
    }
    try {
      await db.insert(profilePhotos).values({ id, accountId, objectKey: key, size: clean.length });
    } catch (error) {
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    return { photoUrl: `/api/photos/${id}` };
  } finally {
    inflight.delete(accountId);
  }
}
export async function readablePhoto(photoId: string, viewerId: string) {
  const [photo] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, photoId));
  if (!photo || photo.deletionStartedAt) throw new RoomError(404, "Photo not available");
  if (photo.accountId !== viewerId && !(await canReviewPhotos(viewerId))) {
    if (photo.status !== "approved") throw new RoomError(404, "Photo not available");
    const [active] = await db.select({ id: accountProfiles.accountId }).from(accountProfiles).where(and(
      eq(accountProfiles.accountId, photo.accountId),
      sql`(${accountProfiles.photoUrl} = ${`/api/photos/${photoId}`} OR ${`/api/photos/${photoId}`} = ANY(${accountProfiles.photoUrls}))`));
    if (!active) throw new RoomError(404, "Photo not available");
  }
  return { file: objectFile(photo.objectKey), ownerId: photo.accountId };
}
// Test-only callers use their own generated object and record; no user cleanup.
export async function deleteFixturePhoto(id: string) {
  const [photo] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, id));
  if (photo) { await objectFile(photo.objectKey).delete({ ignoreNotFound: true }); await db.delete(profilePhotos).where(eq(profilePhotos.id, id)); }
}
