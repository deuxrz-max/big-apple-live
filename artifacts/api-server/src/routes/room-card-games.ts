import { Router } from "express";
import { z } from "zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireOwner } from "../lib/community";
import { assertRoomAccessAllowed, communityRoomScope } from "../lib/room-moderation";
import {
  getRoomCardGameSettings, getRoomCardGameView, updateRoomCardGameSettings,
} from "../lib/room-card-game-service";

const router = Router();
const settingsPatch = z.object({
  dealsEnabled: z.boolean().optional(),
  payoutsEnabled: z.boolean().optional(),
  cardDisplayEnabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0);

router.get("/owner/card-games/settings", async (req, res) => {
  await requireOwner(accountId(req));
  res.set("Cache-Control", "no-store").json(await getRoomCardGameSettings());
});

router.patch("/owner/card-games/settings", async (req, res) => {
  sameOrigin(req);
  await requireOwner(accountId(req));
  const parsed = settingsPatch.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Choose one or more valid card-game switches.");
  res.set("Cache-Control", "no-store").json(await updateRoomCardGameSettings(parsed.data));
});

router.get("/account/rooms/:roomId/card-game", async (req, res) => {
  const id = accountId(req);
  const roomId = String(req.params.roomId).toUpperCase();
  const sessionId = req.get("X-Room-Session") ?? "";
  roomStore.requireAccountMember(roomId, sessionId, id);
  await assertRoomAccessAllowed(communityRoomScope(roomId), id);
  res.set("Cache-Control", "no-store").json(await getRoomCardGameView(roomId, id));
});

export default router;
