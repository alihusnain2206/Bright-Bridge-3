import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { getRollfiConfig } from "./lib/rollfi-config.js";
import { loadRollfiStateFromDb } from "./lib/rollfi-persist.js";
import { loadTimesheetEntriesFromDb } from "./lib/easyteam-persist.js";
import { loadUserAccountsFromDb, reconcileEmployeeLoginAccounts } from "./lib/user-account-persist.js";
import { restoreActivityFromDb } from "./store.js";
import { registerEmployeeInEasyTeam } from "./lib/easyteam-employee-sync.js";
import { resolveCompanyLocationId } from "./lib/location.js";
import { store } from "./store.js";
import { db, companies, employees, rollfiEmployeeRecords, locations as locationsTable } from "@workspace/db";
import { userAccounts } from "@workspace/db/schema";
import { eq, isNull, isNotNull, and, or } from "drizzle-orm";

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

/**
 * Phase 3 location schema migration.
 * Adds is_primary, latitude, longitude columns to the locations table.
 * Backfills is_primary (earliest active row per company) and known coordinates.
 * Safe to run on every boot — IF NOT EXISTS / WHERE guards prevent re-execution.
 */
async function bootPhase3LocationSchema() {
  try {
    // Add columns — safe to re-run on every boot
    await pool.query(`
      ALTER TABLE locations
        ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS latitude   REAL,
        ADD COLUMN IF NOT EXISTS longitude  REAL;
    `);

    // Backfill is_primary: mark the earliest-created active row per company
    await pool.query(`
      UPDATE locations
      SET is_primary = TRUE
      WHERE id IN (
        SELECT DISTINCT ON (company_id) id
        FROM locations
        WHERE is_active = TRUE
        ORDER BY company_id, created_at ASC
      )
      AND is_primary = FALSE;
    `);

    // Backfill known seeded-company coordinates
    await pool.query(`UPDATE locations SET latitude = 40.7357, longitude = -74.1724 WHERE id = 'LOC-SUNSHINE' AND (latitude IS NULL OR longitude IS NULL);`);
    await pool.query(`UPDATE locations SET latitude = 40.7178, longitude = -74.0431 WHERE id = 'LOC-RAINBOW'  AND (latitude IS NULL OR longitude IS NULL);`);

    logger.info("Boot: bootPhase3LocationSchema complete (is_primary, latitude, longitude)");
  } catch (err) {
    logger.warn({ err }, "Boot: bootPhase3LocationSchema failed (non-fatal)");
  }
}

/**
 * Backfill user_accounts.location_id from linked employees.location_id.
 * Runs after bootAssignEmployeeLocations so employees always have a locationId.
 * Safe to re-run — WHERE location_id IS NULL guards prevent overwriting manual assignments.
 */
async function bootBackfillUserAccountLocations() {
  try {
    const result = await pool.query(`
      UPDATE user_accounts ua
      SET    location_id = e.location_id
      FROM   employees e
      WHERE  ua.employee_id    = e.id
        AND  ua.location_id   IS NULL
        AND  e.location_id    IS NOT NULL;
    `);
    const count = (result as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Boot: bootBackfillUserAccountLocations — backfilled location_id from employees table");
    } else {
      logger.info("Boot: bootBackfillUserAccountLocations no-op — all user_accounts already have location_id or no matching employees");
    }
  } catch (err) {
    logger.warn({ err }, "Boot: bootBackfillUserAccountLocations failed (non-fatal)");
  }
}

async function bootCompanySignedFormsSchema() {
  // Add signature_image column introduced for drawn-signature support.
  // Safe to run on every boot — IF NOT EXISTS guards prevent duplicate columns.
  await pool.query(`
    ALTER TABLE company_signed_forms
      ADD COLUMN IF NOT EXISTS signature_image text;
  `).catch(() => {
    // Table may not exist yet (first boot before Drizzle push) — safe to ignore.
  });
}

/**
 * Add easyteam_org_id to the companies table (introduced when per-company EasyTeam orgs
 * were implemented). Safe to run on every boot — ADD COLUMN IF NOT EXISTS is idempotent.
 * Also backfills the one company (ORG-SUNSHINE) that had its org ID confirmed before
 * this column existed; all other companies keep NULL and resolve to ORG-BRIGHTBRIDGE.
 */
