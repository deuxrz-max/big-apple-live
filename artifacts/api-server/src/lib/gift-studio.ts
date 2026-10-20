import { Storage } from "@google-cloud/storage";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { db, giftStudioAssets, socialGiftCatalogSettings, socialSettings, type GiftStudioAsset } from "@workspace/db";
import type { GiftStudioGiftId, GiftStudioProcessingSettings, GiftStudioVersion } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { RoomError } from "./room-store";
import {
  getGiftCatalogItem,
  giftNameFromSettings,
  listGiftCatalogForOwner,
  updateGiftCatalogItem as updateGiftCatalogRecord,
  type GiftStudioProductType,
} from "./gift-studio-catalog";

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
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
export type GiftStudioIconStatus = "transparent" | "fallback" | "manual-transparent" | "manual-fallback";
type GiftStudioBackgroundMode = "see-through" | "black";

function getBackgroundMode(settings: Pick<GiftStudioProcessingSettings, "backgroundMode">): GiftStudioBackgroundMode {
  return settings.backgroundMode === "black" ? "black" : "see-through";
}

function storageFile(id: string, variant: GiftStudioMediaVariant | "icon", extension?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RoomError(404, "Gift media not found");
  const names: Record<GiftStudioMediaVariant | "icon", string> = {
    original: `source.${extension === "mov" ? "mov" : extension === "webm" ? "webm" : "mp4"}`,
    webm: "animation.webm",
    safari: "animation.png",
    icon: "icon.png",
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
    settings: {
      ...row.settings,
      backgroundMode: getBackgroundMode(row.settings as unknown as GiftStudioProcessingSettings),
    } as unknown as GiftStudioProcessingSettings,
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
  return { type, durationMs: Math.round(duration * 1000), codecName: video.codec_name ?? "" };
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

async function createSafariFallback(webmPath: string, outputPath: string, backgroundMode: GiftStudioBackgroundMode) {
  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-c:v", "libvpx-vp9", "-i", webmPath,
      "-vf", "fps=12,scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=rgba",
      "-an", "-vsync", "0", "-plays", "1", "-c:v", "apng", "-f", "apng", outputPath,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(outputPath);
    if (!stat.size || stat.size > MAX_VIDEO_BYTES) throw new Error("Fallback file size is outside the allowed range");
    if (backgroundMode === "see-through") await verifyAlpha(outputPath);
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(422, "The iPhone playback version could not be created. Nothing was added.");
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

async function snapshotVideoFrame(videoPath: string, outputPath: string, durationMs: number, preserveVp9Alpha: boolean) {
  const seek = Math.max(0, Math.min(durationMs / 1000 * 0.35, Math.max(0, durationMs / 1000 - 0.12)));
  await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...(preserveVp9Alpha ? ["-c:v", "libvpx-vp9"] : []),
    "-ss", String(seek), "-i", videoPath,
    "-frames:v", "1",
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=rgba",
    "-an", "-update", "1", outputPath,
  ], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
}

async function hasUsefulPngAlpha(filePath: string | Buffer): Promise<boolean> {
  const { data, info } = await sharp(filePath).ensureAlpha().resize(128, 128, { fit: "inside" })
    .raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length < 4) return false;
  let transparent = 0;
  let visible = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 32) transparent++;
    if (data[i]! > 200) visible++;
  }
  const pixels = info.width * info.height;
  return pixels > 0 && transparent / pixels >= 0.01 && visible / pixels >= 0.03;
}

export async function removeBlackBackgroundFromIcon(filePath: string) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error("The gift icon could not be decoded as RGBA.");
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const brightest = Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!);
    const t = Math.max(0, Math.min(1, (brightest - 5) / 50));
    const matte = t * t * (3 - 2 * t);
    data[offset + 3] = Math.round(data[offset + 3]! * matte);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 8 })
    .toFile(filePath);
}

