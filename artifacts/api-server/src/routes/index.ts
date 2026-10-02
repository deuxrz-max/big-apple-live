import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import audioRouter from "./audio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomsRouter);
router.use(audioRouter);

export default router;
