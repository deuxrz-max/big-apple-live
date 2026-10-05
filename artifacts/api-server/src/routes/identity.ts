import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  SaveMyProfileBody, SaveMyProfileResponse, GetMyProfileResponse, GetEmojiImageParams,
  CreateAccountRoomResponse, JoinAccountRoomParams, JoinAccountRoomResponse,
  CreateAccountRoomBody,
} from "@workspace/api-zod";
import { getProfile, saveProfile } from "../lib/account-profiles";
import { emojiCatalog, coloredEmoji } from "../lib/emoji-library";
import { roomStore, RoomError } from "../lib/room-store";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();
export function accountId(req: Request): string {
  const auth = getAuth(req);
  const id = auth?.userId;
  if (!id) throw new RoomError(401, "Sign in to use your saved identity");
  return id;
}
export function sameOrigin(req: Request): void {
  const origin = req.get("origin");
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { throw new RoomError(403, "Invalid request origin"); }
    if (host !== getClerkProxyHost(req)) throw new RoomError(403, "Cross-origin account changes are not allowed");
  }
}
router.get("/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetMyProfileResponse.parse({ profile: await getProfile(accountId(req)) }));
});
router.put("/me", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const body = SaveMyProfileBody.safeParse(req.body);
  if (!body.success) throw new RoomError(400, "Use a 3–24 character name, a library emoji, Male or Female, and valid six-digit hex colors");
  res.set("Cache-Control", "no-store");
  res.json(SaveMyProfileResponse.parse(await saveProfile(id, body.data)));
});
router.get("/emojis", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json(emojiCatalog);
});
router.get("/emojis/:emojiId/:color/image", (req, res) => {
  const params = GetEmojiImageParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid emoji or hex color");
  res.set({
    "Cache-Control": "public, max-age=86400",
    "Content-Type": "image/svg+xml",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(coloredEmoji(params.data.emojiId, params.data.color));
});
router.post("/account/rooms", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const profile = await getProfile(id);
  if (!profile) throw new RoomError(409, "Choose your dedicated name and emoji first");
  const beam = req.body === undefined ? undefined : CreateAccountRoomBody.safeParse(req.body);
  if (beam && !beam.success) throw new RoomError(400, "Choose a name and 2, 4, 9, or 12 spots");
  res.status(201).json(CreateAccountRoomResponse.parse(
    roomStore.create(profile.username, { accountId: id, identity: profile.identity }, beam?.success ? beam.data : undefined),
  ));
});
router.post("/account/rooms/:roomId/join", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinAccountRoomParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid room ID");
  const profile = await getProfile(id);
  if (!profile) throw new RoomError(409, "Choose your dedicated name and emoji first");
  res.status(201).json(JoinAccountRoomResponse.parse(
    roomStore.join(params.data.roomId, profile.username, { accountId: id, identity: profile.identity }),
  ));
});
export default router;