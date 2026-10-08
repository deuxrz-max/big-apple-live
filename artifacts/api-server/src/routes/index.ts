import chatRouter from "./chat";
import universityChatRouter from "./university-chat";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import identityRouter from "./identity";
import socialRouter from "./social";
import communityRouter from "./community";
import profilePhotosRouter from "./profile-photos";
import photoReviewRouter from "./photo-review";
import { accountId } from "./identity";
import { requireAdult } from "../lib/community";
import { requireCompletedProfile } from "../lib/account-profiles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(communityRouter);
router.use(profilePhotosRouter);
router.use(photoReviewRouter);
router.use(["/account/rooms", "/social"], async (req, _res, next) => {
  await requireAdult(accountId(req));
  await requireCompletedProfile(accountId(req));
  next();
});
router.use(identityRouter);
router.use(socialRouter);
router.use(chatRouter);
router.use(universityChatRouter);
// Leave shared audio modules in place for rollback, but never mount signaling.
router.use((req, res, next) => {
  if (req.path.includes("/audio") || req.path.endsWith("/microphone")
    || (req.method === "POST" && (req.path === "/rooms" || /^\/rooms\/[^/]+\/join$/.test(req.path)))) {
    res.status(410).json({ error: "Broadcasting is disabled. Choose a university." }); return;
  }
  next();
});
router.use(roomsRouter);

export default router;
