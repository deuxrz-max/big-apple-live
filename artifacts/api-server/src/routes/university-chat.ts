import { Router } from "express";
import { GetUniversitySessionResponse, SendUniversityWhisperBody, SetUniversityIgnoreBody } from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { requireAdult } from "../lib/community";
import { requireCompletedProfile } from "../lib/account-profiles";
import { RoomError } from "../lib/room-store";
import { universitySession, sendWhisper, setIgnore, markRulesSeen } from "../lib/university-chat";

const router = Router();
router.use(["/account/chat/ignores", "/account/chat/rules"], async (req, _res, next) => {
  await requireAdult(accountId(req));
  await requireCompletedProfile(accountId(req));
  next();
});
router.get("/account/rooms/:roomId/university-session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetUniversitySessionResponse.parse(await universitySession(
    accountId(req), req.params.roomId, req.get("X-Room-Session") ?? "",
  )));
});
router.post("/account/rooms/:roomId/whispers", async (req, res) => {
  sameOrigin(req);
  const parsed = SendUniversityWhisperBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body).some(k => !["username", "body", "idempotencyKey"].includes(k))) throw new RoomError(400, "Invalid whisper");
  await sendWhisper(accountId(req), req.params.roomId, req.get("X-Room-Session") ?? "",
    parsed.data.username, parsed.data.body, parsed.data.idempotencyKey);
  res.set("Cache-Control", "no-store").status(201).json({ ok: true });
});
router.put("/account/chat/ignores/:username", async (req, res) => {
  sameOrigin(req);
  const parsed = SetUniversityIgnoreBody.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Choose Ignore or Unignore");
  res.json(await setIgnore(accountId(req), req.params.username, parsed.data.active));
});
router.post("/account/chat/rules/seen", async (req, res) => {
  sameOrigin(req);
  res.json(await markRulesSeen(accountId(req)));
});
export default router;
