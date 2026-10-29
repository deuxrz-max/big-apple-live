import { Storage } from "@google-cloud/storage";
import type { Request, Response } from "express";

export const NYC_BACKGROUND_VIDEO_IDS = [
  "nyc-01", "nyc-02", "nyc-03", "nyc-04", "nyc-05", "nyc-06",
] as const;
export type NycBackgroundVideoId = typeof NYC_BACKGROUND_VIDEO_IDS[number];

const OBJECT_PREFIX = "system/nyc-backgrounds/v1";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function objectFile(id: string) {
  if (!NYC_BACKGROUND_VIDEO_IDS.includes(id as NycBackgroundVideoId)) return null;
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new Error("Background video storage is unavailable");
  return storage.bucket(match[1]!).file(`${match[2]!.replace(/\/$/, "")}/${OBJECT_PREFIX}/${id}.mp4`);
}

export function parseNycBackgroundByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | false {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || start > end || start >= size) return false;
  return { start, end: Math.min(size - 1, end) };
}

export async function serveNycBackgroundVideo(req: Request, res: Response) {
  try {
    const file = objectFile(String(req.params.id));
    if (!file) return res.status(404).end();
    const [exists] = await file.exists();
    if (!exists) return res.status(404).end();
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(404).end();

    const range = parseNycBackgroundByteRange(req.get("Range") ?? null, size);
    if (range === false) {
      return res.set("Content-Range", `bytes */${size}`).status(416).end();
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    res.set({
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Range",
      "Content-Length": String(end - start + 1),
    });
    if (range) {
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    if (req.method === "HEAD") return res.end();

    const stream = file.createReadStream({ start, end });
    let clientDisconnected = false;
    res.on("close", () => {
      if (res.writableFinished) return;
      clientDisconnected = true;
      stream.unpipe(res);
      stream.resume();
    });
    stream.on("error", () => {
      if (clientDisconnected || res.destroyed) return;
      res.destroy();
    });
    return stream.pipe(res);
  } catch {
    return res.status(503).end();
  }
}

/** One-time import helper for the six supplied, allowlisted project assets. */
export async function uploadNycBackgroundVideo(id: NycBackgroundVideoId, localPath: string) {
  const file = objectFile(id);
  if (!file) throw new Error("Unknown NYC background slot");
  await file.bucket.upload(localPath, {
    destination: file.name,
    resumable: false,
    metadata: {
      contentType: "video/mp4",
      cacheControl: "public, max-age=3600",
      metadata: { assetId: id },
    },
  });
}