async function createGiftIcon(
  processedWebmPath: string,
  fallbackSourcePath: string,
  outputPath: string,
  durationMs: number,
  backgroundMode: GiftStudioBackgroundMode,
): Promise<GiftStudioIconStatus> {
  if (backgroundMode === "black") {
    for (const [source, preserveVp9Alpha] of [[processedWebmPath, true], [fallbackSourcePath, false]] as const) {
      try {
        await fs.rm(outputPath, { force: true });
        await snapshotVideoFrame(source, outputPath, durationMs, preserveVp9Alpha);
        await removeBlackBackgroundFromIcon(outputPath);
        if (await hasUsefulPngAlpha(outputPath)) return "transparent";
      } catch {
        // Try the other source before using a neutral placeholder.
      }
    }
    const placeholder = Buffer.from(
      '<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#392060"/><stop offset="1" stop-color="#a22b83"/></linearGradient></defs><rect width="512" height="512" rx="72" fill="url(#g)"/><text x="256" y="278" text-anchor="middle" fill="white" font-family="sans-serif" font-size="56" font-weight="700">GIFT</text></svg>',
    );
    await sharp(placeholder).png().toFile(outputPath);
    return "fallback";
  }
  try {
    await snapshotVideoFrame(processedWebmPath, outputPath, durationMs, true);
    if (await hasUsefulPngAlpha(outputPath)) return "transparent";
  } catch {
    // A broken alpha decode falls through to the plain source snapshot.
  }
  try {
    await fs.rm(outputPath, { force: true });
    await snapshotVideoFrame(fallbackSourcePath, outputPath, durationMs, false);
    await sharp(outputPath).metadata();
    return "fallback";
  } catch {
    // Saving the gift should not fail because its optional icon could not be decoded.
    const placeholder = Buffer.from(
      '<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#392060"/><stop offset="1" stop-color="#a22b83"/></linearGradient></defs><rect width="512" height="512" rx="72" fill="url(#g)"/><text x="256" y="278" text-anchor="middle" fill="white" font-family="sans-serif" font-size="56" font-weight="700">GIFT</text></svg>',
    );
    await sharp(placeholder).png().toFile(outputPath);
    return "fallback";
  }
}

async function deleteAssets(id: string, extension: string) {
  await Promise.all([
    storageFile(id, "original", extension).delete({ ignoreNotFound: true }),
    storageFile(id, "webm").delete({ ignoreNotFound: true }),
    storageFile(id, "safari").delete({ ignoreNotFound: true }),
    storageFile(id, "icon").delete({ ignoreNotFound: true }),
  ]);
}

async function deleteGiftCatalogIcons(giftId: string) {
  const activeAssets = await db.select({ id: giftStudioAssets.id })
    .from(giftStudioAssets)
    .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active")));
  const results = await Promise.allSettled(activeAssets.map(({ id }) =>
    storageFile(id, "icon").delete({ ignoreNotFound: true })));
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("A deleted gift's optional icon could not be removed from storage.", result.reason);
    }
  }
}

