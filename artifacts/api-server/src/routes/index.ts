import { Router, type IRouter } from "express";
import healthRouter from "./health";
import easyteamRouter from "./easyteam";
import clientsRouter from "./clients";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(easyteamRouter);
router.use(clientsRouter);

export default router;
