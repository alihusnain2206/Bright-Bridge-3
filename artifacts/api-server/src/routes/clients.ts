import { Router, type IRouter } from "express";
import { requireAuth, requireRole, assertCompanyAccess } from "../lib/auth-middleware.js";
import { store, type EmployeeStatus } from "../store";
import { syncEmployeeToIntegrations } from "../lib/employee-onboard.js";
import { persistUserAccount, deleteUserAccount } from "../lib/user-account-persist.js";
import { db, companies as companiesTable, employees as employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CompanyRow = {
  id: string;
  name: string;
  locationName: string | null;
  createdAt?: string | null;
  /** Populated for DB-persisted companies (wizard flow). Used as locationId fallback. */
  rollfiLocationId?: string | null;
};

/**
 * Project a DB company row to the legacy "Client" shape the frontend (and the generated
 * OpenAPI hooks `useListClients` / `useListClientEmployees`) expect. In the unified model a
 * client *is* a company, so clientId === companyId. Lat/long/timezone come from the in-memory
 * store location for the seeded demo companies; wizard-created companies use sensible defaults.
 */
function projectCompany(co: CompanyRow) {
  const storeCo = store.getCompany(co.id);
  // locationId is the EasyTeam / Rollfi *location* external ID (e.g. "LOC-SUNSHINE").
  // It must differ from the company/org ID ("ORG-SUNSHINE") — the EasyTeam launcher resolves
  // locations by their external ID, not the organisation ID.
  // Resolution order: in-memory store (seeded companies) → DB rollfiLocationId (wizard companies).
  const locationId = storeCo?.locationId ?? co.rollfiLocationId ?? null;
  return {
    id: co.id,
    name: co.name,
    locationName: co.locationName ?? storeCo?.name ?? co.name,
    latitude: storeCo?.latitude ?? 40.7128,
    longitude: storeCo?.longitude ?? -74.006,
    timezone: "America/New_York",
    createdAt: co.createdAt ?? new Date().toISOString(),
    linkedCompanyId: co.id,
    locationId,
  };
}

/** Project a DB employee row to the legacy "ClientEmployee" shape. */
function projectEmployee(e: typeof employeesTable.$inferSelect) {
  return {
    id: e.id,
    clientId: e.companyId,
    name: `${e.firstName} ${e.lastName}`.trim(),
    role: "employee",
    roleName: e.position,
    wage: e.hourlyWage,
    wageType: "hourly" as const,
    timeTrackingEnabled: true,
    email: e.email,
    status: e.status as EmployeeStatus,
    easyteamSynced: e.easyteamSynced,
    rollfiSynced: !!e.rollfiUserId,
    rollfiUserId: e.rollfiUserId ?? undefined,
    syncError: e.lastSyncError ?? undefined,
    createdAt: e.createdAt,
  };
}

// ── GET /clients ─────────────────────────────────────────────
// Returns all daycare clients: DB-persisted companies (wizard flow) merged with
// in-memory store companies that have a locationId (seeded demo daycares like
// Sunshine and Rainbow). Store companies are listed first; DB rows for the same
// ID take precedence and override the store entry. ORG-BRIGHTBRIDGE (HQ) is
// always excluded — it is not a daycare client.
router.get("/clients", requireAuth, async (_req, res) => {
  const rows: (typeof companiesTable.$inferSelect)[] = await db.select().from(companiesTable).catch(() => []);

  // Build a map of DB rows keyed by ID.
  // ORG-BRIGHTBRIDGE is excluded ONLY when it has no rollfiLocationId — i.e. it is
  // the bare seeded HQ record with no real EasyTeam location. When an owner has gone
  // through the company wizard their ORG-BRIGHTBRIDGE row gains a rollfiLocationId
  // and must appear in the clients list so Schedule / Time Clock can look it up.
  const dbMap = new Map(
    rows
      .filter((r) => r.id !== "ORG-BRIGHTBRIDGE" || !!r.rollfiLocationId)
      .map((r) => [r.id, r])
  );

  // Add seeded in-memory store daycare companies that are not already in the DB.
  // Only include companies that have a locationId — these are actual daycare sites.
  const storeCompanies = store.getCompanies?.() ?? [];
  for (const sc of storeCompanies) {
    if (!sc.locationId) continue;
    if (!dbMap.has(sc.id)) {
      // Project store company into the CompanyRow shape expected by projectCompany().
      dbMap.set(sc.id, {
        id: sc.id,
        name: sc.name,
        locationName: sc.name,
        createdAt: null,
        rollfiLocationId: sc.locationId,
      });
    }
  }

  const clients = Array.from(dbMap.values()).map(projectCompany);
  res.json({ clients });
});

// ── POST /clients (create) ───────────────────────────────────
// In the unified model a "client" IS a company, so this creates a DB company row and
// projects it back to the legacy Client shape. Retained for HTTP/Zod contract stability
// (the generated `useCreateClient` hook); the in-app wizard creates companies via POST /api/companies.
router.post("/clients", requireRole("super_admin"), async (req, res) => {
  const { name, locationName } = req.body as {
    name: string;
    locationName: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  if (!name || !locationName) {
    res.status(400).json({ error: "name and locationName are required" });
    return;
  }
  const id = `ORG-${uid().toUpperCase()}`;
  const now = new Date().toISOString();
  await db.insert(companiesTable).values({
    id,
    name,
    locationName,
    rollfiLocationId: `LOC-${id}`,
    createdAt: now,
    updatedAt: now,
  });
  const [saved] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  res.status(201).json(projectCompany(saved));
});

// ── DELETE /clients/:clientId ────────────────────────────────
// Removes the company (the unified "client"). The `client_employee_records` table is left
// in place per the data-retention requirement. Retained for contract stability.
router.delete("/clients/:clientId", requireRole("super_admin"), async (req, res) => {
  const { clientId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;
  const deleted = await db
    .delete(companiesTable)
    .where(eq(companiesTable.id, clientId))
    .returning({ id: companiesTable.id })
    .catch(() => []);
  if (deleted.length === 0) { res.status(404).json({ error: "Client not found" }); return; }

  // Cascade: remove the company's employees and their auto-created logins so deleting a client
  // doesn't orphan staff rows or leave usable login accounts behind. The client_employee_records
  // table is intentionally left untouched (data-retention requirement).
  const emps = await db.select().from(employeesTable).where(eq(employeesTable.companyId, clientId)).catch(() => []);
  for (const emp of emps) {
    if (!emp.email) continue;
    const loginUser = store.getUserByEmail(emp.email);
    if (loginUser) {
      store.deleteStaffUser(loginUser.id);
      await deleteUserAccount(loginUser.id).catch((err) =>
        req.log.warn({ err, email: emp.email }, "Failed to delete login account for removed client employee")
      );
    }
  }
  await db.delete(employeesTable).where(eq(employeesTable.companyId, clientId)).catch(() => { /* non-fatal */ });

  res.json({ deleted: true, id: clientId });
});

// ── GET /clients/by-company/:companyId ───────────────────────
router.get("/clients/by-company/:companyId", requireAuth, async (req, res) => {
  const { companyId } = req.params;
  if (!assertCompanyAccess(req, res, companyId)) return;
  const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
  if (co) { res.json(projectCompany(co)); return; }

  // Fall back to the in-memory store for companies that only live there.
  const storeCo = store.getCompany(companyId);
  if (storeCo) {
    res.json(projectCompany({ id: storeCo.id, name: storeCo.name, locationName: storeCo.name, createdAt: new Date().toISOString() }));
    return;
  }
  res.status(404).json({ error: "No client found for this company" });
});

// ── GET /clients/:clientId/employees ─────────────────────────
router.get("/clients/:clientId/employees", requireAuth, async (req, res) => {
  const { clientId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;
  const rows = await db.select().from(employeesTable).where(eq(employeesTable.companyId, clientId)).catch(() => []);
  res.json({ employees: rows.map(projectEmployee) });
});

// ── POST /clients/:clientId/employees (quick-add) ────────────
router.post("/clients/:clientId/employees", requireRole("super_admin", "owner"), async (req, res) => {
  const { clientId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;

  const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, clientId)).catch(() => [undefined]);
  const storeCo = store.getCompany(clientId);
  if (!co && !storeCo) { res.status(404).json({ error: "Client not found" }); return; }

  const { name, email, roleName, wage, status } = req.body as {
    name: string;
    email?: string;
    role?: string;
    roleName: string;
    wage?: number; // cents
    wageType?: string;
    timeTrackingEnabled?: boolean;
    status?: EmployeeStatus;
  };

  if (!name || !roleName) {
    res.status(400).json({ error: "name and roleName are required" });
    return;
  }

  const [first, ...rest] = name.trim().split(" ");
  const last = rest.join(" ") || first;
  const employeeId = `EMP-${uid().toUpperCase()}`;
  const hourlyWageCents = wage ?? 1500;
  const finalStatus: EmployeeStatus = status ?? "active";
  const now = new Date().toISOString();

  await db.insert(employeesTable).values({
    id: employeeId,
    companyId: clientId,
    firstName: first,
    lastName: last,
    email: email ?? "",
    position: roleName,
    startDate: now.split("T")[0],
    payType: "hourly",
    hourlyWage: hourlyWageCents,
    status: finalStatus,
    easyteamSynced: false,
    syncStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });

  let easyteamSynced = false;
  let rollfiSynced = false;
  let rollfiUserId: string | undefined;
  let syncError: string | undefined;

  if (finalStatus === "active") {
    const sync = await syncEmployeeToIntegrations(
      { id: employeeId, companyId: clientId, name, email: email ?? "", position: roleName, hourlyWageCents },
      req.log
    );
    easyteamSynced = sync.easyteamSynced;
    rollfiSynced = sync.rollfiSynced;
    rollfiUserId = sync.rollfiUserId;
    syncError = sync.syncError;

    const syncStatus = easyteamSynced && rollfiSynced ? "synced" : (easyteamSynced || rollfiSynced) ? "partial" : "pending";
    await db.update(employeesTable).set({
      easyteamSynced,
      rollfiUserId,
      rollfiOnboardedAt: rollfiSynced ? now : undefined,
      syncStatus,
      lastSyncError: syncError,
      updatedAt: new Date().toISOString(),
    }).where(eq(employeesTable.id, employeeId));
  }

  // Auto-create a login account if email is provided (and not already taken)
  let loginCreated = false;
  const loginPassword = "Staff123!";
  if (email && !store.getUserByEmail(email)) {
    store.addTestUser({
      id: `USER-DYN-${Date.now()}`,
      name,
      email,
      password: loginPassword,
      role: "employee",
      companyId: clientId,
      locationId: storeCo?.locationId,
      employeeId,
      position: roleName,
      hourlyWage: hourlyWageCents,
    });
    loginCreated = true;
    const newUser = store.getUserByEmail(email);
    if (newUser) await persistUserAccount(newUser).catch(() => { /* non-fatal */ });
  }

  const [saved] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  res.status(201).json({
    ...projectEmployee(saved),
    loginCreated,
    loginEmail: loginCreated ? email : undefined,
    loginPassword: loginCreated ? loginPassword : undefined,
  });
});

// ── DELETE /clients/:clientId/employees/:employeeId ──────────
router.delete("/clients/:clientId/employees/:employeeId", requireAuth, async (req, res) => {
  const { clientId, employeeId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;
  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, clientId)))
    .catch(() => [undefined]);
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  await db.delete(employeesTable).where(eq(employeesTable.id, employeeId)).catch(() => { /* non-fatal */ });

  // Durable login cleanup: an auto-created login (memory + user_accounts DB row) would otherwise
  // be re-seeded on the next restart, letting a deleted employee log in and clock in again.
  if (emp.email) {
    const loginUser = store.getUserByEmail(emp.email);
    if (loginUser) {
      store.deleteStaffUser(loginUser.id);
      await deleteUserAccount(loginUser.id).catch((err) =>
        req.log.warn({ err, email: emp.email }, "Failed to delete login account for removed employee")
      );
    }
  }
  res.json({ deleted: true, id: employeeId });
});

// ── PATCH /clients/:clientId/employees/:employeeId/status ────
router.patch("/clients/:clientId/employees/:employeeId/status", requireAuth, async (req, res) => {
  const { clientId, employeeId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;
  const { status } = req.body as { status: EmployeeStatus };

  const VALID: EmployeeStatus[] = ["hired", "onboarding", "active", "terminated"];
  if (!VALID.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
    return;
  }

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, clientId)))
    .catch(() => [undefined]);
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  const wasNotActive = emp.status !== "active";
  await db.update(employeesTable).set({
    status,
    // Preserve the existing easyteamSynced flag when activating; the sync below refreshes it.
    easyteamSynced: status === "active" ? emp.easyteamSynced : false,
    updatedAt: new Date().toISOString(),
  }).where(eq(employeesTable.id, employeeId));

  if (status === "active" && wasNotActive) {
    const sync = await syncEmployeeToIntegrations(
      { id: emp.id, companyId: clientId, name: `${emp.firstName} ${emp.lastName}`, email: emp.email, position: emp.position, hourlyWageCents: emp.hourlyWage },
      req.log
    );
    const syncStatus = sync.easyteamSynced && sync.rollfiSynced ? "synced" : (sync.easyteamSynced || sync.rollfiSynced) ? "partial" : "pending";
    await db.update(employeesTable).set({
      easyteamSynced: sync.easyteamSynced,
      rollfiUserId: sync.rollfiUserId,
      rollfiOnboardedAt: sync.rollfiSynced ? new Date().toISOString() : emp.rollfiOnboardedAt,
      syncStatus,
      lastSyncError: sync.syncError,
      updatedAt: new Date().toISOString(),
    }).where(eq(employeesTable.id, employeeId));
  }

  const [updated] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  res.json(projectEmployee(updated));
});

