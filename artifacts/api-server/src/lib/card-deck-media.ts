import { Storage } from "@google-cloud/storage";
import type { Request, Response } from "express";
import { RoomError } from "./room-store";
import { streamGcsObject } from "./gcs-response-stream";
import { CARD_DECK_FILENAMES, CARD_DECK_MEDIA_VERSION } from "./card-deck-manifest";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});

/** Only this public artwork allowlist is served, never arbitrary storage paths. */
export function cardDeckFile(filename: string) {
  if (!CARD_DECK_FILENAMES.includes(filename)) throw new RoomError(404, "Card artwork not found");
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Card artwork storage is unavailable");
  return storage.bucket(match[1]!).file(
    `${match[2]!.replace(/\/$/, "")}/card-decks/${CARD_DECK_MEDIA_VERSION}/${filename}`);
}

export async function serveCardDeckFace(req: Request, res: Response) {
  const file = cardDeckFile(String(req.params.filename));
  const [exists] = await file.exists();
  if (!exists) throw new RoomError(404, "Card artwork not found");
  res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff" });
  streamGcsObject(file.createReadStream(), res, "Card deck artwork", 503);
}