async function bootEasyteamOrgIdMigration() {
  await pool.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS easyteam_org_id TEXT;
  `).catch(() => {
    // Table may not exist on first boot — safe to ignore.
  });
  // Backfill Sunshine's known org ID so the resolver doesn't fall back to ORG-BRIGHTBRIDGE.
  await pool.query(`
    UPDATE companies
    SET easyteam_org_id = 'ORG-SUNSHINE'
    WHERE id = 'ORG-SUNSHINE'
      AND easyteam_org_id IS NULL;
  `).catch(() => {/* non-fatal */});
}

/**
 * Add easyteam_external_key to the locations table.
 * This column holds the mutable external key used in EasyTeam JWT locationId claims.
 * It defaults to NULL (resolver falls back to locations.id) for existing rows, and is
 * set explicitly on insert for new rows.  The repair endpoint sets it to a fresh UUID
 * to re-register a broken location under the correct org without deleting the row.
 * Safe to run on every boot — ADD COLUMN IF NOT EXISTS is idempotent.
 */
async function bootEasyteamExternalKeyMigration() {
  try {
    await pool.query(`
      ALTER TABLE locations
        ADD COLUMN IF NOT EXISTS easyteam_external_key TEXT;
    `);
    logger.info("Boot: bootEasyteamExternalKeyMigration complete (easyteam_external_key)");
  } catch (err) {
    logger.warn({ err }, "Boot: bootEasyteamExternalKeyMigration failed (non-fatal)");
  }
}

async function bootIgnoredEtUuids() {
  // Create table if not yet present (original schema: et_uuid as PK)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS easyteam_ignored_uuids (
      et_uuid     text        PRIMARY KEY,
      company_id  text,
      reason      text,
      ignored_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Migrate to composite-keyed blocklist so one company cannot blocklist a UUID
  // on behalf of another company. We drop the single-column PK, add a surrogate
  // bigserial PK, and add a composite UNIQUE(et_uuid, company_id) constraint.
  // The DO block is idempotent — safe to run on every boot after migration.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'easyteam_ignored_uuids'
          AND constraint_name = 'easyteam_ignored_uuids_company_uuid_key'
      ) THEN
        ALTER TABLE easyteam_ignored_uuids DROP CONSTRAINT IF EXISTS easyteam_ignored_uuids_pkey;
        ALTER TABLE easyteam_ignored_uuids ADD COLUMN IF NOT EXISTS id bigserial;
        BEGIN
          ALTER TABLE easyteam_ignored_uuids ADD CONSTRAINT easyteam_ignored_uuids_pkey PRIMARY KEY (id);
        EXCEPTION WHEN duplicate_table THEN NULL; END;
        ALTER TABLE easyteam_ignored_uuids
          ADD CONSTRAINT easyteam_ignored_uuids_company_uuid_key UNIQUE (et_uuid, company_id);
      END IF;
    END $$;
  `);

  // Load into company-scoped in-memory map. Rows without company_id (legacy)
  // go under the global fallback key so they still take effect during sync.
  const { rows } = await pool.query<{ et_uuid: string; company_id: string | null }>(
    `SELECT et_uuid, company_id FROM easyteam_ignored_uuids`
  );
  for (const row of rows) store.ignoreEasyTeamUuid(row.et_uuid, row.company_id ?? undefined);
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
  // (removed — ORG-SUNSHINE now has its own dedicated EasyTeam org; old-org UUIDs
  //  are obsolete.  Boot Phase 2 re-registers all Sunshine employees under the new
  //  org at every cold start; live token exchanges keep the map current thereafter.)
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
      emp.companyId,
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
 * One-time idempotent repair: Leticia Anderson was added to Urban Concepts during the first
 * failed wizard attempt (creating orphaned company ORG-MSDK0754-QRO44V), so her login
 * (USER-DYN-EMP-MSDKARCE-A4B11X / EMP-MSDKARCE-A4B11X) is bound to the wrong company.
 * A duplicate employee (EMP-MSG96YBV-MX9JE9) was created during the second (successful) wizard
 * run and holds the real Rollfi payroll record for Urban Concepts.
 *
 * Fix: move EMP-MSDKARCE-A4B11X to Urban Concepts, transfer the Rollfi record, delete the
 * duplicate, and reload the in-memory staff user so the next JWT uses the correct location.
 *
 * Guard: runs only while EMP-MSDKARCE-A4B11X is still associated with the orphaned company.
 */
