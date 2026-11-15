import chatRouter from "./chat";
import universityChatRouter from "./university-chat";
import moderatorBotRouter from "./moderator-bots";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import identityRouter from "./identity";
import socialRouter from "./social";
import communityRouter from "./community";
import profilePhotosRouter from "./profile-photos";
import photoReviewRouter from "./photo-review";
import universityAudioRouter from "./university-audio";
import universityVideoBeamRouter from "./university-video-beam";
import roomBattlesRouter from "./room-battles";
import { accountId } from "./identity";
import { requireAdult } from "../lib/community";
import { requireCompletedProfile } from "../lib/account-profiles";
import { devAudioHarnessEnabled } from "../lib/dev-audio-harness-policy";
import devAudioHarnessRouter from "./dev-audio-harness";

const router: IRouter = Router();

router.use(healthRouter);
router.use(communityRouter);
router.use(moderatorBotRouter);
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
router.use(universityAudioRouter);
router.use(universityVideoBeamRouter);
router.use(roomBattlesRouter);
if (devAudioHarnessEnabled(process.env.NODE_ENV))
  router.use("/__dev/audio-harness", devAudioHarnessRouter);
router.use(roomsRouter);

export default router;
