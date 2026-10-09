import { Router } from "express";
import { db, moderatorBotFlags, roomMessages, chatRooms } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetModeratorBotSettingsResponse, SaveModeratorBotSettingsBody, GetModeratorBotFlagsResponse,
  AcknowledgeModeratorBotFlagResponse, AcknowledgeModeratorBotFlagParams } from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { requireModerator } from "../lib/community";
import { RoomError } from "../lib/room-store";
import { botSettings, saveBotSettings, getBotFlags, reviewBotFlag } from "../lib/moderator-bots";

const router = Router();
router.use("/account/chat/bots", async (req, res, next) => {
  await requireModerator(accountId(req));
  res.set("Cache-Control", "no-store"); next();
});
router.get("/account/chat/bots/settings", async (_req, res) => {
  const settings = await botSettings();
  res.json(GetModeratorBotSettingsResponse.parse(settings));
});
router.put("/account/chat/bots/settings", async (req, res) => {
  sameOrigin(req);
  const parsed = SaveModeratorBotSettingsBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body).some(key => !["bannedWords", "breakSeconds"].includes(key)))
    throw new RoomError(400, "Use up to 200 words or phrases, and a break of 15–600 seconds");
  const bannedWords = [...new Set(parsed.data.bannedWords.map(w => w.trim()).filter(Boolean))];
  if (bannedWords.some(w => w.length < 2)) throw new RoomError(400, "Each word or phrase needs at least two characters");
  res.json(GetModeratorBotSettingsResponse.parse(await saveBotSettings({ ...parsed.data, bannedWords })));
});
router.get("/account/chat/bots/flags", async (_req, res) => {
  res.json(GetModeratorBotFlagsResponse.parse(await getBotFlags()));
});
router.post("/account/chat/bots/flags/:flagId/review", async (req, res) => {
  sameOrigin(req);
  const parsed = AcknowledgeModeratorBotFlagParams.safeParse(req.params);
  if (!parsed.success) throw new RoomError(400, "Invalid flagged message");
  const row = await reviewBotFlag(parsed.data.flagId, accountId(req));
  if (!row) throw new RoomError(404, "Flag not found or already reviewed");
  // Read back this reviewed row without exposing account IDs or private data.
  const [flag] = await db.select({ id: moderatorBotFlags.id, messageId: moderatorBotFlags.messageId,
    roomId: moderatorBotFlags.roomId, roomLabel: chatRooms.label, username: moderatorBotFlags.username,
    displayName: moderatorBotFlags.displayName, reason: moderatorBotFlags.reason, text: roomMessages.text,
    createdAt: moderatorBotFlags.createdAt, reviewedAt: moderatorBotFlags.reviewedAt })
    .from(moderatorBotFlags).innerJoin(roomMessages, eq(roomMessages.id, moderatorBotFlags.messageId))
    .innerJoin(chatRooms, eq(chatRooms.roomId, moderatorBotFlags.roomId)).where(eq(moderatorBotFlags.id, row.id));
  res.json(AcknowledgeModeratorBotFlagResponse.parse(flag));
});
export default router;
