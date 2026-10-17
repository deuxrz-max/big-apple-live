import { Storage } from "@google-cloud/storage";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { db, giftStudioAssets, type GiftStudioAsset } from "@workspace/db";
import type { GiftStudioGiftId, GiftStudioProcessingSettings, GiftStudioVersion } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { RoomError } from "./room-store";
import { giftNameFromSettings } from "./gift-studio-catalog";

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const GIFT_IDS = new Set<GiftStudioGiftId>([
  "heart", "spirit-pup", "moonfox", "cosmic-encore", "fireworks", "rose-shower", "whip",
]);
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export type GiftStudioMediaVariant = "original" | "webm" | "safari";

function storageFile(id: string, variant: GiftStudioMediaVariant, extension?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RoomError(404, "Gift media not found");
  const names: Record<GiftStudioMediaVariant, string> = {
    original: `source.${extension === "mov" ? "mov" : extension === "webm" ? "webm" : "mp4"}`,
    webm: "animation.webm",
    safari: "animation.png",
  };
  if (variant !== "original" && extension !== undefined) throw new RoomError(404, "Gift media not found");
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Gift Studio storage is unavailable");
  const prefix = match[2]!.replace(/\/$/, "");
  return storage.bucket(match[1]!).file(`${prefix}/gift-media/studio/v1/${id}/${names[variant]}`);
}

function mediaUrl(id: string, variant: GiftStudioMediaVariant, ownerOnly: boolean) {
  const base = ownerOnly
    ? `/api/social/admin/gift-studio/versions/${id}/media`
    : `/api/social/gift-studio/media/${id}`;
  return `${base}/${variant === "safari" ? "safari" : variant}`;
}

function toVersion(row: GiftStudioAsset): GiftStudioVersion {
  return {
    id: row.id,
    giftId: row.giftId as GiftStudioGiftId | null,
    version: row.version,
    status: row.status as "draft" | "active",
    originalName: row.originalName,
    durationMs: row.durationMs,
    settings: row.settings as unknown as GiftStudioProcessingSettings,
    createdAt: row.createdAt,
    originalUrl: mediaUrl(row.id, "original", true),
    webmUrl: mediaUrl(row.id, "webm", true),
    safariUrl: mediaUrl(row.id, "safari", true),
    originalBytes: row.originalBytes,
    webmBytes: row.webmBytes,
    safariBytes: row.safariBytes,
  };
}

async function probe(filePath: string) {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; duration?: string }>;
    };
  } catch {
    throw new RoomError(422, "This video could not be decoded. Try a short MP4, WebM or MOV clip.");
  }
}

async function sniffVideo(filePath: string, originalName = ""): Promise<"mp4" | "mov" | "webm"> {
  const file = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead >= 12 && header.subarray(0, 4).toString() === "\x1aE\xdf\xa3") return "webm";
    if (bytesRead >= 12 && header.subarray(4, 8).toString() === "ftyp") {
      const brand = header.subarray(8, 12).toString();
      return brand === "qt  " || /\.mov$/i.test(originalName) ? "mov" : "mp4";
    }
  } finally {
    await file.close();
  }
  // Some encoders prepend metadata or use container variants beyond the common magic bytes.
  // Ignore the browser-declared MIME type and ask ffprobe to identify the actual file contents.
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v", "error", "-print_format", "json", "-show_format", filePath,
    ], { timeout: 20_000, maxBuffer: 512 * 1024 });
    const format = (JSON.parse(stdout) as { format?: { format_name?: string } }).format?.format_name ?? "";
    if (format.includes("webm") || format.includes("matroska")) return "webm";
    if (format.includes("mov") || format.includes("mp4")) return /\.mov$/i.test(originalName) ? "mov" : "mp4";
  } catch {
    // A rejected or unreadable file is reported below with a format-specific message.
  }
  throw new RoomError(415, "Use an MP4, WebM or MOV video file.");
}

async function validateSource(filePath: string, fileSize: number, originalName = "") {
  if (!fileSize || fileSize > MAX_VIDEO_BYTES) throw new RoomError(413, "The original video must be 100 MB or smaller.");
  const type = await sniffVideo(filePath, originalName);
  const media = await probe(filePath);
  const video = media.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(video?.duration ?? media.format?.duration);
  const format = media.format?.format_name ?? "";
  const formatMatches = type === "webm"
    ? format.includes("webm") || format.includes("matroska")
    : format.includes("mov") || format.includes("mp4");
  if (!formatMatches || !video?.width || !video.height || !Number.isFinite(duration) || duration <= 0 || duration > 15.05) {
    throw new RoomError(422, "Use a decodable video up to 15 seconds long.");
  }
  return { type, durationMs: Math.round(duration * 1000) };
}

