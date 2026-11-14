import { Router, type IRouter, type Request } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { chatRooms, db } from "@workspace/db";
import { getAuth } from "@clerk/express";
import {
  SaveMyProfileBody, SaveMyProfileResponse, GetMyProfileResponse,
  CreateAccountRoomResponse, JoinAccountRoomParams, JoinAccountRoomResponse,
  CreateAccountRoomBody, GetEmojiCatalogResponse,
} from "@workspace/api-zod";
import { getProfile, saveProfile, requireCompletedProfile } from "../lib/account-profiles";
import { assertRoomAccessAllowed, communityRoomScope } from "../lib/room-moderation";
import { recordDailyLogin } from '../lib/social/marathon';
import { roomStore, RoomError } from "../lib/room-store";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { communityMembership, accessFor } from "../lib/community";
import { getProfileCosmeticStyle } from "../lib/social/profile-cosmetics";
import { universityAudioBeamStore } from "../lib/university-audio-beam";
import { coloredEmoji, emojiCatalog } from "../lib/emoji-library";
import { normalizeAccountRoomTitle } from "../lib/account-room-title";

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
  if (Array.isArray(req.body?.photoUrls) && req.body.photoUrls.length > 1)
    throw new RoomError(400, "Keep one profile photo. Upload a replacement instead.");
  const body = SaveMyProfileBody.safeParse(req.body);
   if (!body.success || Object.keys(req.body ?? {}).some(key => !["username", "displayName", "photoUrl", "photoUrls"].includes(key)))
    throw new RoomError(400, "Use a valid name and one uploaded profile photo; account ownership is set by the server.");
  res.set("Cache-Control", "no-store");
  res.json(SaveMyProfileResponse.parse(await saveProfile(id, body.data)));
});
router.post("/account/rooms", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const profile = await requireCompletedProfile(id);
  const body = CreateAccountRoomBody.safeParse(req.body);
  if (!body.success) {
    throw new RoomError(400, "Enter a one-word room name. Ave is added automatically.");
  }
  if (body.data.capacity !== 9) throw new RoomError(400, "Created rooms use the nine-seat layout.");
  const title = normalizeAccountRoomTitle(body.data.name);
  if (!title.ok) throw new RoomError(400, title.message);
  const name = title.name;
  const access = await accessFor(id);
  const nameColors = await getProfileCosmeticStyle(id);

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = randomBytes(6).toString("hex").toUpperCase();
    if (roomStore.hasRoomId(roomId)) continue;
    const historyId = randomUUID();
    const [created] = await db.insert(chatRooms).values({ roomId, historyId, label: name })
      .onConflictDoNothing().returning({ roomId: chatRooms.roomId });
    if (!created) continue;

    let roomCreated = false;
    try {
      const session = roomStore.createSocialRoom(roomId, historyId, name,
        profile.displayName ?? profile.username, {
          accountId: id,
          identity: profile.identity,
          capExempt: access.moderator,
          displayNameColor: nameColors.displayNameColor,
          displayNameTierIndex: nameColors.displayNameTierIndex,
        });
      roomCreated = true;
      const member = await communityMembership(roomId, id);
      roomStore.restoreParticipantId(roomId, id, member.participantId);
      res.status(201).json(CreateAccountRoomResponse.parse({
        ...session,
        participantId: member.participantId,
        room: roomStore.get(roomId),
      }));
      return;
    } catch (error) {
      if (roomCreated) roomStore.discardSocialRoom(roomId);
      await db.delete(chatRooms).where(eq(chatRooms.roomId, roomId));
      throw error;
    }
  }
  throw new RoomError(503, "Could not reserve a new room code. Try again.");
});
router.post("/account/rooms/:roomId/join", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinAccountRoomParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid room ID");
  if (!roomStore.isCommunity(params.data.roomId)) throw new RoomError(410, "This legacy Beam is archived. Choose a room from the Directory.");
  await assertRoomAccessAllowed(communityRoomScope(params.data.roomId), id);
  universityAudioBeamStore.assertCanJoin(params.data.roomId, id);
  const profile = await requireCompletedProfile(id);
  const access = await accessFor(id);
  const member = await communityMembership(params.data.roomId, id);
  const nameColors = await getProfileCosmeticStyle(id);
  const session = roomStore.join(params.data.roomId, profile.displayName ?? profile.username, {
    accountId: id, identity: profile.identity, capExempt: access.moderator,
     displayNameColor: nameColors.displayNameColor,
     displayNameTierIndex: nameColors.displayNameTierIndex,
  });
  roomStore.restoreParticipantId(params.data.roomId, id, member.participantId);
  res.status(201).json(JoinAccountRoomResponse.parse({ ...session,
    participantId: member.participantId, room: roomStore.get(params.data.roomId) }));
});
export default router;