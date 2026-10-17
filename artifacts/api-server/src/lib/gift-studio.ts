import { Storage } from "@google-cloud/storage";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { db, giftStudioAssets, socialGiftCatalogSettings, type GiftStudioAsset } from "@workspace/db";
import type { GiftStudioGiftId, GiftStudioProcessingSettings, GiftStudioVersion } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { RoomError } from "./room-store";
import { giftNameFromSettings, listGiftCatalogForOwner, updateGiftCatalogItem } from "./gift-studio-catalog";

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const GIFT_IDS = new Set<GiftStudioGiftId>([
  "good-vibes", "big-love", "standing-ovation", "heart", "spirit-pup", "moonfox", "cosmic-encore", "fireworks", "rose-shower", "whip",
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
    let clearPixels = 0;
    let totalPixels = 0;
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
      clearPixels += clear;
      totalPixels += pixels;
      if (clear / pixels >= 0.01) transparentFrames++;
      if (visible / pixels >= 0.03) visibleFrames++;
    }
    const requiredFrames = Math.max(2, Math.ceil(files.length * 0.2));
    if (transparentFrames < requiredFrames) {
      const transparentPercent = totalPixels ? Math.round((clearPixels / totalPixels) * 100) : 0;
      throw new RoomError(
        422,
        `Only ${transparentPercent}% of pixels became transparent. Tap the background in the preview to sample its color, then process again.`,
      );
    }
    if (visibleFrames < requiredFrames) {
      throw new RoomError(422, "The key removed nearly all visible artwork. Choose a cleaner background sample and try again.");
    }
  } catch (error) {
    if (error instanceof RoomError) throw error;
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
  const [rows, catalog] = await Promise.all([
    db.select().from(giftStudioAssets).where(eq(giftStudioAssets.ownerId, ownerId))
      .orderBy(desc(giftStudioAssets.createdAt)),
    listGiftCatalogForOwner(),
  ]);
  return { items: rows.map(toVersion), catalog };
}

function giftKeyColor(settings: GiftStudioProcessingSettings) {
  const channels = settings.keyColor.replace("#", "");
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(channels.slice(offset, offset + 2), 16));
  const [r8, g8, b8] = rgb;
  const r = (r8 ?? 0) / 255;
  const g = (g8 ?? 0) / 255;
  const b = (b8 ?? 0) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (max === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = max === 0 ? 0 : chroma / max;
  return { red: r8 ?? 0, green: g8 ?? 0, blue: b8 ?? 0, hue, saturation, value: max };
}

function rgbToHsv(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (max === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : chroma / max, value: max };
}

