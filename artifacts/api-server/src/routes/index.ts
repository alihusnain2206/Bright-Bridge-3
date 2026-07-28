import { Router, type IRouter } from "express";
import healthRouter from "./health";
import easyteamRouter from "./easyteam";
import clientsRouter from "./clients";
import authRouter from "./auth";
import rollfiRouter from "./rollfi";
import companiesRouter from "./companies";
import peopleRouter from "./people";
import searchRouter from "./search";
import notificationsRouter from "./notifications";
import companySettingsRouter from "./company-settings";
import accountRouter from "./account";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(easyteamRouter);
router.use(clientsRouter);
router.use(rollfiRouter);
router.use(companiesRouter);
router.use(peopleRouter);
router.use(searchRouter);
router.use(notificationsRouter);
router.use(companySettingsRouter);
router.use(accountRouter);
router.use(adminRouter);

export default router;
