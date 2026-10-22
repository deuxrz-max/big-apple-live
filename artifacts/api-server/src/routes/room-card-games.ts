import { Router } from "express";
import { z } from "zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { db, accountProfiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireOwner } from "../lib/community";
import { assertRoomAccessAllowed, communityRoomScope } from "../lib/room-moderation";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { ownerCardGameTestMode, type OwnerCardTestContext } from "../lib/owner-card-game-test-mode";
import { serveCardDeckFace } from "../lib/card-deck-media";
import {
  getRoomCardGameSettings, getRoomCardGameView, updateRoomCardGameSettings,
} from "../lib/room-card-game-service";

const router = Router();
router.get("/card-deck/:filename", serveCardDeckFace);
const settingsPatch = z.object({
  dealsEnabled: z.boolean().optional(),
  payoutsEnabled: z.boolean().optional(),
  cardDisplayEnabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0);
const ownerTestContext = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room"), roomId: z.string().trim().min(1).max(20) }).strict(),
]);
const ownerTestModePatch = z.object({ enabled: z.boolean() }).strict();
const ownerTestModeAck = ownerTestContext.options[0].extend({
  winnerId: z.string().min(1).max(120),
});

async function requireDevelopmentOwner(id: string) {
  if (process.env.NODE_ENV !== "development") {
    throw new RoomError(404, "Not found");
  }
  await requireOwner(id);
}

async function resolveOwnerTestContext(id: string, context: z.infer<typeof ownerTestContext>): Promise<OwnerCardTestContext> {
  const roomId = context.roomId.toUpperCase();
  if (!roomStore.isSocialRoom(roomId) || roomStore.hostAccountId(roomId) !== id) {
    return { key: `room:${roomId}`, eligible: false, message: "Open a room you created to test cards." };
  }
  const activeAccounts = roomStore.activeAccountIds(roomId);
  if (activeAccounts.length !== 1 || activeAccounts[0] !== id) {
    return { key: `room:${roomId}`, eligible: false, message: "Card testing is available while you are the only person in your room." };
  }
  const beam = universityVideoBeamStore.getState(roomId);
  const ownSlot = beam.slots.find(slot => slot.participantId
    && universityVideoBeamStore.accountIdForParticipant(roomId, slot.participantId) === id);
  if (!ownSlot) {
    return { key: `room:${roomId}`, eligible: false, message: "Take your speaker seat to test cards." };
  }
  return {
    key: `room:${roomId}:${ownSlot.slotNumber}`,
    eligible: true,
    seatNumber: ownSlot.slotNumber,
  };
}

async function ownerUsername(id: string) {
  const [profile] = await db.select({ username: accountProfiles.username })
    .from(accountProfiles).where(eq(accountProfiles.accountId, id)).limit(1);
  return profile?.username ?? "Owner";
}

router.get("/owner/card-games/test-mode", async (req, res) => {
  const id = accountId(req);
  await requireDevelopmentOwner(id);
  const parsed = ownerTestContext.safeParse(req.query);
  if (!parsed.success) throw new RoomError(400, "Choose a valid card-test screen.");
  const context = await resolveOwnerTestContext(id, parsed.data);
  res.set("Cache-Control", "no-store").json(ownerCardGameTestMode.getState({
    accountId: id,
    username: await ownerUsername(id),
    context,
  }));
});

router.patch("/owner/card-games/test-mode", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireDevelopmentOwner(id);
  const parsed = ownerTestModePatch.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Choose whether owner card testing is on or off.");
  const enabled = ownerCardGameTestMode.setEnabled(id, parsed.data.enabled);
  res.set("Cache-Control", "no-store").json({ enabled });
});

router.post("/owner/card-games/test-mode/acknowledge", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireDevelopmentOwner(id);
  const parsed = ownerTestModeAck.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "The winner moment could not be confirmed.");
  const context = await resolveOwnerTestContext(id, parsed.data);
  if (!context.eligible) throw new RoomError(409, "The card-test room is no longer active.");
  const acknowledged = ownerCardGameTestMode.acknowledgeWinner({
    accountId: id,
    contextKey: context.key,
    winnerId: parsed.data.winnerId,
  });
  if (!acknowledged) throw new RoomError(409, "Keep the winner moment visible for five seconds before it closes.");
  res.set("Cache-Control", "no-store").json({ enabled: false });
});

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
  if (!roomStore.isSocialRoom(roomId)) throw new RoomError(404, "Room not found.");
  const sessionId = req.get("X-Room-Session") ?? "";
  roomStore.requireAccountMember(roomId, sessionId, id);
  await assertRoomAccessAllowed(communityRoomScope(roomId), id);
  res.set("Cache-Control", "no-store").json(await getRoomCardGameView(roomId, id));
});

router.get("/account/rooms/:roomId/card-game/participants/:participantId", async (req, res) => {
  const id = accountId(req);
  const roomId = String(req.params.roomId).toUpperCase();
  if (!roomStore.isSocialRoom(roomId)) throw new RoomError(404, "Room not found.");
  const sessionId = req.get("X-Room-Session") ?? "";
  roomStore.requireAccountMember(roomId, sessionId, id);
  await assertRoomAccessAllowed(communityRoomScope(roomId), id);
  const participantId = String(req.params.participantId);
  if (!roomStore.get(roomId).participants.some(participant => participant.participantId === participantId)) {
    res.set("Cache-Control", "no-store").json({ inThisGame: false, cards: [] });
    return;
  }
  if (!universityVideoBeamStore.getState(roomId).slots.some(slot => slot.participantId === participantId)) {
    res.set("Cache-Control", "no-store").json({ inThisGame: false, cards: [] });
    return;
  }
  const targetAccountId = universityVideoBeamStore.accountIdForParticipant(roomId, participantId);
  if (!targetAccountId) {
    res.set("Cache-Control", "no-store").json({ inThisGame: false, cards: [] });
    return;
  }
  const view = await getRoomCardGameView(roomId, targetAccountId);
  res.set("Cache-Control", "no-store").json({
    gameNumber: view.gameNumber,
    inThisGame: view.inThisGame,
    cards: view.cards,
  });
});

export default router;
