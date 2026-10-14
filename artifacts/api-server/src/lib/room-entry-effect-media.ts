import { Storage } from "@google-cloud/storage";
import type { Request, Response } from "express";
import { RoomError } from "./room-store";

const mediaTypes: Record<string, string> = {
  "animation.webp": "image/webp",
  "animation.webm": "video/webm",
};
const tierMediaTypes: Record<string, string> = {
  "animation.webp": "image/webp",
  "animation.webm": "video/webm",
};
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function objectFile(folder: string, filename: string, allowedMediaTypes: Record<string, string>) {
  if (!Object.hasOwn(allowedMediaTypes, filename)) throw new RoomError(404, "Room effect media not found");
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Room effect media storage is unavailable");
  const prefix = match[2]!.replace(/\/$/, "");
  return storage.bucket(match[1]!).file(`${prefix}/${folder}/${filename}`);
}

function getLionFile(filename: string) {
  return objectFile("room-effects/lion-entrance/v3", filename, mediaTypes);
}

function getTierFile(tier: string, filename: string) {
  if (!["2", "3", "4"].includes(tier)) throw new RoomError(404, "Room effect media not found");
  return objectFile(`room-effects/monthly-credit-tiers/tier${tier}/v2`, filename, tierMediaTypes);
}

async function serveMedia(req: Request, res: Response, file: ReturnType<typeof getLionFile>, contentType: string) {
  const [exists] = await file.exists();
  if (!exists) throw new RoomError(404, "Room effect media not found");
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  res.set({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0;
  let end = size - 1;
  const range = req.get("Range");
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parsed || (!parsed[1] && !parsed[2])) {
      res.set("Content-Range", `bytes */${size}`).status(416).end();
      return;
    }
    start = parsed[1] ? Number(parsed[1]) : Math.max(0, size - Number(parsed[2]));
    end = parsed[1] && parsed[2] ? Math.min(size - 1, Number(parsed[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.set("Content-Range", `bytes */${size}`).status(416).end();
      return;
    }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.set("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = file.createReadStream({ start, end });
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy()).pipe(res);
}

/** Serves only the fixed, non-personal Lion effect asset set from App Storage. */
export async function serveRoomEntranceEffectMedia(req: Request, res: Response): Promise<void> {
  const filename = String(req.params.filename);
  await serveMedia(req, res, getLionFile(filename), mediaTypes[filename]!);
}

/** Serves only the allow-listed transparent tier effects from App Storage. */
export async function serveMonthlyCreditTierEntranceEffectMedia(req: Request, res: Response): Promise<void> {
  const tier = String(req.params.tier);
  const filename = String(req.params.filename);
  await serveMedia(req, res, getTierFile(tier, filename), tierMediaTypes[filename]!);
}
