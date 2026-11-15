import { Router } from "express";
import { z } from "zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { universityVideoBeamStore } from "../lib/university-video-beam";

const router = Router();
const roomIdPattern = /^[A-Z0-9]{6,16}$/i;
const startBody = z.object({ state: z.record(z.string(), z.unknown()) }).strict();
const actionBody = z.object({
  version: z.number().int().positive(),
  state: z.record(z.string(), z.unknown()),
}).strict();

router.get("/account/rooms/:roomId/battle", (req, res): void => {
  const id = accountId(req);
  const roomId = String(req.params.roomId ?? "").toUpperCase();
  if (!roomIdPattern.test(roomId)) throw new RoomError(400, "Invalid room code.");
  const member = roomStore.requireAccountMember(roomId, req.get("X-Room-Session") ?? "", id);
  const battle = roomStore.getSocialRoomBattle(roomId);
  if (battle && !battle.playerIds.includes(member.participantId)) {
    throw new RoomError(403, "This game is only for the players who were seated when it started.");
  }
  res.set("Cache-Control", "no-store").json({ battle });
});

router.post("/account/rooms/:roomId/battle/start", (req, res): void => {
  sameOrigin(req);
  const id = accountId(req);
  const roomId = String(req.params.roomId ?? "").toUpperCase();
  if (!roomIdPattern.test(roomId)) throw new RoomError(400, "Invalid room code.");
  roomStore.requireAccountMember(roomId, req.get("X-Room-Session") ?? "", id);
  const parsed = startBody.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Could not start the room game.");
  const seatedIds = universityVideoBeamStore.getState(roomId).slots
    .filter(slot => slot.participantId !== null)
    .sort((a, b) => a.slotNumber - b.slotNumber)
    .map(slot => slot.participantId!);
  const battle = roomStore.startSocialRoomBattle(roomId, id, seatedIds, parsed.data.state);
  res.set("Cache-Control", "no-store").json({ battle });
});

router.post("/account/rooms/:roomId/battle/action", (req, res): void => {
  sameOrigin(req);
  const id = accountId(req);
  const roomId = String(req.params.roomId ?? "").toUpperCase();
  if (!roomIdPattern.test(roomId)) throw new RoomError(400, "Invalid room code.");
  roomStore.requireAccountMember(roomId, req.get("X-Room-Session") ?? "", id);
  const parsed = actionBody.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Could not sync that turn.");
  const battle = roomStore.commitSocialRoomBattle(roomId, parsed.data.version, id, parsed.data.state);
  res.set("Cache-Control", "no-store").json({ battle });
});

export default router;