// ── POST /clients/:clientId/employees/:employeeId/sync ───────
router.post("/clients/:clientId/employees/:employeeId/sync", requireAuth, async (req, res) => {
  const { clientId, employeeId } = req.params;
  if (!assertCompanyAccess(req, res, clientId)) return;

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, clientId)))
    .catch(() => [undefined]);
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  if (emp.status !== "active") {
    res.status(400).json({ error: "Only active employees can be synced. Update status to active first." });
    return;
  }

  const sync = await syncEmployeeToIntegrations(
    { id: emp.id, companyId: clientId, name: `${emp.firstName} ${emp.lastName}`, email: emp.email, position: emp.position, hourlyWageCents: emp.hourlyWage },
    req.log
  );
  const now = new Date().toISOString();
  const syncStatus = sync.easyteamSynced && sync.rollfiSynced ? "synced" : (sync.easyteamSynced || sync.rollfiSynced) ? "partial" : "pending";
  await db.update(employeesTable).set({
    easyteamSynced: sync.easyteamSynced,
    rollfiUserId: sync.rollfiUserId,
    rollfiOnboardedAt: sync.rollfiSynced ? now : emp.rollfiOnboardedAt,
    syncStatus,
    lastSyncError: sync.syncError,
    updatedAt: now,
  }).where(eq(employeesTable.id, employeeId));

  res.json({
    success: sync.rollfiSynced,
    easyteamSynced: sync.easyteamSynced,
    rollfiSynced: sync.rollfiSynced,
    rollfiUserId: sync.rollfiUserId,
    error: sync.syncError,
  });
});

export default router;
