import { Router, type IRouter } from "express";
import {
  SaveSocialProfileBody, SaveSocialProfileResponse, GetSocialMeResponse, GetSocialPeopleResponse,
  GetSocialPersonResponse, SetSocialRelationshipBody, SendSocialGiftBody, PurchaseSocialProductBody,
  SendSocialMessageBody, SendSocialMessageResponse, GetSocialConversationResponse, GetSocialInboxResponse,
  GetSocialLedgerResponse, GetSocialPeopleQueryParams, GetSocialConversationQueryParams,
  GetFavoritesGalleryResponse, GetFavoriteRoomResponse,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError } from "../lib/room-store";
import { requireAccount } from "../lib/social/core";
import { blocks, getMe, getPerson, listPeople, relationship, saveSocialProfile } from "../lib/social/people";
import { claimDaily, gift, ledger, purchase } from "../lib/social/rewards";
import { roomGiftEvents } from '../lib/social/room-gifts';
import { serveGiftMedia, serveMoonfoxGiftMedia, serveCosmicEncoreGiftMedia } from '../lib/gift-media';
import { clearThread, inbox, sendMessage, thread } from "../lib/social/messages";
import { favoritesGallery, favoriteRoom } from "../lib/social/favorites";

const router: IRouter = Router();
router.get('/gift-media/spirit-pup/v1/:filename', serveGiftMedia);
router.get('/gift-media/moonfox/v1/:filename', serveMoonfoxGiftMedia);
router.get('/gift-media/cosmic-encore/v1/:filename', serveCosmicEncoreGiftMedia);
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
router.get("/social/favorites/gallery", async (req, res): Promise<void> => {
  res.json(GetFavoritesGalleryResponse.parse(await favoritesGallery(accountId(req))));
});
router.get("/social/favorites/:username/room", async (req, res): Promise<void> => {
  res.json(GetFavoriteRoomResponse.parse(await favoriteRoom(accountId(req), name(req.params.username))));
});
router.get("/social/me", async (req, res): Promise<void> => { res.json(GetSocialMeResponse.parse(await getMe(accountId(req)))); });
router.put("/social/me", async (req, res): Promise<void> => {
  const input = SaveSocialProfileBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Use a bio up to 200 characters, a valid country and up to eight interests");
  res.json(SaveSocialProfileResponse.parse(await saveSocialProfile(accountId(req), input.data)));
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
  res.json(await relationship(accountId(req), name(req.params.username), input.data.kind, input.data.active));
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
  res.json(SendSocialMessageResponse.parse(await sendMessage(accountId(req), name(req.params.username), input.data.body, input.data.idempotencyKey)));
});
router.delete("/social/messages/:username", async (req, res): Promise<void> => { res.json(await clearThread(accountId(req), name(req.params.username))); });
export default router;
