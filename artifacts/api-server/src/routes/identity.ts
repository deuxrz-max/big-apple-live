import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  SaveMyProfileBody, SaveMyProfileResponse, GetMyProfileResponse,
  CreateAccountRoomResponse, JoinAccountRoomParams, JoinAccountRoomResponse,
  CreateAccountRoomBody,
} from "@workspace/api-zod";
import { getProfile, saveProfile, requireCompletedProfile } from "../lib/account-profiles";
import { roomStore, RoomError } from "../lib/room-store";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { communityMembership } from "../lib/community";

const router: IRouter = Router();
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
  res.json(GetMyProfileResponse.parse({ profile: await getProfile(accountId(req)) }));
});
router.put("/me", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const body = SaveMyProfileBody.safeParse(req.body);
  if (!body.success || Object.keys(req.body ?? {}).some(key => !["username", "displayName", "bio", "photoUrl"].includes(key)))
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
  const profile = await requireCompletedProfile(id);
  const member = await communityMembership(params.data.roomId, id);
  const session = roomStore.join(params.data.roomId, profile.displayName ?? profile.username, { accountId: id, identity: profile.identity, photoUrl: profile.photoUrl ?? null });
  roomStore.restoreParticipantId(params.data.roomId, id, member.participantId);
  res.status(201).json(JoinAccountRoomResponse.parse({ ...session,
    participantId: member.participantId, room: roomStore.get(params.data.roomId) }));
});
export default router;