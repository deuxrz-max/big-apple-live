import { Router } from "express";
import { UpdatePinkCardEntryBody, GetPinkCardRewardResponse, GetPinkCardEntryResponse } from "@workspace/api-zod";
import { accountId } from "./identity";
import { pinkRewardEntry, pinkRewardStatus, setPinkRewardPreference } from "../lib/pink-card-rewards";
import { PINK_MEDIA, pinkRewardMediaFile, type PinkMediaVariant } from "../lib/pink-card-media";

const router = Router();
router.get("/rewards/pink-card", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(GetPinkCardRewardResponse.parse(await pinkRewardStatus()));
});
router.get("/social/pink-card/entry", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(GetPinkCardEntryResponse.parse(await pinkRewardEntry(accountId(req))));
});
router.put("/social/pink-card/entry", async (req, res) => {
  const input = UpdatePinkCardEntryBody.parse(req.body);
  res.json(GetPinkCardEntryResponse.parse(await setPinkRewardPreference(accountId(req), input.optedOut)));
});
router.get("/rewards/pink-card/media/:variant", async (req, res) => {
  const variant = req.params.variant as PinkMediaVariant;
  if (!Object.hasOwn(PINK_MEDIA, variant)) { res.sendStatus(404); return; }
  const file = pinkRewardMediaFile(variant);
  const [exists] = await file.exists();
  if (!exists) { res.sendStatus(404); return; }
  res.setHeader("Content-Type", PINK_MEDIA[variant].type);
  res.setHeader("Cache-Control", "public, max-age=3600");
  const stream = file.createReadStream();
  stream.on("error", () => { if (!res.headersSent) res.sendStatus(503); else res.destroy(); });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
});
export default router;