export async function updateGiftCatalogItem(input: Parameters<typeof updateGiftCatalogRecord>[0]) {
  const updated = await updateGiftCatalogRecord(input);
  if (input.status === "deleted") await deleteGiftCatalogIcons(input.giftId);
  return updated;
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
  const sourceInfo = await validateSource(input.sourcePath, input.sourceBytes, input.sourceName);
  const outputPath = path.join(path.dirname(input.sourcePath), `processed-${randomUUID()}.webm`);
  const workPath = path.join(path.dirname(input.sourcePath), `frames-${randomUUID()}`);
  const sourceFrames = path.join(workPath, "source");
  const keyedFrames = path.join(workPath, "keyed");
  const boundedDimension = Math.min(input.settings.maxDimension ?? 480, 480);

  try {
    if (getBackgroundMode(input.settings) === "black" || input.settings.retainOpaqueBackground) {
      await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", input.sourcePath,
        "-vf", `fps=24,scale='if(gte(iw,ih),min(iw,${boundedDimension}),-2)':'if(gte(iw,ih),-2,min(ih,${boundedDimension}))':flags=lanczos,crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        "-an", "-t", "15", "-vsync", "0",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
        "-b:v", "0", "-crf", "30", "-deadline", "realtime", "-cpu-used", "5",
        outputPath,
      ], {
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const stat = await fs.stat(outputPath);
      if (!stat.size || stat.size > MAX_VIDEO_BYTES) {
        throw new RoomError(413, "The black-background result is too large. Use a shorter clip.");
      }
      const encoded = await probe(outputPath);
      const video = encoded.streams?.find((stream) => stream.codec_type === "video");
      if (!video || video.codec_name !== "vp9" || video.pix_fmt?.includes("a") ||
        (encoded.streams ?? []).some((stream) => stream.codec_type === "audio")) {
        throw new RoomError(422, "The black-background result must be a silent, opaque VP9 WebM.");
      }
      return { path: outputPath, bytes: stat.size };
    }
    await fs.mkdir(sourceFrames, { recursive: true });
    await fs.mkdir(keyedFrames, { recursive: true });
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      ...(input.settings.preserveSourceAlpha && ["vp8", "vp9"].includes(sourceInfo.codecName)
        ? ["-c:v", sourceInfo.codecName === "vp9" ? "libvpx-vp9" : "libvpx"] : []),
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
      if (!input.settings.preserveSourceAlpha) applyGiftStudioKey(data, input.settings);
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
      throw new RoomError(413, getBackgroundMode(input.settings) === "black"
        ? "The black-background result is too large. Use a shorter clip."
        : "The transparent result is too large. Use a shorter clip.");
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
    throw new RoomError(422, getBackgroundMode(input.settings) === "black"
      ? "Server processing could not encode this black-background clip. Try a shorter source video."
      : "Server processing could not encode and verify this clip. Try another key color or a shorter source video.");
  } finally {
    await fs.rm(workPath, { recursive: true, force: true });
  }
}

export async function createGiftStudioVersion(input: {
  ownerId: string;
  giftId: string | null;
  productType?: GiftStudioProductType;
  catalogCost?: number;
  settings: GiftStudioProcessingSettings;
  originalPath: string;
  originalName: string;
  originalBytes: number;
  processedWebmPath: string;
  processedWebmBytes: number;
}) {
  const backgroundMode = getBackgroundMode(input.settings);
  const savedSettings = { ...input.settings, backgroundMode };
  if (input.processedWebmBytes <= 0 || input.processedWebmBytes > MAX_VIDEO_BYTES) {
    throw new RoomError(413, "The processed animation must be 100 MB or smaller.");
  }
  const source = await validateSource(input.originalPath, input.originalBytes, input.originalName);
  const catalogItem = input.giftId ? await getGiftCatalogItem(input.giftId) : null;
  if (input.giftId && (!catalogItem || catalogItem.status === "deleted")) {
    throw new RoomError(404, "Choose an available catalog item.");
  }
  const productType = input.productType ?? catalogItem?.productType ?? input.settings.productType ?? "gift";
  if (catalogItem && input.productType && catalogItem.productType !== input.productType) {
    throw new RoomError(400, "The selected item must match the chosen production type.");
  }
  if (await sniffVideo(input.processedWebmPath) !== "webm") {
    throw new RoomError(415, "The processed animation must be a WebM video.");
  }
  const processed = await probe(input.processedWebmPath);
  const video = processed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(processed.format?.duration);
  if (!video || video.codec_name !== "vp9" || (processed.streams ?? []).some((stream) => stream.codec_type === "audio") ||
    !Number.isFinite(duration) || duration <= 0 || duration > 15.05 ||
    !((processed.format?.format_name ?? "").includes("webm") || (processed.format?.format_name ?? "").includes("matroska"))) {
    throw new RoomError(422, "The processed file must be a silent VP9 WebM animation up to 15 seconds long.");
  }
  if (backgroundMode === "see-through" && !input.settings.retainOpaqueBackground) {
    await verifyAlpha(input.processedWebmPath, "libvpx-vp9");
  } else if (!video.pix_fmt || video.pix_fmt.includes("a")) {
    throw new RoomError(422, "Black-background videos must be opaque; choose See-through video for clips with transparency.");
  }

  const temp = await fs.mkdtemp(path.join(tmpdir(), "streamtalk-gift-studio-"));
  const fallbackPath = path.join(temp, "animation.png");
  const iconPath = path.join(temp, "gift-icon.png");
  const id = randomUUID();
  const safeName = input.originalName.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120)
    || `source.${source.type}`;
  try {
    await createSafariFallback(input.processedWebmPath, fallbackPath, input.settings.retainOpaqueBackground ? "black" : backgroundMode);
    const iconStatus = await createGiftIcon(input.processedWebmPath, input.originalPath, iconPath, source.durationMs, backgroundMode);
    const fallbackBytes = (await fs.stat(fallbackPath)).size;
    const objects = [
      storageFile(id, "original", source.type),
      storageFile(id, "webm"),
      storageFile(id, "safari"),
      storageFile(id, "icon"),
    ];
    const mime = source.type === "webm" ? "video/webm" : source.type === "mov" ? "video/quicktime" : "video/mp4";
    try {
      const uploaded = await Promise.allSettled([
        uploadFile(input.originalPath, objects[0]!, mime),
        uploadFile(input.processedWebmPath, objects[1]!, "video/webm"),
        uploadFile(fallbackPath, objects[2]!, "image/png"),
        uploadFile(iconPath, objects[3]!, "image/png"),
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
            productType,
            ...(input.catalogCost !== undefined ? { cost: input.catalogCost } : {}),
            status: "active",
          }).onConflictDoUpdate({
            target: socialGiftCatalogSettings.giftId,
            set: {
              displayName: input.settings.draftName?.trim() || null,
              productType,
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
          safariBytes: fallbackBytes,
          settings: { ...savedSettings, productType, iconStatus, iconRevision: 1 },
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

export async function deleteGiftStudioVersion(ownerId: string, versionId: string) {
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Saved gift not found.");
  await deleteAssets(asset.id, asset.originalExtension);
  const [deleted] = await db.delete(giftStudioAssets).where(and(
    eq(giftStudioAssets.id, versionId),
    eq(giftStudioAssets.ownerId, ownerId),
  )).returning({ id: giftStudioAssets.id });
  if (!deleted) throw new RoomError(404, "Saved gift not found.");
  if (asset.giftId?.startsWith("studio-") && asset.status === "active") {
    const [stillActive] = await db.select({ id: giftStudioAssets.id })
      .from(giftStudioAssets)
      .where(and(eq(giftStudioAssets.giftId, asset.giftId), eq(giftStudioAssets.status, "active")))
      .limit(1);
    if (!stillActive) {
      await db.update(socialGiftCatalogSettings)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(socialGiftCatalogSettings.giftId, asset.giftId));
      await db.update(socialSettings)
        .set({ equippedEntranceEffectId: null })
        .where(eq(socialSettings.equippedEntranceEffectId, asset.giftId));
    }
  }
  return { deleted: true as const };
}

export async function assignGiftStudioVersionToGift(ownerId: string, versionId: string, giftId: GiftStudioGiftId) {
  const catalogItem = await getGiftCatalogItem(giftId);
  if (!catalogItem || catalogItem.status === "deleted") throw new RoomError(400, "Choose an existing catalog item.");
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

export async function setGiftStudioVersionActive(
  ownerId: string,
  versionId: string,
  active: boolean,
  options?: { productType?: GiftStudioProductType; cost?: number },
) {
  const [asset] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, versionId));
  if (!asset || asset.ownerId !== ownerId) throw new RoomError(404, "Gift animation version not found.");
  if (active && !asset.giftId && (!options?.productType || !options.cost || !Number.isSafeInteger(options.cost) || options.cost < 1)) {
    throw new RoomError(400, "Choose Gift or Entrance effect and a whole positive coin price before activating this new item.");
  }
  const giftId = asset.giftId ?? (active ? `studio-${asset.id}` : null);
  const productType = options?.productType ?? (asset.settings as Record<string, unknown>).productType as GiftStudioProductType ?? "gift";
  if (active) await ensureGiftStudioIcon(asset);
  const row = await db.transaction(async (tx) => {
    if (active && !asset.giftId && giftId) {
      await tx.insert(socialGiftCatalogSettings).values({
        giftId,
        displayName: giftNameFromSettings(asset.settings, giftId),
        cost: options!.cost!,
        productType,
        status: "active",
      }).onConflictDoNothing();
    }
    if (active && giftId) {
      await tx.update(giftStudioAssets).set({ status: "draft", activatedAt: null }).where(and(
        eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"),
      ));
    }
    const [updated] = await tx.update(giftStudioAssets)
      .set({
        giftId,
        settings: { ...asset.settings, ...(options?.productType ? { productType: options.productType } : {}) },
        status: active ? "active" : "draft",
        activatedAt: active ? new Date() : null,
      })
      .where(and(eq(giftStudioAssets.id, versionId), eq(giftStudioAssets.ownerId, ownerId)))
      .returning();
    if (active && asset.giftId) {
      await tx.insert(socialGiftCatalogSettings).values({
        giftId: asset.giftId,
        productType,
        status: "active",
        ...(options?.cost !== undefined ? { cost: options.cost } : {}),
      }).onConflictDoUpdate({
        target: socialGiftCatalogSettings.giftId,
        set: {
          productType,
          status: "active",
          ...(options?.cost !== undefined ? { cost: options.cost } : {}),
          updatedAt: new Date(),
        },
      });
    }
    if (!active && asset.status === "active" && asset.giftId?.startsWith("studio-")) {
      const [stillActive] = await tx.select({ id: giftStudioAssets.id })
        .from(giftStudioAssets)
        .where(and(eq(giftStudioAssets.giftId, asset.giftId), eq(giftStudioAssets.status, "active")))
        .limit(1);
      if (!stillActive) {
        await tx.update(socialGiftCatalogSettings)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(eq(socialGiftCatalogSettings.giftId, asset.giftId));
        await tx.update(socialSettings)
          .set({ equippedEntranceEffectId: null })
          .where(eq(socialSettings.equippedEntranceEffectId, asset.giftId));
      }
    }
    return updated;
  });
  if (!row) throw new RoomError(404, "Gift animation version not found.");
  return toVersion(row);
}

export async function getActiveGiftStudioMedia(giftId: string) {
  const [row] = await db.select().from(giftStudioAssets)
    .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"))).limit(1);
  if (!row) return { media: null };
  return { media: {
    versionId: row.id,
    name: giftNameFromSettings(row.settings, giftId),
    webmUrl: mediaUrl(row.id, "webm", false),
    safariUrl: mediaUrl(row.id, "safari", false),
    durationMs: row.durationMs,
    backgroundMode: getBackgroundMode(row.settings as unknown as GiftStudioProcessingSettings),
  } };
}

async function activeOwnedGiftAsset(ownerId: string, giftId: string) {
  const [row] = await db.select().from(giftStudioAssets)
    .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"), eq(giftStudioAssets.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new RoomError(404, "No active saved animation exists for this catalog item.");
  return row;
}

async function saveGiftIconForAsset(asset: GiftStudioAsset, sourcePath: string, processedPath: string, bumpRevision = true) {
  const temp = await fs.mkdtemp(path.join(tmpdir(), "gift-studio-icon-"));
  const iconPath = path.join(temp, "icon.png");
  try {
    const settings = asset.settings as unknown as GiftStudioProcessingSettings;
    const iconStatus = await createGiftIcon(processedPath, sourcePath, iconPath, asset.durationMs, getBackgroundMode(settings));
    await uploadFile(iconPath, storageFile(asset.id, "icon"), "image/png");
    const savedSettings = asset.settings as Record<string, unknown>;
    const [updated] = await db.update(giftStudioAssets)
      .set({ settings: {
        ...savedSettings,
        iconStatus,
        iconRevision: bumpRevision ? Number(savedSettings.iconRevision ?? 0) + 1 : Number(savedSettings.iconRevision ?? 1),
      } })
      .where(and(eq(giftStudioAssets.id, asset.id), eq(giftStudioAssets.ownerId, asset.ownerId)))
      .returning();
    return { asset: updated ?? asset, iconStatus };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function ensureGiftStudioIcon(asset: GiftStudioAsset) {
  const icon = storageFile(asset.id, "icon");
  const [exists] = await icon.exists();
  if (exists) return;
  const temp = await fs.mkdtemp(path.join(tmpdir(), "gift-studio-icon-source-"));
  const webmPath = path.join(temp, "animation.webm");
  const sourcePath = path.join(temp, `source.${asset.originalExtension}`);
  try {
    await Promise.all([
      storageFile(asset.id, "webm").download({ destination: webmPath }),
      storageFile(asset.id, "original", asset.originalExtension).download({ destination: sourcePath }),
    ]);
    await saveGiftIconForAsset(asset, sourcePath, webmPath, false);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function regenerateGiftStudioIcon(ownerId: string, giftId: string) {
  const asset = await activeOwnedGiftAsset(ownerId, giftId);
  const temp = await fs.mkdtemp(path.join(tmpdir(), "gift-studio-icon-regenerate-"));
  const webmPath = path.join(temp, "animation.webm");
  const sourcePath = path.join(temp, `source.${asset.originalExtension}`);
  try {
    await Promise.all([
      storageFile(asset.id, "webm").download({ destination: webmPath }),
      storageFile(asset.id, "original", asset.originalExtension).download({ destination: sourcePath }),
    ]);
    const result = await saveGiftIconForAsset(asset, sourcePath, webmPath);
    return {
      giftId,
      iconStatus: result.iconStatus,
      iconUrl: `/api/social/gift-studio/icons/${asset.id}?v=${encodeURIComponent(String((result.asset?.settings as Record<string, unknown> | undefined)?.iconRevision ?? 1))}`,
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function overrideGiftStudioIcon(ownerId: string, giftId: string, png: Buffer) {
  if (!png.length || png.length > 5 * 1024 * 1024) throw new RoomError(413, "Choose a PNG icon no larger than 5 MB.");
  let metadata;
  try {
    metadata = await sharp(png).metadata();
  } catch {
    throw new RoomError(415, "The icon must be a valid PNG image.");
  }
  if (metadata.format !== "png" || !metadata.width || !metadata.height || metadata.width > 2048 || metadata.height > 2048) {
    throw new RoomError(415, "The icon must be a PNG no larger than 2048 by 2048 pixels.");
  }
  const asset = await activeOwnedGiftAsset(ownerId, giftId);
  const iconStatus: GiftStudioIconStatus = await hasUsefulPngAlpha(png) ? "manual-transparent" : "manual-fallback";
  const revision = Number((asset.settings as Record<string, unknown>).iconRevision ?? 0) + 1;
  const normalized = await sharp(png).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const temp = await fs.mkdtemp(path.join(tmpdir(), "gift-studio-icon-override-"));
  const iconPath = path.join(temp, "icon.png");
  try {
    await fs.writeFile(iconPath, normalized);
    await uploadFile(iconPath, storageFile(asset.id, "icon"), "image/png");
    await db.update(giftStudioAssets)
      .set({ settings: { ...(asset.settings as Record<string, unknown>), iconStatus, iconRevision: revision } })
      .where(and(eq(giftStudioAssets.id, asset.id), eq(giftStudioAssets.ownerId, ownerId)));
    return {
      giftId,
      iconStatus,
      iconUrl: `/api/social/gift-studio/icons/${asset.id}?v=${encodeURIComponent(String(revision))}`,
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function giftStudioIconFile(input: { versionId: string; ownerId?: string; activeOnly?: boolean }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.versionId)) throw new RoomError(404, "Gift icon not found.");
  const [row] = await db.select().from(giftStudioAssets).where(eq(giftStudioAssets.id, input.versionId)).limit(1);
  if (!row || (input.ownerId && row.ownerId !== input.ownerId) ||
    (input.activeOnly && row.status !== "active") || (!input.activeOnly && !input.ownerId)) {
    throw new RoomError(404, "Gift icon not found.");
  }
  const catalogItem = row.giftId ? await getGiftCatalogItem(row.giftId) : null;
  if (catalogItem?.status === "deleted"
    || (input.activeOnly && row.giftId && catalogItem?.status !== "active")) {
    throw new RoomError(404, "Gift icon not found.");
  }
  const file = storageFile(row.id, "icon");
  let [exists] = await file.exists();
  if (!exists && row.status === "active") {
    await ensureGiftStudioIcon(row);
    [exists] = await file.exists();
  }
  if (!exists) throw new RoomError(404, "Gift icon not found.");
  return { file };
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