async function bootRepairLeticiaDuplicateEmployee() {
  const CANONICAL_ID = "EMP-MSDKARCE-A4B11X";
  const DUPLICATE_ID = "EMP-MSG96YBV-MX9JE9";
  const ORPHAN_COMPANY = "ORG-MSDK0754-QRO44V";
  const URBAN_CONCEPTS = "ORG-MSG8W5WM-G6PNF1";
  const USER_ACCOUNT_ID = "USER-DYN-EMP-MSDKARCE-A4B11X";

  try {
    // Guard: only run if the canonical employee is still at the orphaned company
    const [canonical] = await db
      .select({ companyId: employees.companyId })
      .from(employees)
      .where(eq(employees.id, CANONICAL_ID));

    if (!canonical || canonical.companyId !== ORPHAN_COMPANY) {
      // Already fixed or canonical record doesn't exist — nothing to do
      return;
    }

    logger.info({ CANONICAL_ID, DUPLICATE_ID }, "Boot repair: fixing Leticia duplicate employee — migrating to Urban Concepts");

    // 1. Move canonical employee to Urban Concepts
    await db.update(employees)
      .set({ companyId: URBAN_CONCEPTS })
      .where(eq(employees.id, CANONICAL_ID));

    // 2. Move login account to Urban Concepts
    await db.update(userAccounts)
      .set({ companyId: URBAN_CONCEPTS })
      .where(eq(userAccounts.id, USER_ACCOUNT_ID));

    // 3. Transfer Rollfi payroll record from duplicate → canonical (so payroll still works)
    await db.update(rollfiEmployeeRecords)
      .set({ employeeId: CANONICAL_ID })
      .where(eq(rollfiEmployeeRecords.employeeId, DUPLICATE_ID));

    // 3b. Write the Rollfi user ID back to the canonical employees master row.
    //     The boot repair previously only updated rollfi_employee_records but not employees.rollfi_user_id,
    //     causing the People Hub to show "Not set up" despite the normalized record being present.
    const [transferred] = await db
      .select({ rollfiUserId: rollfiEmployeeRecords.rollfiUserId })
      .from(rollfiEmployeeRecords)
      .where(eq(rollfiEmployeeRecords.employeeId, CANONICAL_ID));
    if (transferred?.rollfiUserId) {
      await db.update(employees)
        .set({ rollfiUserId: transferred.rollfiUserId, updatedAt: new Date().toISOString() })
        .where(eq(employees.id, CANONICAL_ID));
    }

    // 4. Delete the duplicate employee row (same email + same easyteam_uuid)
    await db.delete(employees).where(eq(employees.id, DUPLICATE_ID));

    // 5. Reload the in-memory staff user so the next JWT reflects Urban Concepts
    const staffUser = store.getAllStaffUsers().find((u) => u.employeeId === CANONICAL_ID);
    if (staffUser) {
      (staffUser as Record<string, unknown>).companyId = URBAN_CONCEPTS;
    }

    logger.info(
      { CANONICAL_ID, URBAN_CONCEPTS },
      "Boot repair: Leticia duplicate resolved — login now bound to Urban Concepts"
    );
  } catch (err) {
    logger.warn({ err }, "Boot repair: Leticia duplicate fix failed (non-fatal — will retry on next restart)");
  }
}

/**
 * One-time idempotent boot migration: for every employee where employees.rollfi_user_id is null
 * but rollfi_employee_records holds a Rollfi ID, write the ID back to the master row.
 *
 * Covers two known data-gap patterns:
 *  1. Boot repair gap — bootRepairLeticiaDuplicateEmployee transferred the Rollfi record to
 *     rollfi_employee_records but did not write back to employees.rollfi_user_id (now fixed in
 *     the repair itself, but this catches any existing rows from before the fix).
 *  2. Test-company seed gap — ORG-RAINBOW / ORG-SUNSHINE employees created before the master-row
 *     write path was in place.
 *
 * Safe to run on every boot: the WHERE clause ensures only null rows are updated, and the RETURNING
 * log confirms exactly which employees were touched.
 */