function applyGiftStudioKey(data: Buffer, settings: GiftStudioProcessingSettings) {
  const key = giftKeyColor(settings);
  const low = Math.max(0, settings.tolerance * 80 - settings.softness * 45);
  const high = Math.min(88, settings.tolerance * 80 + settings.softness * 45);
  const range = Math.max(1, high - low);
  const spill = Math.max(0, Math.min(1, settings.spill));
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const red = data[offset]!;
    const green = data[offset + 1]!;
    const blue = data[offset + 2]!;
    const pixel = rgbToHsv(red, green, blue);
    let matte = 1;
    if (settings.preset === "black") {
      const distance = Math.sqrt(red * red + green * green + blue * blue) / 441.673;
      const blackLow = Math.max(0, settings.tolerance - settings.softness);
      const blackHigh = Math.min(1, settings.tolerance + settings.softness);
      const t = Math.max(0, Math.min(1, (distance - blackLow) / Math.max(0.001, blackHigh - blackLow)));
      matte = t * t * (3 - 2 * t);
    } else if (pixel.saturation >= Math.max(0.12, key.saturation * 0.2)) {
      const rawHueDistance = Math.abs(pixel.hue - key.hue);
      const hueDistance = Math.min(rawHueDistance, 360 - rawHueDistance);
      const chromaDistance = Math.abs(pixel.saturation - key.saturation) * 80;
      const valueDistance = Math.abs(pixel.value - key.value) * 18;
      const distance = Math.sqrt(hueDistance ** 2 + chromaDistance ** 2 + valueDistance ** 2);
      const t = Math.max(0, Math.min(1, (distance - low) / range));
      matte = t * t * (3 - 2 * t);
    }
    data[offset + 3] = Math.round(data[offset + 3]! * matte);
    const despill = spill * (1 - matte);
    if (despill > 0.001 && settings.preset !== "black") {
      if (key.hue >= 75 && key.hue <= 170) {
        data[offset + 1] = Math.round(green - Math.max(0, green - Math.max(red, blue)) * despill);
      } else if (key.hue >= 190 && key.hue <= 265) {
        data[offset + 2] = Math.round(blue - Math.max(0, blue - Math.max(red, green)) * despill);
      } else if (key.hue >= 265 && key.hue <= 335) {
        data[offset] = Math.round(red - Math.max(0, red - green) * despill);
        data[offset + 2] = Math.round(blue - Math.max(0, blue - green) * despill);
      }
    }
  }
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
  const workPath = path.join(path.dirname(input.sourcePath), `frames-${randomUUID()}`);
  const sourceFrames = path.join(workPath, "source");
  const keyedFrames = path.join(workPath, "keyed");
  const boundedDimension = Math.min(input.settings.maxDimension ?? 480, 480);

  try {
    await fs.mkdir(sourceFrames, { recursive: true });
    await fs.mkdir(keyedFrames, { recursive: true });
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input.sourcePath,
      "-vf", `fps=24,scale='if(gte(iw,ih),min(iw,${boundedDimension}),-2)':'if(gte(iw,ih),-2,min(ih,${boundedDimension}))':flags=lanczos,format=rgba`,
      "-an", "-t", "15", "-vsync", "0", "-start_number", "1",
      path.join(sourceFrames, "frame-%05d.png"),
    ], {
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const frameNames = (await fs.readdir(sourceFrames)).filter((name) => /^frame-\d+\.png$/.test(name)).sort();
    if (frameNames.length < 2) throw new Error("The clip did not produce enough frames to process.");
    for (const name of frameNames) {
      if (input.signal?.aborted) throw new RoomError(400, "Processing was cancelled.");
      const sourceFrame = path.join(sourceFrames, name);
      const { data, info } = await sharp(sourceFrame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error("A decoded frame did not contain RGBA pixels.");
      applyGiftStudioKey(data, input.settings);
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png({ compressionLevel: 1 })
        .toFile(path.join(keyedFrames, name));
    }
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", "24", "-start_number", "1", "-i", path.join(keyedFrames, "frame-%05d.png"),
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
  } finally {
    await fs.rm(workPath, { recursive: true, force: true });
  }
}

export async function createGiftStudioVersion(input: {
  ownerId: string;
  giftId: GiftStudioGiftId | null;
  catalogCost?: number;
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
          await tx.insert(socialGiftCatalogSettings).values({
            giftId: input.giftId,
            displayName: input.settings.draftName?.trim() || null,
            ...(input.catalogCost !== undefined ? { cost: input.catalogCost } : {}),
            status: "active",
          }).onConflictDoUpdate({
            target: socialGiftCatalogSettings.giftId,
            set: {
              displayName: input.settings.draftName?.trim() || null,
              ...(input.catalogCost !== undefined ? { cost: input.catalogCost } : {}),
              status: "active",
              updatedAt: new Date(),
            },
          });
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
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(giftStudioAssets)
      .set({ settings: { ...asset.settings, draftName: trimmed } })
      .where(and(eq(giftStudioAssets.id, versionId), eq(giftStudioAssets.ownerId, ownerId)))
      .returning();
    if (row?.status === "active" && row.giftId) {
      await tx.insert(socialGiftCatalogSettings).values({
        giftId: row.giftId,
        displayName: trimmed,
      }).onConflictDoUpdate({
        target: socialGiftCatalogSettings.giftId,
        set: { displayName: trimmed, updatedAt: new Date() },
      });
    }
    return row;
  });
  if (!updated) throw new RoomError(404, "Saved gift not found.");
  return toVersion(updated);
}

export { updateGiftCatalogItem };

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

