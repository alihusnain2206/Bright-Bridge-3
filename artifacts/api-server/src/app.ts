import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { backfillPeopleModule } from "./routes/people.js";

const PgStore = connectPgSimple(session);
const isProd = process.env.NODE_ENV === "production";

const app: Express = express();

// Trust the Replit reverse proxy so req.secure is correct and secure cookies work
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session",
      // Table is created via bootSessionTable() in index.ts on startup.
      // createTableIfMissing reads a .sql file from disk which esbuild doesn't copy.
    }),
    secret: process.env.SESSION_SECRET ?? "brightbridge-sandbox-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

// Backfill People Module data for existing employees/companies at startup
void backfillPeopleModule().then(() => {
  logger.info("People Module backfill complete");
}).catch((err: unknown) => {
  logger.warn({ err }, "People Module backfill had errors (non-fatal)");
});

export default app;
