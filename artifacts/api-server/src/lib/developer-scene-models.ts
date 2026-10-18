import { Storage, type File } from "@google-cloud/storage";
import { and, desc, eq } from "drizzle-orm";
import { db, developerSceneModels, type DeveloperSceneModel as DeveloperSceneModelRow, type SceneVector3 } from "@workspace/db";
import type { DeveloperSceneModel } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { RoomError } from "./room-store";

const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const MAX_GLTF_JSON_BYTES = 16 * 1024 * 1024;
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
  if (!match) throw new RoomError(503, "Model storage is not available right now.");
  return { bucket: match[1]!, prefix: match[2]!.replace(/\/$/, "") };
}

function modelFile(objectPath: string): File {
  const { bucket } = objectStorageLocation();
  return storage.bucket(bucket).file(objectPath);
}

function parseGltfJson(bytes: Buffer) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new RoomError(415, "That GLTF file is not valid JSON.");
  }
  const asset = parsed.asset as { version?: unknown } | undefined;
  if (!asset || typeof asset.version !== "string" || !asset.version.startsWith("2.")) {
    throw new RoomError(415, "Use a glTF 2.0 model.");
  }
  for (const section of ["buffers", "images"] as const) {
    const resources = parsed[section];
    if (!Array.isArray(resources)) continue;
    for (const resource of resources) {
      const uri = (resource as { uri?: unknown } | null)?.uri;
      if (uri !== undefined && (typeof uri !== "string" || !uri.startsWith("data:"))) {
        throw new RoomError(415, "This GLTF refers to external files. Upload a self-contained GLTF or a single GLB file.");
      }
    }
  }
}

export async function inspectSceneModelFile(filePath: string, originalName: string): Promise<{ format: "glb" | "gltf"; contentType: string; byteSize: number }> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size < 20 || fileStats.size > MAX_MODEL_BYTES) {
    throw new RoomError(fileStats.size > MAX_MODEL_BYTES ? 413 : 415, "Choose a valid GLB or glTF 2.0 model up to 100 MB.");
  }
  const extension = path.extname(originalName).toLowerCase();
  const handle = await open(filePath, "r");
  try {
    if (extension === ".glb") {
      const header = Buffer.alloc(20);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const chunkLength = bytesRead >= 20 ? header.readUInt32LE(12) : 0;
      const chunkType = bytesRead >= 20 ? header.readUInt32LE(16) : 0;
      const declaredLength = bytesRead >= 12 ? header.readUInt32LE(8) : 0;
      if (header.subarray(0, 4).toString("ascii") !== "glTF"
        || header.readUInt32LE(4) !== 2
        || declaredLength !== fileStats.size
        || chunkType !== 0x4e4f534a
        || chunkLength < 2
        || chunkLength > MAX_GLTF_JSON_BYTES
        || 20 + chunkLength > fileStats.size) {
        throw new RoomError(415, "That GLB file is not a valid glTF 2.0 model.");
      }
      const json = Buffer.alloc(chunkLength);
      await handle.read(json, 0, chunkLength, 20);
      parseGltfJson(json);
      return { format: "glb", contentType: "model/gltf-binary", byteSize: fileStats.size };
    }
    if (extension === ".gltf") {
      if (fileStats.size > MAX_GLTF_JSON_BYTES) throw new RoomError(413, "The GLTF JSON is too large; use a GLB file instead.");
      const bytes = Buffer.alloc(fileStats.size);
      await handle.read(bytes, 0, bytes.length, 0);
      parseGltfJson(bytes);
      return { format: "gltf", contentType: "model/gltf+json", byteSize: fileStats.size };
    }
    throw new RoomError(415, "Choose a .glb or .gltf model file.");
  } finally {
    await handle.close();
  }
}

function toResponse(row: DeveloperSceneModelRow): DeveloperSceneModel {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    fileUrl: `/api/social/scene-models/${row.id}/file`,
    position: row.position,
    rotation: row.rotation,
    scale: row.scale,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  };
}

export async function listActiveSceneModels(): Promise<DeveloperSceneModel[]> {
  const rows = await db.select().from(developerSceneModels)
    .where(eq(developerSceneModels.active, true))
    .orderBy(desc(developerSceneModels.createdAt));
  return rows.map(toResponse);
}

export async function listOwnerSceneModels(ownerId: string): Promise<DeveloperSceneModel[]> {
  const rows = await db.select().from(developerSceneModels)
    .where(eq(developerSceneModels.ownerId, ownerId))
    .orderBy(desc(developerSceneModels.createdAt));
  return rows.map(toResponse);
}

export async function addSceneModel(input: {
  ownerId: string;
  name: string;
  originalName: string;
  filePath: string;
}): Promise<DeveloperSceneModel> {
  const checked = await inspectSceneModelFile(input.filePath, input.originalName);
  const { bucket, prefix } = objectStorageLocation();
  const id = randomUUID();
  const objectPath = `${prefix}/streamtalk/developer/scene-models/v1/${id}/model.${checked.format}`;
  const file = storage.bucket(bucket).file(objectPath);
  await storage.bucket(bucket).upload(input.filePath, {
    destination: objectPath,
    resumable: false,
    metadata: {
      contentType: checked.contentType,
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { originalName: path.basename(input.originalName) },
    },
  });
  try {
    const [row] = await db.insert(developerSceneModels).values({
      id,
      ownerId: input.ownerId,
      name: input.name.trim(),
      originalFilename: path.basename(input.originalName).slice(0, 255),
      format: checked.format,
      objectPath,
      byteSize: checked.byteSize,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      active: true,
    }).returning();
    if (!row) throw new Error("The model record was not created.");
    return toResponse(row);
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}

export async function updateOwnerSceneModelPlacement(
  ownerId: string,
  id: string,
  input: { position: SceneVector3; rotation: SceneVector3; scale: number },
): Promise<DeveloperSceneModel | null> {
  const [row] = await db.update(developerSceneModels).set({
    position: input.position,
    rotation: input.rotation,
    scale: input.scale,
    updatedAt: new Date(),
  }).where(and(
    eq(developerSceneModels.ownerId, ownerId),
    eq(developerSceneModels.id, id),
  ))
    .returning();
  return row ? toResponse(row) : null;
}

export async function activeSceneModelFile(id: string): Promise<{ file: File; contentType: string; byteSize: number } | null> {
  const [row] = await db.select({
    objectPath: developerSceneModels.objectPath,
    format: developerSceneModels.format,
    byteSize: developerSceneModels.byteSize,
    active: developerSceneModels.active,
  }).from(developerSceneModels)
    .where(eq(developerSceneModels.id, id))
    .limit(1);
  if (!row) return null;
  if (!row.active) return null;
  return {
    file: modelFile(row.objectPath),
    contentType: row.format === "glb" ? "model/gltf-binary" : "model/gltf+json",
    byteSize: row.byteSize,
  };
}
