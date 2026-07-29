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
import { eq, isNull, isNotNull, and } from "drizzle-orm";

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

async function bootIgnoredEtUuids() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS easyteam_ignored_uuids (
      et_uuid     text        PRIMARY KEY,
      company_id  text,
      reason      text,
      ignored_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query<{ et_uuid: string }>(`SELECT et_uuid FROM easyteam_ignored_uuids`);
  for (const row of rows) store.ignoreEasyTeamUuid(row.et_uuid);
  if (rows.length > 0) logger.info({ count: rows.length }, "Boot: loaded ignored EasyTeam UUIDs from DB");
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
 * Known EasyTeam UUID → internal employee ID pairs sourced from boot-sync logs.
 * Written to the DB once (WHERE easyteam_uuid IS NULL) so subsequent restarts
 * can skip the EasyTeam API call for these employees entirely.
 */
const KNOWN_EASYTEAM_UUIDS: Array<{ empId: string; uuid: string }> = [
  // ── Sunshine Daycare ──────────────────────────────────────────────────
  { empId: "EMP-SUNSHINE-001",        uuid: "f765647e-0a5c-495b-9c14-984f7ae4d0e5" }, // John Smith
  { empId: "EMP-MS1JLSXM-3TOPI7",    uuid: "245d3a22-4746-415c-998d-cbcb8882b06a" }, // Diane Whitfield ← backfill target
  { empId: "EMP-MRRHGO5L-EHDBJT",    uuid: "ad0f22b2-844e-4af7-b8f5-a7eabf11c745" },
  { empId: "EMP-MRRHXI99-50CHVE",    uuid: "456a78a8-7f72-446c-922f-2537404b7801" },
  { empId: "EMP-MRRHG3RE-3I7B4E",    uuid: "6c89a2e5-d9f4-419b-9aaf-b6c11f437870" },
  { empId: "EMP-MS0P5SKC-8D36M7",    uuid: "6f12162f-e815-49ca-8e6c-8059f81876dc" },
  // ── Rainbow Kids Daycare ──────────────────────────────────────────────
  { empId: "EMP-RAINBOW-001",         uuid: "ad989af3-6bff-42c9-a619-53ca102f0324" },
  { empId: "EMP-RAINBOW-002",         uuid: "a9a0b3ff-03b5-49fb-a2dd-e010ea9c7d93" },
  { empId: "EMP-RAINBOW-003",         uuid: "2639c543-0cbc-4c5c-9398-3ff2de95e8dd" },
  { empId: "EMP-RAINBOW-004",         uuid: "5520ec5b-2adc-479d-ab86-df2483095316" },
  // ── Wizard-created (other companies) — from prod boot-sync log ────────
  { empId: "EMP-MR37SQ41-GMTXD2",    uuid: "607de703-7a8a-4dc0-a21e-dd80d3fcb4c4" },
  { empId: "EMP-MR3D1EE5-7D23YX",    uuid: "1a018728-1cb9-46c8-9cb0-5d0c013171af" },
  { empId: "EMP-MQUXH3H3-L41PLP",    uuid: "9a18f330-54f2-4e6b-8522-ac8e864268b6" },
  { empId: "EMP-MRXFP6YL-LXKTVA",    uuid: "d8475b33-ee79-4115-8a15-4b18041d7ca7" },
  { empId: "EMP-MRXAETS3-MU0A06",    uuid: "8cb041e1-ed7c-43c0-92e8-3b8d9b458e8b" },
  { empId: "EMP-MR2CVXEL-5JVF6Y",    uuid: "7a9ec195-cf85-43ae-b782-6ef075001b6e" },
  { empId: "EMP-MRXRDKEX-VEO5R3",    uuid: "3b202e3a-6295-49dd-8841-65367dcf2d1f" },
  { empId: "EMP-MRXGBY5V-TIF7R9",    uuid: "a7383351-b9e1-4a17-a512-568c5afc59c6" },
  { empId: "EMP-MRYMS1FF-SV5N88",    uuid: "5655327a-978f-48b9-935d-932a9cd3d171" },
];

/**
 * One-time write of historically known UUID→employeeId pairs sourced from boot-sync
 * logs. Only updates rows whose easyteam_uuid column is currently null so it never
 * overwrites a fresher value from a live token exchange. Idempotent.
 */
async function bootBackfillKnownEasyTeamUuids(): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const { empId, uuid } of KNOWN_EASYTEAM_UUIDS) {
    try {
      const result = await db
        .update(employees)
        .set({ easyteamUuid: uuid, easyteamSynced: true })
        .where(and(eq(employees.id, empId), isNull(employees.easyteamUuid)))
        .returning({ id: employees.id });
      if (result.length > 0) {
        written++;
        logger.info({ empId, uuid }, "Boot backfill: wrote known EasyTeam UUID to DB");
      } else {
        skipped++; // row missing from this DB, or UUID already set
      }
    } catch (err) {
      logger.warn({ empId, err }, "Boot backfill: DB write failed (non-fatal)");
    }
  }
  return { written, skipped };
}