async function verifyAlpha(filePath: string, decoder?: "libvpx-vp9"): Promise<void> {
  const temp = await fs.mkdtemp(path.join(tmpdir(), "streamtalk-alpha-check-"));
  const framePattern = path.join(temp, "frame-%03d.png");
  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      ...(decoder ? ["-c:v", decoder] : []), "-i", filePath,
      "-vf", "fps=3,scale=128:128:force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba",
      "-an", "-vsync", "0", "-frames:v", "60", "-start_number", "1", framePattern,
    ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    const files = (await fs.readdir(temp)).filter((entry) => entry.endsWith(".png")).sort();
    if (files.length < 2) throw new Error("No decodable alpha frames");
    let transparentFrames = 0;
    let visibleFrames = 0;
    for (const entry of files) {
      const { data, info } = await sharp(path.join(temp, entry)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error("Frame did not decode with alpha");
      let clear = 0;
      let visible = 0;
      for (let offset = 3; offset < data.length; offset += 4) {
        const alpha = data[offset]!;
        if (alpha < 32) clear++;
        if (alpha > 200) visible++;
      }
      const pixels = info.width * info.height;
      if (clear / pixels >= 0.01) transparentFrames++;
      if (visible / pixels >= 0.03) visibleFrames++;
    }
    const requiredFrames = Math.max(2, Math.ceil(files.length * 0.2));
    if (transparentFrames < requiredFrames || visibleFrames < requiredFrames) {
      throw new Error("Decoded frames did not contain both visible artwork and transparent pixels");
    }
  } catch {
    throw new RoomError(422, "Transparency could not be verified in the processed video. Nothing was added.");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function createSafariFallback(webmPath: string, outputPath: string) {
  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-c:v", "libvpx-vp9", "-i", webmPath,
      "-vf", "fps=12,scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=rgba",
      "-an", "-vsync", "0", "-plays", "1", "-c:v", "apng", "-f", "apng", outputPath,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(outputPath);
    if (!stat.size || stat.size > MAX_VIDEO_BYTES) throw new Error("Fallback file size is outside the allowed range");
    await verifyAlpha(outputPath);
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(422, "The transparent iPhone playback version could not be created. Nothing was added.");
  }
}

async function uploadFile(filePath: string, file: ReturnType<typeof storageFile>, contentType: string) {
  await new Promise<void>((resolve, reject) => {
    const destination = file.createWriteStream({
      resumable: false,
      metadata: { contentType, cacheControl: "private, max-age=3600", contentDisposition: "inline" },
    });
    destination.once("finish", resolve);
    destination.once("error", reject);
    createReadStream(filePath).once("error", reject).pipe(destination);
  });
}

async function deleteAssets(id: string, extension: string) {
  await Promise.all([
    storageFile(id, "original", extension).delete({ ignoreNotFound: true }),
    storageFile(id, "webm").delete({ ignoreNotFound: true }),
    storageFile(id, "safari").delete({ ignoreNotFound: true }),
  ]);
}

export async function listGiftStudioVersions(ownerId: string) {
  const rows = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.ownerId, ownerId))
    .orderBy(desc(giftStudioAssets.createdAt));
  return { items: rows.map(toVersion) };
}

export async function processGiftStudioClipOnServer(input: {
  sourcePath: string;
  sourceBytes: number;
  sourceName?: string;
  settings: GiftStudioProcessingSettings;
  signal?: AbortSignal;
}) {
  await validateSource(input.sourcePath, input.sourceBytes, input.sourceName);
  const outputPath = path.join(path.dirname(input.sourcePath), `processed-${randomUUID()}.webm`);
  const boundedDimension = Math.min(input.settings.maxDimension ?? 480, 480);
  const color = input.settings.keyColor.replace("#", "0x");
  const similarity = Math.max(0.02, Math.min(0.65, input.settings.tolerance));
  const blend = Math.max(0, Math.min(0.5, input.settings.softness));
  const filters = [
    "fps=24",
    `scale='if(gte(iw,ih),min(iw,${boundedDimension}),-2)':'if(gte(iw,ih),-2,min(ih,${boundedDimension}))':flags=lanczos`,
    `format=yuva420p,chromakey=${color}:${similarity.toFixed(3)}:${blend.toFixed(3)}`,
  ];
  if (input.settings.spill > 0.01 && input.settings.preset !== "black") {
    const despillChannel = input.settings.preset === "green" || input.settings.keyColor.toLowerCase() === "#00ff00"
      ? "green"
      : "blue";
    filters.push(`despill=type=${despillChannel}:mix=${Math.max(0, Math.min(1, input.settings.spill)).toFixed(2)}:expand=0`);
  }

  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input.sourcePath,
      "-vf", filters.join(","),
      "-an", "-t", "15",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
      "-b:v", "0", "-crf", "34", "-deadline", "realtime", "-cpu-used", "5",
      outputPath,
    ], {
      timeout: 240_000,
      maxBuffer: 2 * 1024 * 1024,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const stat = await fs.stat(outputPath);
    if (!stat.size || stat.size > MAX_VIDEO_BYTES) {
      throw new RoomError(413, "The transparent result is too large. Use a shorter clip.");
    }
    await verifyAlpha(outputPath, "libvpx-vp9");
    return { path: outputPath, bytes: stat.size };
  } catch (error) {
    if (error instanceof RoomError) throw error;
    if (input.signal?.aborted) throw new RoomError(400, "Processing was cancelled.");
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      throw new RoomError(422, "Server processing took too long. Try a shorter clip.");
    }
    throw new RoomError(422, "Server processing could not encode and verify this clip. Try another key color or a shorter source video.");
  }
}

