import { Router, type IRouter, type Request } from "express";
import { randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";
import {
  SaveMyProfileBody, SaveMyProfileResponse, GetMyProfileResponse,
  CreateAccountRoomResponse, JoinAccountRoomParams, JoinAccountRoomResponse,
  CreateAccountRoomBody, GetEmojiCatalogResponse,
} from "@workspace/api-zod";
import { getProfile, saveProfile, requireCompletedProfile } from "../lib/account-profiles";
import { recordDailyLogin } from '../lib/social/marathon';
import { roomStore, RoomError } from "../lib/room-store";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { communityMembership, accessFor } from "../lib/community";
import { nameColorProfilesForAccounts } from "../lib/social/gift-name-color-data";
import { universityAudioBeamStore } from "../lib/university-audio-beam";
import { coloredEmoji, emojiCatalog } from "../lib/emoji-library";
import { claimRoomEntranceEffect } from "../lib/room-entrance-effects";
import { accountEntranceEffectSelection } from "../lib/social/entrance-effect-preferences";

const router: IRouter = Router();
router.get("/emojis", (_req, res): void => {
  res
    .set("Cache-Control", "public, max-age=86400")
    .json(GetEmojiCatalogResponse.parse(emojiCatalog));
});
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
  throw new RoomError(410, "Broadcasting is disabled. Choose a room from the Directory.");
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
  if (!params.success) throw new RoomError(400, "Invalid room ID");
  if (!roomStore.isCommunity(params.data.roomId)) throw new RoomError(410, "This legacy Beam is archived. Choose a room from the Directory.");
  universityAudioBeamStore.assertCanJoin(params.data.roomId, id);
  const profile = await requireCompletedProfile(id);
  const access = await accessFor(id);
  const member = await communityMembership(params.data.roomId, id);
  const nameColors = await nameColorProfilesForAccounts([id]);
  const session = roomStore.join(params.data.roomId, profile.displayName ?? profile.username, {
    accountId: id, identity: profile.identity, capExempt: access.moderator,
    displayNameColor: nameColors.get(id)?.color ?? "#FFFFFF",
    displayNameTierIndex: nameColors.get(id)?.tierIndex ?? 0,
  });
  roomStore.restoreParticipantId(params.data.roomId, id, member.participantId);
  try {
    const selected = await accountEntranceEffectSelection(id);
    const requestedEntryId = req.get("X-Room-Entry-Id")?.trim();
    const entryId = requestedEntryId && /^[A-Za-z0-9_-]{8,128}$/.test(requestedEntryId)
      ? requestedEntryId
      : randomUUID();
    const effectId = selected ? await claimRoomEntranceEffect(id, selected.effectId, entryId) : null;
    if (effectId && selected) roomStore.publishRoomEntranceEffect(
      params.data.roomId, id, effectId, selected.durationMs,
      { studioVersionId: selected.studioVersionId, effectName: selected.effectName },
    );
  } catch {
    req.log.warn("Room entrance effect could not be started");
  }
  res.status(201).json(JoinAccountRoomResponse.parse({ ...session,
    participantId: member.participantId, room: roomStore.get(params.data.roomId) }));
});
export default router;