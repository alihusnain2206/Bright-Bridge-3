import { Router, type IRouter } from "express";
import healthRouter from "./health";
import easyteamRouter from "./easyteam";
import clientsRouter from "./clients";
import authRouter from "./auth";
import rollfiRouter from "./rollfi";
import companiesRouter from "./companies";
import peopleRouter from "./people";
import adminCleanupRouter from "./admin-cleanup";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(easyteamRouter);
router.use(clientsRouter);
router.use(rollfiRouter);
router.use(companiesRouter);
router.use(peopleRouter);
router.use(adminCleanupRouter);

export default router;