export async function createGiftStudioVersion(input: {
  ownerId: string;
  giftId: GiftStudioGiftId | null;
  settings: GiftStudioProcessingSettings;
  originalPath: string;
  originalName: string;
  originalBytes: number;
  processedWebmPath: string;
  processedWebmBytes: number;
}) {
  if (input.giftId !== null && !GIFT_IDS.has(input.giftId)) throw new RoomError(400, "Choose an existing gift.");
  if (input.processedWebmBytes <= 0 || input.processedWebmBytes > MAX_VIDEO_BYTES) {
    throw new RoomError(413, "The processed animation must be 100 MB or smaller.");
  }
  const source = await validateSource(input.originalPath, input.originalBytes, input.originalName);
  if (await sniffVideo(input.processedWebmPath) !== "webm") {
    throw new RoomError(415, "The processed animation must be a transparent WebM video.");
  }
  const processed = await probe(input.processedWebmPath);
  const video = processed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(processed.format?.duration);
  if (!video || video.codec_name !== "vp9" || (processed.streams ?? []).some((stream) => stream.codec_type === "audio") ||
    !Number.isFinite(duration) || duration <= 0 || duration > 15.05 ||
    !((processed.format?.format_name ?? "").includes("webm") || (processed.format?.format_name ?? "").includes("matroska"))) {
    throw new RoomError(422, "The processed file must be a silent VP9 WebM animation up to 15 seconds long.");
  }
  await verifyAlpha(input.processedWebmPath, "libvpx-vp9");

  const temp = await fs.mkdtemp(path.join(tmpdir(), "streamtalk-gift-studio-"));
  const fallbackPath = path.join(temp, "animation.png");
  const id = randomUUID();
  const safeName = input.originalName.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120)
    || `source.${source.type}`;
  try {
    await createSafariFallback(input.processedWebmPath, fallbackPath);
    const fallbackBytes = (await fs.stat(fallbackPath)).size;
    const objects = [
      storageFile(id, "original", source.type),
      storageFile(id, "webm"),
      storageFile(id, "safari"),
    ];
    const mime = source.type === "webm" ? "video/webm" : source.type === "mov" ? "video/quicktime" : "video/mp4";
    try {
      const uploaded = await Promise.allSettled([
        uploadFile(input.originalPath, objects[0]!, mime),
        uploadFile(input.processedWebmPath, objects[1]!, "video/webm"),
        uploadFile(fallbackPath, objects[2]!, "image/png"),
      ]);
      const failedUpload = uploaded.find((result) => result.status === "rejected");
      if (failedUpload?.status === "rejected") throw failedUpload.reason;
      const row = await db.transaction(async (tx) => {
        const [maxVersionRow] = input.giftId
          ? await tx.select({ version: max(giftStudioAssets.version) }).from(giftStudioAssets)
            .where(eq(giftStudioAssets.giftId, input.giftId))
          : [];
        const version = input.giftId ? Number(maxVersionRow?.version ?? 0) + 1 : 1;
        const status = input.giftId ? "active" : "draft";
        if (input.giftId) {
          await tx.update(giftStudioAssets).set({ status: "draft", activatedAt: null }).where(and(
            eq(giftStudioAssets.giftId, input.giftId),
            eq(giftStudioAssets.status, "active"),
          ));
        }
        const [inserted] = await tx.insert(giftStudioAssets).values({
          id, ownerId: input.ownerId, giftId: input.giftId, version, status,
          originalName: safeName, originalExtension: source.type, durationMs: source.durationMs,
          originalBytes: input.originalBytes, webmBytes: input.processedWebmBytes,
          safariBytes: fallbackBytes, settings: { ...input.settings },
          activatedAt: input.giftId ? new Date() : null,
        }).returning();
        return inserted;
      });
      if (!row) throw new Error("Gift Studio version was not created");
      return toVersion(row);
    } catch (error) {
      await deleteAssets(id, source.type).catch(() => {});
      throw error;
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function renameGiftStudioVersion(ownerId: string, versionId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new RoomError(400, "Gift names must be 1 to 60 characters.");
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Saved gift not found.");
  const [updated] = await db.update(giftStudioAssets)
    .set({ settings: { ...asset.settings, draftName: trimmed } })
    .where(and(eq(giftStudioAssets.id, versionId), eq(giftStudioAssets.ownerId, ownerId)))
    .returning();
  if (!updated) throw new RoomError(404, "Saved gift not found.");
  return toVersion(updated);
}

export async function deleteGiftStudioVersion(ownerId: string, versionId: string) {
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Saved gift not found.");
  await deleteAssets(asset.id, asset.originalExtension);
  const [deleted] = await db.delete(giftStudioAssets).where(and(
    eq(giftStudioAssets.id, versionId),
    eq(giftStudioAssets.ownerId, ownerId),
  )).returning({ id: giftStudioAssets.id });
  if (!deleted) throw new RoomError(404, "Saved gift not found.");
  return { deleted: true as const };
}

export async function assignGiftStudioVersionToGift(ownerId: string, versionId: string, giftId: GiftStudioGiftId) {
  if (!GIFT_IDS.has(giftId)) throw new RoomError(400, "Choose an existing gift.");
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Gift animation version not found.");
  if (asset.giftId !== null || asset.status !== "draft") {
    throw new RoomError(400, "Only an unattached draft can be added to a gift.");
  }
  const [maxVersionRow] = await db.select({ version: max(giftStudioAssets.version) }).from(giftStudioAssets)
    .where(eq(giftStudioAssets.giftId, giftId));
  const [updated] = await db.update(giftStudioAssets)
    .set({ giftId, version: Number(maxVersionRow?.version ?? 0) + 1 })
    .where(and(eq(giftStudioAssets.id, versionId), eq(giftStudioAssets.ownerId, ownerId), isNull(giftStudioAssets.giftId)))
    .returning();
  if (!updated) throw new RoomError(409, "This draft was already added to a gift. Refresh the library.");
  return toVersion(updated);
}

export async function setGiftStudioVersionActive(ownerId: string, versionId: string, active: boolean) {
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Gift animation version not found.");
  if (!asset.giftId) throw new RoomError(400, "Add this draft to a gift before activating it.");
  const giftId = asset.giftId;
  const row = await db.transaction(async (tx) => {
    if (active) {
      await tx.update(giftStudioAssets).set({ status: "draft", activatedAt: null }).where(and(
        eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"),
      ));
    }
    const [updated] = await tx.update(giftStudioAssets)
      .set({ status: active ? "active" : "draft", activatedAt: active ? new Date() : null })
      .where(and(eq(giftStudioAssets.id, versionId), eq(giftStudioAssets.ownerId, ownerId)))
      .returning();
    return updated;
  });
  if (!row) throw new RoomError(404, "Gift animation version not found.");
  return toVersion(row);
}

export async function getActiveGiftStudioMedia(giftId: GiftStudioGiftId) {
  const [row] = await db.select().from(giftStudioAssets)
    .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"))).limit(1);
  if (!row) return { media: null };
  return { media: {
    versionId: row.id,
    name: giftNameFromSettings(row.settings, giftId),
    webmUrl: mediaUrl(row.id, "webm", false),
    safariUrl: mediaUrl(row.id, "safari", false),
    durationMs: row.durationMs,
  } };
}

export async function giftStudioMediaFile(input: {
  versionId: string;
  variant: GiftStudioMediaVariant;
  ownerId?: string;
  activeOnly?: boolean;
}) {
  const [row] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, input.versionId));
  if (!row || (input.ownerId && row.ownerId !== input.ownerId) ||
    (input.activeOnly && row.status !== "active") ||
    (!input.activeOnly && !input.ownerId)) throw new RoomError(404, "Gift media not found.");
  const file = storageFile(row.id, input.variant, input.variant === "original" ? row.originalExtension : undefined);
  const [exists] = await file.exists();
  if (!exists) throw new RoomError(404, "Gift media not found.");
  const contentType = input.variant === "original"
    ? row.originalExtension === "webm" ? "video/webm" : row.originalExtension === "mov" ? "video/quicktime" : "video/mp4"
    : input.variant === "webm" ? "video/webm" : "image/png";
  return { file, contentType, immutable: row.status === "active" };
}

