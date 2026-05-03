import { Router, type IRouter } from "express";
import healthRouter from "./health";
import easyteamRouter from "./easyteam";

const router: IRouter = Router();

router.use(healthRouter);
router.use(easyteamRouter);

export default router;