/**
 * One-time boot cleanup: remove the orphan company ORG-MSDK0754-QRO44V and its only
 * remnant employee row (Joanne Indiviglio EMP-MSDRL319-4RI3XM).
 * This company has zero references from any other table and was approved for deletion.
 * Idempotent: no-ops when the company row is already gone.
 */
async function bootCleanOrphanCompany() {
  const ORPHAN_CO  = "ORG-MSDK0754-QRO44V";
  const ORPHAN_EMP = "EMP-MSDRL319-4RI3XM";
  try {
    const [existing] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, ORPHAN_CO));
    if (!existing) {
      logger.info({ ORPHAN_CO }, "Boot cleanup: orphan company already removed — nothing to do");
      return;
    }
    await db.delete(rollfiEmployeeRecords).where(eq(rollfiEmployeeRecords.employeeId, ORPHAN_EMP));
    await db.delete(employees).where(eq(employees.id, ORPHAN_EMP));
    await db.delete(userAccounts).where(eq(userAccounts.companyId, ORPHAN_CO));
    await db.delete(companies).where(eq(companies.id, ORPHAN_CO));
    logger.info({ ORPHAN_CO, ORPHAN_EMP }, "Boot cleanup: orphan company and remnant employee deleted");
  } catch (err) {
    logger.warn({ err }, "Boot cleanup: orphan company deletion failed (non-fatal)");
  }
}

async function bootBackfillRollfiUserIds() {
  try {
    // Find employees with no rollfi_user_id (null or empty string) but a matching rollfi_employee_records row
    const gaps = await db
      .select({ empId: employees.id, rollfiUserId: rollfiEmployeeRecords.rollfiUserId, firstName: employees.firstName, lastName: employees.lastName, companyId: employees.companyId })
      .from(employees)
      .innerJoin(rollfiEmployeeRecords, eq(rollfiEmployeeRecords.employeeId, employees.id))
      .where(or(isNull(employees.rollfiUserId), eq(employees.rollfiUserId, "")));

    if (gaps.length === 0) {
      logger.info("Boot backfill: all employees already have rollfi_user_id — nothing to do");
      return;
    }

    let fixed = 0;
    for (const gap of gaps) {
      await db.update(employees)
        .set({ rollfiUserId: gap.rollfiUserId, updatedAt: new Date().toISOString() })
        .where(and(eq(employees.id, gap.empId), isNull(employees.rollfiUserId)));
      logger.info({ empId: gap.empId, name: `${gap.firstName} ${gap.lastName}`, companyId: gap.companyId, rollfiUserId: gap.rollfiUserId }, "Boot backfill: wrote rollfi_user_id to employees master row");
      fixed++;
    }

    logger.info({ fixed, total: gaps.length }, "Boot backfill: rollfi_user_id backfill complete");
  } catch (err) {
    logger.warn({ err }, "Boot backfill: rollfi_user_id backfill failed (non-fatal)");
  }
}

/**
 * Seed one locations row per company that doesn't already have one.
 * Safe to run on every boot — skips companies that already have a row.
 * Uses resolveCompanyLocationId so the seeded easyteamLocationId is identical
 * to what all existing callers (EasyTeam, Rollfi, JWTs) already use.
 */
