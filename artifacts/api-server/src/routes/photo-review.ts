import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, profilePhotos } from "@workspace/db";
import { accountId, sameOrigin } from "./identity";
import { accessFor } from "../lib/community";
import { hasPhotoReviewAccess } from "../lib/photo-review-policy";
import { pendingPhotoQueue } from "../lib/photo-visibility";
import { RoomError } from "../lib/room-store";
import { GetPhotoReviewQueueResponse, ReviewProfilePhotoBody, ReviewProfilePhotoParams } from "@workspace/api-zod";

const router = Router();
async function requirePhotoReviewer(id: string) {
  const access = await accessFor(id);
  if (!hasPhotoReviewAccess(access)) {
    const message = access.adultConfirmed
      ? "Photo review access required"
      : "Deux Wild is adults-only. Confirm that you are 18 or older before entering chat.";
    throw new RoomError(403, message);
  }
}

router.get("/account/chat/photo-reviews", async (req, res) => {
  await requirePhotoReviewer(accountId(req));
  res.set("Cache-Control", "no-store");
  res.json(GetPhotoReviewQueueResponse.parse(await pendingPhotoQueue()));
});
router.patch("/account/chat/photo-reviews/:photoId", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requirePhotoReviewer(id);
  const params = ReviewProfilePhotoParams.safeParse(req.params);
  const input = ReviewProfilePhotoBody.safeParse(req.body);
  if (!params.success || !input.success) throw new RoomError(400, "Choose a photo and approve or reject it");
  const [photo] = await db.update(profilePhotos).set({
    status: input.data.action === "approve" ? "approved" : "rejected",
    reviewedBy: id, reviewedAt: new Date(),
  }).where(and(eq(profilePhotos.id, params.data.photoId), eq(profilePhotos.status, "pending")))
    .returning({ id: profilePhotos.id, status: profilePhotos.status });
  if (!photo) throw new RoomError(409, "Photo is no longer pending review");
  res.set("Cache-Control", "no-store");
  res.json(photo);
});
export default router;