/**
 * Two-phase EasyTeam boot sync:
 *
 * Phase 0 — backfill historically known UUIDs into DB (idempotent, non-fatal).
 *
 * Phase 1 — read from DB (instant, no EasyTeam API calls):
 *   SELECT id, easyteam_uuid FROM employees WHERE easyteam_uuid IS NOT NULL
 *   Populates the in-memory map for ALL employees whose UUID is already stored.
 *   No status filter — onboarding employees who can clock in deserve matched hours.
 *
 * Phase 2 — API registration for employees with no UUID yet:
 *   Token-exchanges every employee whose easyteam_uuid column is null.
 *   registerEmployeeInEasyTeam persists the UUID to DB and updates the map internally.
 *   No status filter — an "onboarding" employee can clock in and must be matched.
 */
async function bootEasyTeamSync() {
  // ── Phase 0: backfill known UUIDs ──────────────────────────────────────
  const { written: backfilled, skipped: backfillSkipped } = await bootBackfillKnownEasyTeamUuids();
  if (backfilled > 0 || backfillSkipped > 0) {
    logger.info({ backfilled, backfillSkipped }, "Boot sync: backfill of known EasyTeam UUIDs complete");
  }

  // ── Phase 1: populate map from DB (no API calls) ───────────────────────
  const knownRows = await db
    .select({ id: employees.id, easyteamUuid: employees.easyteamUuid })
    .from(employees)
    .where(isNotNull(employees.easyteamUuid))
    .catch(() => []);

  let fromDb = 0;
  for (const row of knownRows) {
    if (row.easyteamUuid) {
      store.setEasyTeamUuidMapping(row.easyteamUuid, row.id);
      fromDb++;
    }
  }
  if (fromDb > 0) {
    logger.info({ fromDb }, "Boot sync: populated EasyTeam UUID map from DB — no API calls needed");
  }

  // ── Phase 2: register employees with no UUID yet ───────────────────────
  const unregistered = await db
    .select()
    .from(employees)
    .where(isNull(employees.easyteamUuid))
    .catch(() => []);

  let registered = 0;
  let failed = 0;

  for (const emp of unregistered) {
    // No status filter: an onboarding employee who can clock in must be matched.
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
    // registerEmployeeInEasyTeam handles store.setEasyTeamUuidMapping + DB persist internally.
    if (result.success && result.easyteamEmployeeId) {
      registered++;
      logger.info(
        { employeeId: emp.id, companyId: emp.companyId, status: emp.status, easyteamUuid: result.easyteamEmployeeId },
        "Boot sync: employee registered in EasyTeam"
      );
    } else {
      failed++;
      logger.warn(
        { employeeId: emp.id, status: emp.status, reason: result.error },
        "Boot sync: EasyTeam registration failed — will retry on next restart"
      );
    }
  }

  logger.info({ fromDb, registered, failed }, "Boot EasyTeam sync complete");
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

  if (process.env.NODE_ENV === "production" && !rollfiIsProd) {
    logger.warn(
      { rollfiEnv: cfg.env || "unset", nodeEnv: "production" },
      "Warning: NODE_ENV=production but ROLLFI_ENV is not set to 'production'. " +
      "All Rollfi calls will hit the sandbox. " +
      "Set ROLLFI_ENV=production in the production environment if this deployment should use real payroll.",
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
    bootSessionTable().then(() => bootIgnoredEtUuids()),
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
