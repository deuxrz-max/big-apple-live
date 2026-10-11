import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  SaveMyProfileBody, SaveMyProfileResponse, GetMyProfileResponse,
  CreateAccountRoomResponse, JoinAccountRoomParams, JoinAccountRoomResponse,
  CreateAccountRoomBody,
} from "@workspace/api-zod";
import { getProfile, saveProfile, requireCompletedProfile } from "../lib/account-profiles";
import { recordDailyLogin } from '../lib/social/marathon';
import { roomStore, RoomError } from "../lib/room-store";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { communityMembership, accessFor, offerOverflow } from "../lib/community";
import { giftNameColorsForAccounts } from "../lib/social/gift-name-color-data";
import { universityAudioBeamStore } from "../lib/university-audio-beam";
import { coloredEmoji } from "../lib/emoji-library";

const router: IRouter = Router();
router.get("/emojis/:emojiId/:color/image", (req, res): void => {
  const emojiId = Array.isArray(req.params.emojiId) ? req.params.emojiId[0] ?? "" : req.params.emojiId;
  const color = Array.isArray(req.params.color) ? req.params.color[0] ?? "" : req.params.color;
  res
    .set("Cache-Control", "public, max-age=86400")
    .type("image/svg+xml")
    .send(coloredEmoji(emojiId, color));
});

export function accountId(req: Request): string {
  const auth = getAuth(req);
  const id = auth?.userId;
  if (!id) throw new RoomError(401, "Sign in to use your profile");
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
  const id = accountId(req);
  const profile = await getProfile(id);
  if (profile) await recordDailyLogin(id);
  res.json(GetMyProfileResponse.parse({ profile }));
});
router.put("/me", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  if (Array.isArray(req.body?.photoUrls) && req.body.photoUrls.length > 4)
    throw new RoomError(400, "Keep up to 4 profile photos. Remove or replace a photo first");
  const body = SaveMyProfileBody.safeParse(req.body);
  if (!body.success || Object.keys(req.body ?? {}).some(key => !["username", "displayName", "bio", "photoUrl", "photoUrls"].includes(key)))
    throw new RoomError(400, "Use a valid username, display name, photo and short bio; account ownership is set by the server");
  res.set("Cache-Control", "no-store");
  res.json(SaveMyProfileResponse.parse(await saveProfile(id, body.data)));
});
router.post("/account/rooms", async (req, res) => {
  throw new RoomError(410, "Broadcasting is disabled. Choose a university from the Directory.");
  /* Retained legacy creation logic for rollback, not exposed in active UX.
  sameOrigin(req);
  const id = accountId(req);
  const profile = await requireCompletedProfile(id);
  const beam = req.body === undefined ? undefined : CreateAccountRoomBody.safeParse(req.body);
  if (beam && !beam.success) throw new RoomError(400, "Choose a name and 2, 4, 9, or 12 spots");
  res.status(201).json(CreateAccountRoomResponse.parse(
    roomStore.create(profile.username, { accountId: id, identity: profile.identity }, beam?.success ? beam.data : undefined),
  ));
  */
});
router.post("/account/rooms/:roomId/join", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinAccountRoomParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid university ID");
  if (!roomStore.isCommunity(params.data.roomId)) throw new RoomError(410, "This legacy Beam is archived. Choose a university from the Directory.");
  universityAudioBeamStore.assertCanJoin(params.data.roomId, id);
  const profile = await requireCompletedProfile(id);
  const access = await accessFor(id);
  if (!roomStore.hasUniversitySeat(params.data.roomId, id, access.moderator)) {
    const overflow = await offerOverflow(params.data.roomId, id);
    res.status(409).json({ error: `${roomStore.get(params.data.roomId).name} is full — try ${overflow.label}`, overflow });
    return;
  }
  const member = await communityMembership(params.data.roomId, id);
  // No await between the final seat check and join; competing joins cannot oversubscribe.
  if (!roomStore.hasUniversitySeat(params.data.roomId, id, access.moderator)) {
    const overflow = await offerOverflow(params.data.roomId, id);
    res.status(409).json({ error: `${roomStore.get(params.data.roomId).name} is full — try ${overflow.label}`, overflow });
    return;
  }
  const nameColors = await giftNameColorsForAccounts([id]);
  const session = roomStore.join(params.data.roomId, profile.displayName ?? profile.username, {
    accountId: id, identity: profile.identity, capExempt: access.moderator,
    displayNameColor: nameColors.get(id) ?? "#FFFFFF",
  });
  roomStore.restoreParticipantId(params.data.roomId, id, member.participantId);
  res.status(201).json(JoinAccountRoomResponse.parse({ ...session,
    participantId: member.participantId, room: roomStore.get(params.data.roomId) }));
});
export default router;