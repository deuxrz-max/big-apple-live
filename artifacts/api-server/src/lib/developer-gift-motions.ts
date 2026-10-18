import { Storage, type File } from "@google-cloud/storage";
import { and, desc, eq } from "drizzle-orm";
import { db, developerGiftMotions, type DeveloperGiftMotion as DeveloperGiftMotionRow } from "@workspace/db";
import type { DeveloperGiftMotion, DeveloperGiftMotionPreset } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { RoomError } from "./room-store";

const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function objectStorageLocation() {
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Gift model storage is not available right now.");
  return { bucket: match[1]!, prefix: match[2]!.replace(/\/$/, "") };
}

function toResponse(row: DeveloperGiftMotionRow): DeveloperGiftMotion {
  return {
    id: row.giftId,
    name: row.name,
    cost: row.cost,
    format: row.format,
    category: row.category,
    animationNames: row.animationNames,
    motion: row.motion,
    byteSize: row.byteSize,
    fileUrl: `/api/social/gift-motions/${row.giftId}/file`,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function listOwnerGiftMotions(ownerId: string): Promise<DeveloperGiftMotion[]> {
  const rows = await db.select().from(developerGiftMotions)
    .where(and(eq(developerGiftMotions.ownerId, ownerId), eq(developerGiftMotions.active, true)))
    .orderBy(desc(developerGiftMotions.createdAt));
  return rows.map(toResponse);
}

export async function addGiftMotion(input: {
  ownerId: string;
  name: string;
  cost: number;
  originalName: string;
  filePath: string;
  category: DeveloperGiftMotionPreset["category"];
  animationNames: string[];
  motion: DeveloperGiftMotionPreset;
  checked: { format: "glb" | "gltf"; contentType: string; byteSize: number };
}): Promise<DeveloperGiftMotion> {
  const { bucket, prefix } = objectStorageLocation();
  const rowId = randomUUID();
  const giftId = `motion-${rowId}`;
  const objectPath = `${prefix}/streamtalk/developer/gift-motions/v1/${rowId}/model.${input.checked.format}`;
  const bucketRef = storage.bucket(bucket);
  const objectFile = bucketRef.file(objectPath);
  await bucketRef.upload(input.filePath, {
    destination: objectPath,
    resumable: false,
    metadata: {
      contentType: input.checked.contentType,
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { originalName: path.basename(input.originalName) },
    },
  });
  try {
    const [row] = await db.insert(developerGiftMotions).values({
      id: rowId,
      giftId,
      ownerId: input.ownerId,
      name: input.name.trim(),
      cost: input.cost,
      originalFilename: path.basename(input.originalName).slice(0, 255),
      format: input.checked.format,
      objectPath,
      byteSize: input.checked.byteSize,
      category: input.category,
      animationNames: input.animationNames,
      motion: input.motion as unknown as import("@workspace/db").GiftMotionPreset,
      active: true,
    }).returning();
    if (!row) throw new Error("Gift model was not saved.");
    return toResponse(row);
  } catch (error) {
    await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}

export async function getActiveGiftMotion(giftId: string): Promise<DeveloperGiftMotion | null> {
  const [row] = await db.select().from(developerGiftMotions)
    .where(and(eq(developerGiftMotions.giftId, giftId), eq(developerGiftMotions.active, true)))
    .limit(1);
  return row ? toResponse(row) : null;
}

export async function getOwnerGiftMotionFile(ownerId: string, giftId: string) {
  const [row] = await db.select().from(developerGiftMotions)
    .where(and(eq(developerGiftMotions.ownerId, ownerId), eq(developerGiftMotions.giftId, giftId)))
    .limit(1);
  if (!row) return null;
  const { bucket } = objectStorageLocation();
  return {
    file: storage.bucket(bucket).file(row.objectPath),
    contentType: row.format === "glb" ? "model/gltf-binary" : "model/gltf+json",
    byteSize: row.byteSize,
  };
}

export async function getActiveGiftMotionFile(giftId: string): Promise<{ file: File; contentType: string; byteSize: number } | null> {
  const [row] = await db.select().from(developerGiftMotions)
    .where(and(eq(developerGiftMotions.giftId, giftId), eq(developerGiftMotions.active, true)))
    .limit(1);
  if (!row) return null;
  const { bucket } = objectStorageLocation();
  return {
    file: storage.bucket(bucket).file(row.objectPath),
    contentType: row.format === "glb" ? "model/gltf-binary" : "model/gltf+json",
    byteSize: row.byteSize,
  };
}

export async function deleteOwnerGiftMotion(ownerId: string, giftId: string): Promise<boolean> {
  const [row] = await db.select({ objectPath: developerGiftMotions.objectPath })
    .from(developerGiftMotions).where(and(
      eq(developerGiftMotions.ownerId, ownerId),
      eq(developerGiftMotions.giftId, giftId),
      eq(developerGiftMotions.active, true),
    )).limit(1);
  if (!row) return false;
  await db.update(developerGiftMotions).set({ active: false, updatedAt: new Date() })
    .where(and(eq(developerGiftMotions.ownerId, ownerId), eq(developerGiftMotions.giftId, giftId)));
  const { bucket } = objectStorageLocation();
  await storage.bucket(bucket).file(row.objectPath).delete({ ignoreNotFound: true }).catch(() => undefined);
  return true;
}
