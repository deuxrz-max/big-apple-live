import chatRouter from "./chat";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import audioRouter from "./audio";
import identityRouter from "./identity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(identityRouter);
router.use(chatRouter);
router.use(roomsRouter);
router.use(audioRouter);

export default router;
