import { Storage } from "@google-cloud/storage";
import type { Request, Response } from "express";
import { RoomError } from "./room-store";

const mediaTypes: Record<string, string> = {
  "animation.webp": "image/webp",
  "poster.png": "image/png",
  "audio.m4a": "audio/mp4",
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

function getFile(filename: string) {
  if (!Object.hasOwn(mediaTypes, filename)) throw new RoomError(404, "Room effect media not found");
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Room effect media storage is unavailable");
  const prefix = match[2]!.replace(/\/$/, "");
  return storage.bucket(match[1]!).file(`${prefix}/room-effects/lion-entrance/v1/${filename}`);
}

/** Serves only the fixed, non-personal room effect asset set from App Storage. */
export async function serveRoomEntranceEffectMedia(req: Request, res: Response): Promise<void> {
  const filename = String(req.params.filename);
  const file = getFile(filename);
  const [exists] = await file.exists();
  if (!exists) throw new RoomError(404, "Room effect media not found");
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  res.set({
    "Content-Type": mediaTypes[filename]!,
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
