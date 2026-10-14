import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { accountProfiles, db } from "@workspace/db";
import {
  SaveSocialProfileBody, SaveSocialProfileResponse, GetSocialMeResponse, GetSocialPeopleResponse,
  UpdateMyEntranceEffectSettingsBody, UpdateMyEntranceEffectSettingsResponse,
  GetSocialPersonResponse, SetSocialRelationshipBody, SendSocialGiftBody, PurchaseSocialProductBody,
  SendSocialMessageBody, SendSocialMessageResponse, GetSocialConversationResponse, GetSocialInboxResponse,
  GetSocialLedgerResponse, GetSocialPeopleQueryParams, GetSocialConversationQueryParams,
  GetFavoritesGalleryResponse, GetFavoriteRoomResponse, SaveMyStreamerPassportPlatformBody,
  ReviewStreamerPassportRequestBody, SetStreamerPassportFoundingLeagueBody,
  EquipMyBadgeBody, EquipMyBadgeResponse,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError } from "../lib/room-store";
import { requireAccount } from "../lib/social/core";
import { accessFor, requireAdult } from "../lib/community";
import { blocks, getMe, getPerson, listPeople, relationship, saveSocialProfile } from "../lib/social/people";
import { claimDaily, gift, ledger, purchase } from "../lib/social/rewards";
import { roomGiftEvents } from '../lib/social/room-gifts';
import { serveGiftMedia, serveMoonfoxGiftMedia, serveCosmicEncoreGiftMedia } from '../lib/gift-media';
import { serveMonthlyCreditTierEntranceEffectMedia, serveRoomEntranceEffectMedia } from "../lib/room-entry-effect-media";
import { clearThread, inbox, sendMessage, thread } from "../lib/social/messages";
import { favoritesGallery, favoriteRoom } from "../lib/social/favorites";
import { liveStreamIdForAccount, liveStreamRoomName } from "../lib/live-stream-policy";
import { liveKitBeamService } from "../lib/livekit";
import {
  deletePassportPlatform, myStreamerPassport, passportReviewQueue, publicStreamerPassport,
  requestPassportVerification, reviewPassportRequest, savePassportPlatform, setFoundingLeague,
} from "../lib/social/passport";
import { getMyEntranceEffectSettings, saveMyEntranceEffectSettings } from "../lib/social/entrance-effect-preferences";
import { saveEquippedBadge } from "../lib/social/monthly-credit-badges";