async function bootSeedLocations() {
  try {
    const allCompanies = await db.select({
      id: companies.id,
      name: companies.name,
      locationName: companies.locationName,
      address1: companies.address1,
      address2: companies.address2,
      city: companies.city,
      state: companies.state,
      zipcode: companies.zipcode,
      rollfiLocationId: companies.rollfiLocationId,
    }).from(companies);

    let seeded = 0;
    for (const co of allCompanies) {
      const existing = await db.select({ id: locationsTable.id })
        .from(locationsTable).where(eq(locationsTable.companyId, co.id));
      if (existing.length > 0) continue;

      const etLocId = await resolveCompanyLocationId(co.id);
      await db.insert(locationsTable).values({
        id: etLocId,
        companyId: co.id,
        code: "100",
        name: co.locationName ?? co.name ?? co.id,
        address1: co.address1 ?? "",
        address2: co.address2 ?? null,
        city: co.city ?? "",
        state: co.state ?? "",
        zipcode: co.zipcode ?? "",
        easyteamLocationId: etLocId,
        rollfiLocationId: co.rollfiLocationId ?? null,
        isActive: true,
        createdAt: new Date().toISOString(),
      }).onConflictDoNothing();
      logger.info({ companyId: co.id, locationId: etLocId }, "Boot: seeded location for company");
      seeded++;
    }
    if (seeded > 0) logger.info({ seeded }, "Boot: bootSeedLocations complete");
    else logger.info("Boot: bootSeedLocations no-op — all companies already have location rows");
  } catch (err) {
    logger.warn({ err }, "Boot: bootSeedLocations failed (non-fatal)");
  }
}

/**
 * Assign a locationId to every employee row that doesn't have one.
 * Runs after bootSeedLocations so location rows are guaranteed to exist.
 * Safe to run on every boot — WHERE locationId IS NULL guards are idempotent.
 */
async function bootAssignEmployeeLocations() {
  try {
    const empsWithout = await db
      .select({ id: employees.id, companyId: employees.companyId })
      .from(employees)
      .where(isNull(employees.locationId));

    if (empsWithout.length === 0) {
      logger.info("Boot: bootAssignEmployeeLocations no-op — all employees already have locationId");
      return;
    }

    const allLocs = await db
      .select({ id: locationsTable.id, companyId: locationsTable.companyId })
      .from(locationsTable)
      .where(eq(locationsTable.isActive, true));
    const locByCompany = new Map(allLocs.map((l) => [l.companyId, l.id]));

    const now = new Date().toISOString();
    let fixed = 0;
    for (const emp of empsWithout) {
      const locId = locByCompany.get(emp.companyId);
      if (!locId) {
        logger.warn({ empId: emp.id, companyId: emp.companyId }, "Boot: no location row found for employee — skipping");
        continue;
      }
      await db.update(employees)
        .set({ locationId: locId, updatedAt: now })
        .where(and(eq(employees.id, emp.id), isNull(employees.locationId)));
      fixed++;
    }
    logger.info({ fixed, total: empsWithout.length }, "Boot: bootAssignEmployeeLocations complete");
  } catch (err) {
    logger.warn({ err }, "Boot: bootAssignEmployeeLocations failed (non-fatal)");
  }
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
    bootSessionTable().then(() => bootIgnoredEtUuids()).then(() => bootCompanySignedFormsSchema()).then(() => bootEasyteamOrgIdMigration()).then(() => bootEasyteamExternalKeyMigration()),
    // Phase 3: run schema migration FIRST so is_primary/lat/lng columns exist before seeding
    bootPhase3LocationSchema()
      .then(() => bootSeedCompanies())
      .then(() => bootSeedEmployees())
      .then(() => bootSeedLocations())
      .then(() => bootAssignEmployeeLocations())
      .then(() => bootBackfillUserAccountLocations()),
    loadRollfiStateFromDb().then(({ companies, employees }) => {
      logger.info({ companies, employees }, "Rollfi state restored from DB");
    }),
    restoreActivityFromDb().then(({ count }) => {
      logger.info({ count }, "Activity log restored from DB");
    }),
    loadTimesheetEntriesFromDb().then((count) => {
      logger.info({ count }, "EasyTeam timesheet entries restored from DB");
    }),
    loadUserAccountsFromDb().then(({ count }) => {
      logger.info({ count }, "User accounts restored from DB");
      // migrateManagerAccountsToOwner() removed — see user-account-persist.ts for history.
      return reconcileEmployeeLoginAccounts().then(({ created }) => {
        if (created > 0) logger.info({ created }, "Reconciled missing employee login accounts");
      });
    }),
    bootRepairLeticiaDuplicateEmployee(),
    bootBackfillRollfiUserIds(),
    bootCleanOrphanCompany(),
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
