import { Router } from "express";
import { serveNycBackgroundVideo } from "../lib/nyc-background-media";

const router = Router();
router.get("/nyc-backgrounds/:id", serveNycBackgroundVideo);
router.head("/nyc-backgrounds/:id", serveNycBackgroundVideo);

export default router;
