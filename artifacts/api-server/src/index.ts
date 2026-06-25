import app from "./app";
import { logger } from "./lib/logger";
import { loadRollfiStateFromDb } from "./lib/rollfi-persist.js";
import { loadTimesheetEntriesFromDb } from "./lib/easyteam-persist.js";
import { loadClientEmployeesFromDb } from "./lib/client-employee-persist.js";
import { loadUserAccountsFromDb, reconcileEmployeeLoginAccounts } from "./lib/user-account-persist.js";
import { registerEmployeeInEasyTeam } from "./lib/easyteam-employee-sync.js";
import { store } from "./store.js";
import { db, companies } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SEED_COMPANIES = [
  {
    id: "ORG-SUNSHINE",
    name: "Sunshine Daycare Centre",
    phone: "9733330001",
    industry: "daycare",
    package: "full_daycare",
    status: "active",
    address1: "123 Main St",
    city: "Newark",
    state: "NJ",
    zipcode: "07101",
    locationName: "Sunshine Daycare Centre",
    payScheduleAdded: true,
    payFrequency: "BiWeekly",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "ORG-RAINBOW",
    name: "Rainbow Kids Daycare",
    phone: "2013330001",
    industry: "daycare",
    package: "full_daycare",
    status: "active",
    address1: "456 Oak Ave",
    city: "Jersey City",
    state: "NJ",
    zipcode: "07302",
    locationName: "Rainbow Kids Daycare",
    payScheduleAdded: true,
    payFrequency: "BiWeekly",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
] as const;

async function bootSeedCompanies() {
  let seeded = 0;
  for (const seed of SEED_COMPANIES) {
    const [existing] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, seed.id));
    if (!existing) {
      await db.insert(companies).values(seed as typeof companies.$inferInsert);
      seeded++;
    }
  }
  if (seeded > 0) logger.info({ seeded }, "Boot-seeded companies into DB");
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
        if (result.easyteamEmployeeId) {
          const staffUser = store.getAllStaffUsers().find((u) => u.email === emp.email);
          const internalEmpId = staffUser?.employeeId ?? emp.id;
          store.setEasyTeamUuidMapping(result.easyteamEmployeeId, internalEmpId);
        }
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
  bootSeedCompanies(),
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
    // Reconcile: create missing logins for any DB employee that has no user_accounts row
    return reconcileEmployeeLoginAccounts().then(({ created }) => {
      if (created > 0) logger.info({ created }, "Reconciled missing employee login accounts");
    });
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