const router: IRouter = Router();
router.get('/gift-media/spirit-pup/v1/:filename', serveGiftMedia);
router.get('/gift-media/moonfox/v1/:filename', serveMoonfoxGiftMedia);
router.get('/gift-media/cosmic-encore/v1/:filename', serveCosmicEncoreGiftMedia);
router.get('/room-entry-effects/lion/:filename', serveRoomEntranceEffectMedia);
router.get('/room-entry-effects/monthly-credit-tiers/:tier/:filename', serveMonthlyCreditTierEntranceEffectMedia);
router.use("/social", async (req, res, next) => {
  const id = accountId(req);
  if (req.method !== "GET") sameOrigin(req);
  await requireAccount(id);
  res.set("Cache-Control", "no-store");
  next();
});
const name = (raw: string | string[] | undefined) => {
  const value = typeof raw === "string" ? raw : "";
  if (!/^[A-Za-z0-9_]{3,24}$/.test(value)) throw new RoomError(400, "Invalid dedicated name");
  return value;
};
const passportEntryId = (raw: string | string[] | undefined) => {
  const value = typeof raw === "string" ? raw : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new RoomError(400, "Invalid platform link");
  return value;
};
router.get("/social/me/passport", async (req, res): Promise<void> => {
  res.json(await myStreamerPassport(accountId(req)));
});
router.put("/social/me/passport/platforms", async (req, res): Promise<void> => {
  const input = SaveMyStreamerPassportPlatformBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a platform and enter a valid handle or profile URL");
  res.json(await savePassportPlatform(accountId(req), input.data.platform, input.data.handleOrUrl));
});
router.delete("/social/me/passport/platforms/:entryId", async (req, res): Promise<void> => {
  res.json(await deletePassportPlatform(accountId(req), passportEntryId(req.params.entryId)));
});
router.post("/social/me/passport/platforms/:entryId/request", async (req, res): Promise<void> => {
  res.json(await requestPassportVerification(accountId(req), passportEntryId(req.params.entryId)));
});
router.get("/social/people/:username/passport", async (req, res): Promise<void> => {
  res.json(await publicStreamerPassport(accountId(req), name(req.params.username)));
});
router.get("/social/admin/passport/requests", async (req, res): Promise<void> => {
  res.json(await passportReviewQueue(accountId(req)));
});
router.post("/social/admin/passport/requests/:entryId/review", async (req, res): Promise<void> => {
  const input = ReviewStreamerPassportRequestBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose approve or reject");
  res.json(await reviewPassportRequest(accountId(req), passportEntryId(req.params.entryId), input.data.action));
});
router.post("/social/admin/passport/founding-league", async (req, res): Promise<void> => {
  const input = SetStreamerPassportFoundingLeagueBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose an account and whether to grant or remove the stamp");
  res.json(await setFoundingLeague(accountId(req), name(input.data.username), input.data.grant));
});
router.get("/social/favorites/gallery", async (req, res): Promise<void> => {
  res.json(GetFavoritesGalleryResponse.parse(await favoritesGallery(accountId(req))));
});
router.get("/social/favorites/:username/room", async (req, res): Promise<void> => {
  res.json(GetFavoriteRoomResponse.parse(await favoriteRoom(accountId(req), name(req.params.username))));
});
router.get("/social/me", async (req, res): Promise<void> => {
  res.json(GetSocialMeResponse.parse(await getMe(accountId(req))));
});
router.put("/social/me/equipped-badge", async (req, res): Promise<void> => {
  const input = EquipMyBadgeBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a badge or choose none");
  res.json(EquipMyBadgeResponse.parse(await saveEquippedBadge(accountId(req), input.data.badgeId)));
});
router.put("/social/me", async (req, res): Promise<void> => {
  const input = SaveSocialProfileBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Use a bio up to 200 characters, a valid country and up to eight interests");
  res.json(SaveSocialProfileResponse.parse(await saveSocialProfile(accountId(req), input.data)));
});
router.put("/social/me/entrance-effects", async (req, res): Promise<void> => {
  const input = UpdateMyEntranceEffectSettingsBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose an entrance-effect setting");
  res.json(UpdateMyEntranceEffectSettingsResponse.parse(await saveMyEntranceEffectSettings(accountId(req), input.data)));
});
router.get("/social/people", async (req, res): Promise<void> => {
  const input = GetSocialPeopleQueryParams.safeParse(req.query);
  if (!input.success) throw new RoomError(400, "Invalid search filters");
  // Boolean query strings must not use Boolean('false'), which is true.
  const favorites = req.query.favorites === "true";
  res.json(GetSocialPeopleResponse.parse(await listPeople(accountId(req), { ...input.data, favorites })));
});
router.get("/social/people/:username", async (req, res): Promise<void> => { res.json(GetSocialPersonResponse.parse(await getPerson(accountId(req), name(req.params.username)))); });
router.put("/social/people/:username/relationship", async (req, res): Promise<void> => {
  const input = SetSocialRelationshipBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose favorite or block and an active status");
  const actorId = accountId(req);
  const targetUsername = name(req.params.username);
  const result = await relationship(actorId, targetUsername, input.data.kind, input.data.active);
  if (input.data.kind === "block" && input.data.active) {
    const [target] = await db.select({ accountId: accountProfiles.accountId }).from(accountProfiles)
      .where(sql`lower(${accountProfiles.username}) = lower(${targetUsername})`).limit(1);
    if (target) {
      const livePairs = [
        { ownerId: actorId, viewerId: target.accountId },
        { ownerId: target.accountId, viewerId: actorId },
      ];
      for (const pair of livePairs) {
        const roomName = liveStreamRoomName(liveStreamIdForAccount(pair.ownerId));
        const viewerIdentity = `viewer-${liveStreamIdForAccount(pair.viewerId)}`;
        try {
          const participants = await liveKitBeamService.listParticipants(roomName);
          if (participants.some(participant => participant.identity === viewerIdentity)) {
            await liveKitBeamService.removeParticipant(roomName, viewerIdentity);
          }
        } catch (error) {
          req.log.warn({ error }, "Blocked livestream viewer could not be disconnected immediately");
        }
      }
    }
  }
  res.json(result);
});
router.get("/social/blocks", async (req, res): Promise<void> => { res.json(GetSocialPeopleResponse.parse(await blocks(accountId(req)))); });
router.post("/social/wallet/claim", async (req, res): Promise<void> => { res.json(await claimDaily(accountId(req))); });
router.get("/social/gifts/rooms/:roomId", async (req, res) => {
  res.json(await roomGiftEvents(accountId(req), String(req.params.roomId).toUpperCase(), req.get('X-Room-Session') ?? ''));
});
router.post("/social/gifts", async (req, res): Promise<void> => {
  const input = SendSocialGiftBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a gift, recipient and valid retry key");
  res.json(await gift(accountId(req), input.data.recipient, input.data.giftId, input.data.idempotencyKey,
    input.data.roomId ? { roomId: input.data.roomId, sessionId: req.get('X-Room-Session') ?? '' } : undefined));
});
router.post("/social/store/purchase", async (req, res): Promise<void> => {
  const input = PurchaseSocialProductBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a product and valid retry key");
  res.json(await purchase(accountId(req), input.data.itemId, input.data.idempotencyKey));
});
router.get("/social/wallet/transactions", async (req, res): Promise<void> => { res.json(GetSocialLedgerResponse.parse(await ledger(accountId(req)))); });
router.get("/social/leaderboard", async (req, res): Promise<void> => { res.json(GetSocialPeopleResponse.parse(await listPeople(accountId(req), {}, true))); });
router.get("/social/messages", async (req, res): Promise<void> => { res.json(GetSocialInboxResponse.parse(await inbox(accountId(req)))); });
router.get("/social/messages/:username", async (req, res): Promise<void> => {
  const input = GetSocialConversationQueryParams.safeParse(req.query);
  if (!input.success) throw new RoomError(400, "Invalid message history cursor");
  res.json(GetSocialConversationResponse.parse(await thread(accountId(req), name(req.params.username), input.data.cursor)));
});
router.post("/social/messages/:username", async (req, res): Promise<void> => {
  const input = SendSocialMessageBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Write up to 1000 characters and provide a valid retry key");
  const senderId = accountId(req);
  await requireAdult(senderId);
  const chatAccess = await accessFor(senderId);
  if (chatAccess.chatMuted || chatAccess.reportsMuted) {
    throw new RoomError(403, "Chat is temporarily muted while a moderator reviews reports");
  }
  res.json(SendSocialMessageResponse.parse(await sendMessage(senderId, name(req.params.username), input.data.body, input.data.idempotencyKey)));
});
router.delete("/social/messages/:username", async (req, res): Promise<void> => { res.json(await clearThread(accountId(req), name(req.params.username))); });
export default router;
