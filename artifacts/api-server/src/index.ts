import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { getRollfiConfig } from "./lib/rollfi-config.js";
import { loadRollfiStateFromDb } from "./lib/rollfi-persist.js";
import { loadTimesheetEntriesFromDb } from "./lib/easyteam-persist.js";
import { loadUserAccountsFromDb, reconcileEmployeeLoginAccounts, migrateManagerAccountsToOwner } from "./lib/user-account-persist.js";
import { registerEmployeeInEasyTeam } from "./lib/easyteam-employee-sync.js";
import { resolveCompanyLocationId } from "./lib/location.js";
import { store } from "./store.js";
import { db, companies, employees } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * connect-pg-simple's `createTableIfMissing` reads a `table.sql` file from disk.
 * esbuild doesn't copy that file, so it fails in production with ENOENT.
 * We create the session table ourselves instead.
 */
async function bootSessionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid"    varchar      NOT NULL COLLATE "default",
      "sess"   json         NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`);
  logger.info("Session table ready");
}

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
    rollfiLocationId: "LOC-SUNSHINE",
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
    rollfiLocationId: "LOC-RAINBOW",
    payScheduleAdded: true,
    payFrequency: "BiWeekly",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
] as const;

async function bootSeedCompanies() {
  let seeded = 0;
  for (const seed of SEED_COMPANIES) {
    const [existing] = await db
      .select({ id: companies.id, rollfiLocationId: companies.rollfiLocationId })
      .from(companies)
      .where(eq(companies.id, seed.id));
    if (!existing) {
      await db.insert(companies).values(seed as typeof companies.$inferInsert);
      seeded++;
    } else if (!existing.rollfiLocationId && seed.rollfiLocationId) {
      // Backfill the location id on pre-existing seeded rows so the unified resolver works.
      await db.update(companies).set({ rollfiLocationId: seed.rollfiLocationId }).where(eq(companies.id, seed.id));
    }
  }
  if (seeded > 0) logger.info({ seeded }, "Boot-seeded companies into DB");
}

/**
 * Seed the static demo staff (Sunshine + Rainbow employees) into the unified DB
 * `employees` table. IDs are aligned to each testUser's employeeId so JWTs and the
 * EasyTeam UUID mapping resolve to the same person. Idempotent via onConflictDoNothing.
 */
async function bootSeedEmployees() {
  const staff = store
    .getAllStaffUsers()
    .filter((u) => u.role === "employee" && u.employeeId && store.getCompany(u.companyId)?.type === "daycare");

  const now = new Date().toISOString();
  let seeded = 0;
  for (const u of staff) {
    const [first, ...rest] = u.name.trim().split(" ");
    const last = rest.join(" ") || first;
    try {
      const inserted = await db
        .insert(employees)
        .values({
          id: u.employeeId!,
          companyId: u.companyId,
          firstName: first,
          lastName: last,
          email: u.email,
          position: u.position,
          startDate: "2024-01-01",
          payType: "hourly",
          hourlyWage: u.hourlyWage ?? 1500,
          status: "active",
          easyteamSynced: false,
          syncStatus: "pending",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: employees.id });
      if (inserted.length > 0) seeded++;
    } catch (err) {
      logger.warn({ err, employeeId: u.employeeId }, "Boot seed employee failed");
    }
  }
  if (seeded > 0) logger.info({ seeded }, "Boot-seeded staff into DB employees");
}

/**
 * Register every active DB employee in EasyTeam (token exchange upserts the employee)
 * and map the returned EasyTeam UUID back to our canonical employee id. Operates over
 * the unified employees table, so both seeded staff and wizard-created employees are covered.
 */
async function bootEasyTeamSync() {
  const allEmployees = await db.select().from(employees).catch(() => []);
  let registered = 0;
  let skipped = 0;

  for (const emp of allEmployees) {
    if (emp.status !== "active") { skipped++; continue; }
    const locationId = await resolveCompanyLocationId(emp.companyId);
    const result = await registerEmployeeInEasyTeam(
      {
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        email: emp.email,
        roleName: emp.position,
        wage: (emp.hourlyWage ?? 1500) / 100,
        wageType: "hourly",
      },
      locationId,
      logger
    );
    if (result.success && result.easyteamEmployeeId) {
      store.setEasyTeamUuidMapping(result.easyteamEmployeeId, emp.id);
      registered++;
      logger.info({ employeeId: emp.id, companyId: emp.companyId, easyteamUuid: result.easyteamEmployeeId }, "Boot sync: employee registered in EasyTeam");
    } else {
      skipped++;
      logger.warn({ employeeId: emp.id, reason: result.error }, "Boot sync: EasyTeam registration pending — employee will appear after first Time Clock use");
    }
  }

  logger.info({ registered, skipped }, "Boot EasyTeam sync complete");
}

/**
 * Log the active Rollfi environment and assert coherence with the database tier.
 *
 * Coherence rule:
 *   ROLLFI_ENV=production  →  DATABASE_ENV must also equal "production"
 *   ROLLFI_ENV=sandbox     →  DATABASE_ENV should NOT be "production"
 *
 * Set DATABASE_ENV=production in the deployed environment alongside the prod
 * DATABASE_URL so this check can distinguish the two tiers. The app does NOT
 * hard-block on mismatch — it logs a FATAL-level warning and continues, because
 * blocking boot on a misconfigured env var would make recovery harder.
 */
function assertEnvCoherence() {
  const cfg = getRollfiConfig();
  const dbEnv = (process.env.DATABASE_ENV ?? "").trim().toLowerCase();
  const dbUrl = process.env.DATABASE_URL ?? "";

  // Infer DB tier: explicit flag wins; fall back to URL hostname pattern.
  const dbLooksLikeProd =
    dbEnv === "production" ||
    /prod(?:uction)?[.\-_]/i.test(dbUrl) ||
    /[.\-_]prod(?:uction)?/i.test(dbUrl);

  const rollfiIsProd = cfg.env === "production";

  // Emit the mandatory boot status line (always, regardless of match).
  logger.info(
    {
      rollfiEnv: cfg.env,
      dbEnv: dbEnv || "unset",
      dbLooksLikeProd,
      rollfiBaseUrl: cfg.baseUrl,
      rollfiCredentials: cfg.credentialsPresent ? "present" : "missing",
    },
    `Rollfi env: ${cfg.env} | DB tier: ${dbLooksLikeProd ? "production" : "dev/sandbox"}`,
  );

  if (rollfiIsProd && !dbLooksLikeProd) {
    process.stderr.write(
      "[FATAL] Environment coherence mismatch: ROLLFI_ENV=production but DATABASE_ENV is not set to 'production' " +
      "and DATABASE_URL does not appear to be a production host. " +
      "This risks real-money Rollfi calls against the development database. " +
      "Set DATABASE_ENV=production in the deployed environment to confirm the DB tier, or unset ROLLFI_ENV to use sandbox.\n",
    );
    logger.error(
      { rollfiEnv: cfg.env, dbEnv: dbEnv || "unset" },
      "FATAL: prod Rollfi + non-prod DB — real-money risk. Set DATABASE_ENV=production or revert ROLLFI_ENV.",
    );
  }

  if (!rollfiIsProd && dbLooksLikeProd) {
    logger.warn(
      { rollfiEnv: cfg.env, dbEnv: dbEnv || "unset" },
      "Warning: sandbox Rollfi is pointed at a database that looks like production. Confirm DATABASE_ENV is correct.",
    );
  }
}

// Start listening immediately so the healthcheck always responds during boot.
// Boot tasks run in the background — the server is functional before they finish.
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  assertEnvCoherence();

  // Run all boot tasks in the background after the server is up.
  Promise.all([
    bootSessionTable(),
    bootSeedCompanies().then(() => bootSeedEmployees()),
    loadRollfiStateFromDb().then(({ companies, employees }) => {
      logger.info({ companies, employees }, "Rollfi state restored from DB");
    }),
    loadTimesheetEntriesFromDb().then((count) => {
      logger.info({ count }, "EasyTeam timesheet entries restored from DB");
    }),
    loadUserAccountsFromDb().then(({ count }) => {
      logger.info({ count }, "User accounts restored from DB");
      return migrateManagerAccountsToOwner().then(({ upgraded }) => {
        if (upgraded > 0) logger.info({ upgraded }, "Boot migration: manager accounts upgraded to owner");
        return reconcileEmployeeLoginAccounts().then(({ created }) => {
          if (created > 0) logger.info({ created }, "Reconciled missing employee login accounts");
        });
      });
    }),
  ])
    .catch((err) => {
      logger.warn({ err }, "Could not fully load state from DB — starting with partial state");
    })
    .then(() => {
      bootEasyTeamSync().catch((e) => {
        logger.warn({ err: e }, "Boot EasyTeam sync failed — employees will register on first Time Clock use");
      });
    });
});
