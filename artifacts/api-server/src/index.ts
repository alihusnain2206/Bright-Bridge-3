import app from "./app";
import { logger } from "./lib/logger";
import { loadRollfiStateFromDb } from "./lib/rollfi-persist.js";
import { loadTimesheetEntriesFromDb } from "./lib/easyteam-persist.js";
import { loadClientEmployeesFromDb } from "./lib/client-employee-persist.js";
import { loadUserAccountsFromDb } from "./lib/user-account-persist.js";
import { registerEmployeeInEasyTeam } from "./lib/easyteam-employee-sync.js";
import { store } from "./store.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function bootEasyTeamSync() {
  const clients = store.listClients();
  let registered = 0;
  let skipped = 0;

  for (const client of clients) {
    const linkedCompanyId = client.linkedCompanyId;
    const company = linkedCompanyId ? store.getCompany(linkedCompanyId) : undefined;
    const locationId = company?.locationId;
    if (!locationId) continue;

    const emps = store.listEmployees(client.id).filter((e) => e.status === "active" && !e.easyteamSynced);
    for (const emp of emps) {
      const result = await registerEmployeeInEasyTeam(emp, locationId, logger);
      if (result.success) {
        store.updateEmployee(emp.id, { easyteamSynced: true });
        registered++;
        logger.info({ id: emp.id, name: emp.name, location: locationId }, "Boot sync: employee registered in EasyTeam");
      } else {
        skipped++;
        logger.warn({ id: emp.id, name: emp.name, reason: result.error }, "Boot sync: EasyTeam registration pending — employee will appear after first Time Clock use");
      }
    }
  }

  logger.info({ registered, skipped }, "Boot EasyTeam sync complete");
}

Promise.all([
  loadRollfiStateFromDb().then(({ companies, employees }) => {
    logger.info({ companies, employees }, "Rollfi state restored from DB");
  }),
  loadTimesheetEntriesFromDb().then((count) => {
    logger.info({ count }, "EasyTeam timesheet entries restored from DB");
  }),
  loadClientEmployeesFromDb().then(({ count }) => {
    logger.info({ count }, "ClientEmployee records restored from DB");
  }),
  loadUserAccountsFromDb().then(({ count }) => {
    logger.info({ count }, "User accounts restored from DB");
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

      // Run EasyTeam registration for all seeded/active employees after server is up
      bootEasyTeamSync().catch((e) => {
        logger.warn({ err: e }, "Boot EasyTeam sync failed — employees will register on first Time Clock use");
      });
    });
  });
