import { Storage } from "@google-cloud/storage";
import { RoomError } from "./room-store";

const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});
export const PINK_MEDIA = {
  card: { filename: "home-card.png", type: "image/png" },
} as const;
export type PinkMediaVariant = keyof typeof PINK_MEDIA;
export function pinkRewardMediaFile(variant: PinkMediaVariant) {
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? "");
  if (!match) throw new RoomError(503, "Reward media storage is unavailable");
  return storage.bucket(match[1]!).file(`${match[2]!.replace(/\/$/, "")}/system/pink-rewards/v1/${PINK_MEDIA[variant].filename}`);
}
