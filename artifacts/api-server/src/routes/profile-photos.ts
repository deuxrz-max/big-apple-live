import { Router, raw } from "express";
import { accountId, sameOrigin } from "./identity";
import { requireAdult } from "../lib/community";
import { PHOTO_LIMIT, stageProfilePhoto, readablePhoto } from "../lib/profile-photo-storage";
import { UploadProfilePhotoResponse, GetProfilePhotoParams } from "@workspace/api-zod";
import { RoomError, roomStore } from "../lib/room-store";
import { pairBlocked } from "../lib/social/core";
import { isTestAccountId } from "../lib/account-profiles";

const router = Router();
router.post("/me/photo", async (req, _res, next) => {
  accountId(req);
  sameOrigin(req);
  const id = accountId(req);
  if (process.env.NODE_ENV === "production" && await isTestAccountId(id))
    throw new RoomError(404, "Account profile not available");
  await requireAdult(id);
  next();
}, raw({ type: "application/octet-stream", limit: PHOTO_LIMIT }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new RoomError(400, "Send the selected photo as a binary file");
  res.set("Cache-Control", "no-store");
  res.status(201).json(UploadProfilePhotoResponse.parse(await stageProfilePhoto(accountId(req), req.body)));
});
router.get("/photos/:photoId", async (req, res) => {
  const id = accountId(req);
  const params = GetProfilePhotoParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "Photo not available");
  const { file, ownerId } = await readablePhoto(params.data.photoId, id);
  if (await isTestAccountId(ownerId)) throw new RoomError(404, "Photo not available");
  if (id !== ownerId && await pairBlocked(id, ownerId)) {
    const sharesRoom = roomStore.communityRoomIds().some(roomId =>
      roomStore.hasAccountMember(roomId, id) && roomStore.hasAccountMember(roomId, ownerId));
    if (!sharesRoom) throw new RoomError(404, "Photo not available");
  }
  res.set({ "Content-Type": "image/webp", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
  file.createReadStream().on("error", () => {
    if (!res.headersSent) res.status(404).end(); else res.destroy();
  }).pipe(res);
});
export default router;
