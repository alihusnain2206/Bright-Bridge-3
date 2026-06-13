import app from "./app";
import { logger } from "./lib/logger";
import { loadRollfiStateFromDb } from "./lib/rollfi-persist.js";
import { loadTimesheetEntriesFromDb } from "./lib/easyteam-persist.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

Promise.all([
  loadRollfiStateFromDb().then(({ companies, employees }) => {
    logger.info({ companies, employees }, "Rollfi state restored from DB");
  }),
  loadTimesheetEntriesFromDb().then((count) => {
    logger.info({ count }, "EasyTeam timesheet entries restored from DB");
  }),
])
  .catch((err) => {
    logger.warn({ err }, "Could not fully load state from DB — starting with partial state");
  })
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  });
