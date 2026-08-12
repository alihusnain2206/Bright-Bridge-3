import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import axios from "axios";
import { store } from "../store";
import { upsertTimesheetEntry, clearTimesheetEntriesForCompanyPeriod } from "../lib/easyteam-persist.js";
import { upsertTimesheetApproval } from "../lib/timesheet-approvals-persist.js";
import { db, pool, companies as companiesTable, employees as employeesTable, userAccounts as userAccountsTable, timesheetShifts as timesheetShiftsTable, timesheetEntries as timesheetEntriesTable, locations as locationsTable } from "@workspace/db";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { upsertTimesheetShift, getTimesheetShiftsByCompanyAndRange, shiftLocalDate } from "../lib/timesheet-shifts-persist.js";
import { resolveCompanyLocationId } from "../lib/location.js";
import { requireAuth, requireRole, assertCompanyAccess } from "../lib/auth-middleware.js";
import { resolveEasyTeamOrgId } from "../lib/easyteam-org.js";

const router: IRouter = Router();

function normalizePemKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Replace literal \n sequences (common when stored in env vars)
  let key = raw.replace(/\\n/g, "\n").trim();

  // If the key has no proper newlines, reformat it as a valid PEM
  if (!key.includes("\n")) {
    // Extract header, body, footer
    const headerMatch = key.match(/^(-----BEGIN [^-]+-----)/);
    const footerMatch = key.match(/(-----END [^-]+-----)$/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const body = key.slice(header.length, key.length - footer.length).replace(/\s+/g, "");
      // Chunk body into 64-char lines
      const lines: string[] = [];
      for (let i = 0; i < body.length; i += 64) {
        lines.push(body.slice(i, i + 64));
      }
      key = `${header}\n${lines.join("\n")}\n${footer}`;
    }
  }

  return key;
}

const EASYTEAM_API_KEY = normalizePemKey(process.env.EASYTEAM_API_KEY);
const EASYTEAM_PARTNER_ID = process.env.EASYTEAM_PARTNER_ID;
const EASYTEAM_SANDBOX_URL = "https://www.easyteam.io/embed";

// Prefer the service-specific secret; fall back to the shared legacy one so
// the rename from CONVOY_WEBHOOK_SECRET → EASYTEAM_WEBHOOK_SECRET is zero-downtime.
const CONVOY_WEBHOOK_SECRET =
  process.env.EASYTEAM_WEBHOOK_SECRET ?? process.env.CONVOY_WEBHOOK_SECRET;

function verifyConvoySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  // Accept Convoy format "v1=<hmac>,v1=<hmac>" OR plain hex (EasyTeam sandbox sends plain hex)
  const tokens = signatureHeader.split(",").map(s => s.trim());
  return tokens.some(tok => {
    // Try Convoy "v1=hash" format first
    const eqIdx = tok.indexOf("=");
    const hashStr = eqIdx >= 0 ? tok.slice(eqIdx + 1) : tok;
    try {
      return crypto.timingSafeEqual(Buffer.from(hashStr, "hex"), expectedBuf);
    } catch {
      return false;
    }
  });
}

interface ExportShift {
  id: string;
  employeeId: string;
  start: string;
  end: string;
  total_paid_hours_formatted?: string;
  total_paid_hours_decimal?: string;
  total_unpaid_hours_formatted?: string;
  total_unpaid_hours_decimal?: string;
}

interface ExportLogEntry {
  id: string;
  receivedAt: string;
  requestedBy: string;
  organizationId: string;
  startDate?: string;
  endDate?: string;
  employeeCount: number;
  shiftCount: number;
  status: "fetching" | "ready" | "error";
  signatureValid: boolean;
  shifts?: ExportShift[];
  error?: string;
}

const exportLog: ExportLogEntry[] = [];

const webhookLog: Array<{
  id: string;
  event: string;
  employee_id: string;
  timestamp: string;
  data: Record<string, unknown>;
  status: string;
}> = [];

router.get("/easyteam/employees", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  // Company-scope guard: super_admin may pass any companyId or omit to get all;
  // owner/manager are restricted to their own company regardless of query param.
  const sessionUser = store.getUserById(req.session.userId!);
  const requestedCompanyId = req.query.companyId as string | undefined;
  const companyId = sessionUser?.role === "super_admin"
    ? requestedCompanyId
    : (sessionUser?.companyId ?? requestedCompanyId);
  if (companyId && !assertCompanyAccess(req, res, companyId)) return;
  let users = companyId
    ? store.getUsersForCompany(companyId)
    : store.getAllStaffUsers();
  // Managers are scoped to their assigned location only.
  // Use DB employees.locationId (not store user_accounts.location_id, which is only set for
  // manager accounts — regular employees never get a locationId in user_accounts).
  if (sessionUser?.role === "manager" && sessionUser.locationId && companyId) {
    const locationEmpRows = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(
        eq(employeesTable.companyId, companyId),
        eq(employeesTable.locationId, sessionUser.locationId),
      ))
      .catch(() => [] as { id: string }[]);
    const locationEmpIds = new Set(locationEmpRows.map(r => r.id));
    users = users.filter((u) => u.employeeId != null && locationEmpIds.has(u.employeeId));
  }
  // Batch-fetch canonical wages and locationId from employees table (People module writes here).
  // Store hourlyWage is a last-resort fallback for test-only employees with no DB record.
  const empIds = users.map(u => u.employeeId).filter((id): id is string => !!id);
  const dbEmpRows = empIds.length > 0
    ? await db.select({ id: employeesTable.id, hourlyWage: employeesTable.hourlyWage, locationId: employeesTable.locationId })
        .from(employeesTable).where(inArray(employeesTable.id, empIds)).catch(() => [])
    : [];
  const dbWageMap     = new Map(dbEmpRows.map(e => [e.id, e.hourlyWage]));
  const dbLocationMap = new Map(dbEmpRows.map(e => [e.id, e.locationId]));
  const employees = users
    .filter((u) => u.employeeId && (u.role === "employee" || u.role === "manager") && (!u.status || u.status === "active" || u.status === "onboarding"))
    .map((u) => ({
      id: u.employeeId as string,
      // easyteamUuid: the UUID EasyTeam assigned to this employee in their own system.
      // Employees who registered directly in EasyTeam have a separate UUID; those who
      // registered through our wizard use our internal ID as their EasyTeam-side ID.
      // The frontend uses this to pass the correct ID to the EasyTeam SDK so shift rows
      // match the employees array and hours appear in the correct named row.
      easyteamUuid: store.getEasyTeamUuidForEmployee(u.employeeId!),
      name: u.name,
      role: u.role,
      companyId: u.companyId,
      locationId: dbLocationMap.get(u.employeeId!) ?? null,
      timeTrackingEnabled: true,
      wage: dbWageMap.get(u.employeeId!) ?? u.hourlyWage ?? 1500,
      wageType: "hourly" as const,
      status: u.status ?? "active",
    }));
  res.json({ employees });
});

// GET /easyteam/sdk-payload — full company SDK structure for the EasyTeam launcher.
// Returns ALL active locations + ALL employees for the company regardless of the caller's
// role.  Per EasyTeam's documented "advanced partial-dict pattern", every session receives
// the complete company picture; role-based access restriction lives in the JWT
// (locationId + permissions), NOT in a thinned payload.
// Company boundary is absolute: callers can only see their own company's data.
router.get("/easyteam/sdk-payload", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const sessionUser = store.getUserById(req.session.userId!);
  const requestedCompanyId = req.query.companyId as string | undefined;
  const companyId = sessionUser?.role === "super_admin"
    ? requestedCompanyId
    : (sessionUser?.companyId ?? requestedCompanyId);
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  if (!assertCompanyAccess(req, res, companyId)) return;

  try {
    // 1. All active locations — use easyteamLocationId as the canonical SDK id.
    const locationRows = await db
      .select({
        id:                 locationsTable.id,
        easyteamLocationId: locationsTable.easyteamLocationId,
        name:               locationsTable.name,
        latitude:           locationsTable.latitude,
        longitude:          locationsTable.longitude,
      })
      .from(locationsTable)
      .where(and(eq(locationsTable.companyId, companyId), eq(locationsTable.isActive, true)));

    // Map: our internal location.id → easyteamLocationId (for resolving employee.locationId)
    const locEtIdMap = new Map<string, string>(
      locationRows.map(l => [l.id, l.easyteamLocationId ?? l.id])
    );

    // 2. All employees — NO role-based location filter here.
    const users = store.getUsersForCompany(companyId).filter(
      u => u.employeeId &&
           (u.role === "employee" || u.role === "manager") &&
           (!u.status || u.status === "active" || u.status === "onboarding")
    );

    const empIds = users.map(u => u.employeeId).filter((id): id is string => !!id);
    const dbEmpRows = empIds.length > 0
      ? await db
          .select({ id: employeesTable.id, hourlyWage: employeesTable.hourlyWage, locationId: employeesTable.locationId })
          .from(employeesTable)
          .where(inArray(employeesTable.id, empIds))
          .catch(() => [] as { id: string; hourlyWage: number | null; locationId: string | null }[])
      : [];
    const dbWageMap     = new Map(dbEmpRows.map(e => [e.id, e.hourlyWage]));
    const dbLocationMap = new Map(dbEmpRows.map(e => [e.id, e.locationId]));

    const employees = users.map(u => {
      const empId        = u.employeeId!;
      const internalLocId = dbLocationMap.get(empId) ?? null;
      // Resolve the easyteamLocationId for this employee's location.
      // Falls through to the raw locationId string when not found in the map
      // (handles legacy employees whose locationId is already an ET-compatible string).
      const locationEtId = internalLocId
        ? (locEtIdMap.get(internalLocId) ?? internalLocId)
        : undefined;
      // Per EasyTeam "Using Identifiers": pass the same stable external ID used in the JWT
      // (user.employeeId, e.g. "EMP-SUNSHINE-001").
      // Exception: the shared ORG-BRIGHTBRIDGE org contains manually-added employees (Arbab
      // Nasir) whose only known identifier is the EasyTeam-assigned UUID — preserve that path
      // so their shifts continue to appear on Rainbow.
      const employeePayloadId = resolveEasyTeamOrgId(companyId) === "ORG-BRIGHTBRIDGE"
        ? (store.getEasyTeamUuidForEmployee(empId) ?? empId)
        : empId;
      return {
        id:                   employeePayloadId,
        name:                 u.name,
        role:                 u.role,
        wage:                 dbWageMap.get(empId) ?? u.hourlyWage ?? 1500,
        wageType:             "hourly" as const,
        timeTrackingEnabled:  true,
        // locationEtId: routing key used by the frontend to build per-location employee dicts.
        // Stripped before the payload is passed to the EasyTeam SDK (EasyTeam has no such field).
        ...(locationEtId ? { locationEtId } : {}),
      };
    });

    const locations = locationRows.map(l => ({
      id:        l.easyteamLocationId ?? l.id,
      name:      l.name,
      latitude:  l.latitude  ?? 0,
      longitude: l.longitude ?? 0,
    }));

    res.json({ locations, employees });
  } catch (err) {
    req.log.error({ err }, "sdk-payload: failed to build company SDK structure");
    res.status(500).json({ error: "Failed to build SDK payload" });
  }
});

router.get("/easyteam/status", requireAuth, (_req, res) => {
  const keyFirstLine = EASYTEAM_API_KEY?.split("\n")[0]?.slice(0, 40) ?? "";
  const keyLooksLikePem =
    !!EASYTEAM_API_KEY &&
    (EASYTEAM_API_KEY.includes("BEGIN RSA PRIVATE KEY") ||
      EASYTEAM_API_KEY.includes("BEGIN PRIVATE KEY"));
  res.json({
    connected: !!EASYTEAM_API_KEY,
    environment: "sandbox",
    apiKeyPresent: !!EASYTEAM_API_KEY,
    apiKeyLooksPem: keyLooksLikePem,
    apiKeyFirstLine: keyFirstLine,
    partnerIdPresent: !!EASYTEAM_PARTNER_ID,
    sdkVersion: "1.1.19",
    baseURL: EASYTEAM_SANDBOX_URL,
    lastChecked: new Date().toISOString(),
  });
});

router.post("/easyteam/token", requireAuth, async (req, res) => {
  const {
    employee_id,
    client_id,
    company_id,
    location_id,
    organization_id,
    role_name,
    access_role,
  } = req.body as {
    employee_id: string;
    client_id?: string;
    company_id?: string;
    location_id?: string;
    organization_id?: string;
    role_name?: string;
    access_role?: string;
  };

  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ success: false, error: "EASYTEAM_API_KEY not configured" });
    return;
  }

  // Company-scope guard: the effective companyId being requested (via client_id or company_id)
  // must match the caller's own company unless they are super_admin.
  // This prevents Company A's employee from obtaining a JWT scoped to Company B's location.
  const tokenCaller = store.getUserById(req.session.userId!);
  const requestedCompanyId = client_id ?? company_id;
  if (tokenCaller?.role !== "super_admin" && requestedCompanyId) {
    if (!assertCompanyAccess(req, res, requestedCompanyId)) return;
  }

  // Resolve client and employee from store when client_id is provided
  let resolvedLocationId = location_id || company_id || "SANDBOX-LOC-001";
  let resolvedOrgId = organization_id || company_id || "SANDBOX-ORG-001";
  let resolvedRoleName = role_name || "Manager";
  let resolvedAccessRole = access_role || "manager";
  // Wage is expressed in DOLLARS in the launch JWT — consistent with /auth/token-by-role and
  // the EasyTeam employee registration path (both divide stored cents by 100).
  let resolvedWage = 15;

  // client_id is a companyId in the unified model — resolve its EasyTeam location id.
  if (client_id) {
    resolvedLocationId = await resolveCompanyLocationId(client_id);
    resolvedOrgId = resolveEasyTeamOrgId(client_id);
  }

  let resolvedEtEmployeeId = employee_id;
  if (employee_id) {
    // Always query employees table first — it is the canonical wage source (People module
    // writes here). Store lookup follows only for role/position/employeeId mapping.
    const [dbEmp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employee_id)).catch(() => [undefined]);
    if (dbEmp) {
      resolvedRoleName = dbEmp.position;
      resolvedAccessRole = "employee";
      resolvedWage = (dbEmp.hourlyWage ?? 1500) / 100;
    }
    const staffUser = store.getAllStaffUsers().find((u) => u.employeeId === employee_id);
    if (staffUser) {
      // Store has richer role/access info — overlay position and access_role.
      // Wage stays from employees table above; only fall back to store if no DB record exists.
      resolvedRoleName = staffUser.position ?? resolvedRoleName;
      resolvedAccessRole = (staffUser.role === "manager" || staffUser.role === "owner") ? "manager" : "employee";
      resolvedEtEmployeeId = staffUser.employeeId ?? employee_id;
      if (!dbEmp) resolvedWage = (staffUser.hourlyWage ?? 1500) / 100;
    }
  }

  // Scope permissions by role — LOCATION_ADMIN / ORGANIZATION_ADMIN grant org-wide switching
  // in the EasyTeam UI and must not be issued to employees or managers.
  const tokenPermissions =
    resolvedAccessRole === "employee"
      ? ["LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE"]
      : resolvedAccessRole === "manager"
        ? ["LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE", "TIMESHEET_READ", "TIMESHEET_WRITE"]
        : [
            // admin / super_admin only
            "LOCATION_READ", "LOCATION_ADMIN",
            "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE",
            "SCHEDULE_READ", "SCHEDULE_WRITE",
            "ORGANIZATION_ADMIN",
          ];

  const payload = {
    employeeId: resolvedEtEmployeeId,
    locationId: resolvedLocationId,
    organizationId: resolvedOrgId,
    ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
    accessRole: {
      name: resolvedAccessRole,
      permissions: tokenPermissions,
    },
    role: {
      name: resolvedRoleName,
      hourlyWage: resolvedWage,
    },
    wage: resolvedWage,
    wageType: "hourly",
    features: {
      geolocation: false,
      shiftNotes: true,
      timesheet_badges: true,
      location_picker: true,
      timesheets_wages: true,
    },
  };

  let signedJwt: string;
  try {
    signedJwt = jwt.sign(payload, EASYTEAM_API_KEY, { algorithm: "RS256", expiresIn: "8h" });
  } catch (err) {
    const error = err as Error;
    req.log.error({ err }, "JWT signing failed");
    res.status(500).json({
      success: false,
      error: `JWT signing failed: ${error.message}`,
    });
    return;
  }

  // Return the raw RS256 JWT directly to the frontend.
  // The EasyTeam iframe SPA reads this from the URL query string (?token=...)
  // and performs the exchange with EasyTeam's /api/auth/exchangeToken itself.
  // Do NOT pre-exchange here — the iframe rejects already-exchanged tokens (400 Bad token).
  req.log.info({ employeeId: employee_id, clientId: client_id }, "EasyTeam raw JWT generated");
  res.json({ success: true, token: signedJwt });
});

router.get("/easyteam/timesheets", requireRole("super_admin", "owner", "manager"), (_req, res) => {
  res.json({
    success: true,
    timesheets: [],
    note: "Timesheet data is loaded inside the EasyTeam iframe via the SDK.",
  });
});

// ── Trigger EasyTeam export programmatically (replicates "Email Report" button) ──────
async function triggerEasyTeamExportForLocation(locationId: string, companyId?: string): Promise<boolean> {
  if (!EASYTEAM_API_KEY) return false;
  const managerUser = store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner"));
  if (!managerUser?.employeeId) return false;

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: resolveEasyTeamOrgId(companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "manager",
          permissions: [
            "LOCATION_ADMIN", "LOCATION_READ",
            "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE",
            "SCHEDULE_READ", "SCHEDULE_WRITE",
            "TIMESHEET_READ", "TIMESHEET_WRITE",
          ],
        },
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 25 },
        wage: 25, wageType: "hourly",
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "8h" }
    );

    const exchangeResp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    const accessToken = exchangeResp.data.accessToken;

    let internalOrgId = "ORG-BRIGHTBRIDGE";
    let internalLocId = locationId;
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof payload.organizationId === "string") internalOrgId = payload.organizationId;
        if (typeof payload.locationId === "string") internalLocId = payload.locationId;
      }
    } catch { /* keep defaults */ }

    const headers = { Authorization: `Bearer ${accessToken}` };
    const orgLocBase = `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/locations/${internalLocId}`;

    // Try export endpoint patterns — EasyTeam fires our registered webhook when triggered.
    // /timesheets/export confirmed 404; keeping /timesheets/email and /export only.
    const exportEndpoints = [
      `${orgLocBase}/timesheets/email`,
      `${orgLocBase}/export`,
    ];

    for (const endpoint of exportEndpoints) {
      try {
        await axios.post(endpoint, {}, { headers, timeout: 5000 });
        return true;
      } catch { /* try next endpoint */ }
    }
    return false;
  } catch {
    return false;
  }
}

// ── Sync EasyTeam hours → Rollfi bridge ──────────────────────

router.post("/easyteam/hours/sync", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const { from, to, companyId } = req.body as { from?: string; to?: string; companyId?: string };

  // Company-scope guard: super_admin may pass any companyId; owner/manager are scoped to their own.
  if (!assertCompanyAccess(req, res, companyId)) return;

  const toDate   = to   ? new Date(to + "T23:59:59.999Z") : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  // Include managers with an employeeId so promoted employees are still tracked in timesheets
  const allStaff = store.getAllStaffUsers().filter((u) => u.employeeId && (u.role === "employee" || u.role === "manager"));

  // Helper: scan exportLog for a matching entry, write to store + persist to DB.
  // Removes the consumed entry from exportLog so stale webhook payloads cannot be
  // replayed on subsequent Pull Hours calls (each webhook payload is used at most once).
  // Returns synced count + skipped unknown counts so all sync paths surface them.
  async function applyExportIfFound(): Promise<{
    synced: number;
    skippedUnknownEmployees: number;
    skippedUnknownMinutes: number;
  }> {
    const zero = { synced: 0, skippedUnknownEmployees: 0, skippedUnknownMinutes: 0 };
    const foundIdx = exportLog.findIndex(
      (e) => e.status === "ready" && e.shifts && e.shifts.length > 0 &&
        (!e.startDate || new Date(e.startDate) <= toDate) &&
        (!e.endDate   || new Date(e.endDate)   >= fromDate)
    );
    if (foundIdx === -1) return zero;
    const found = exportLog[foundIdx];
    if (!found?.shifts || found.shifts.length === 0) return zero;
    // Consume the entry — remove it so future Pull Hours calls go to the REST API for fresh data.
    exportLog.splice(foundIdx, 1);

    const hoursByEmp  = new Map<string, number>();
    const breaksByEmp = new Map<string, number>();
    const skippedUnknown: Array<{ etEmpId: string; minutes: number }> = [];

    for (const shift of found.shifts) {
      if (store.isEasyTeamUuidIgnored(shift.employeeId, companyId ?? undefined)) continue;
      if (companyId) {
        const internalEmpId = store.resolveEasyTeamUuid(shift.employeeId);
        const ru = allStaff.find((u) => u.employeeId === internalEmpId);
        if (!ru || ru.companyId !== companyId) {
          // Track as unknown if the UUID is not in our registry (not just wrong-company)
          if (internalEmpId === shift.employeeId) {
            const mins = parseFloat(shift.total_paid_hours_decimal ?? "0") * 60;
            skippedUnknown.push({ etEmpId: shift.employeeId, minutes: mins });
          }
          continue;
        }
      }
      const h = parseFloat(shift.total_paid_hours_decimal ?? "0");
      const b = parseFloat(shift.total_unpaid_hours_decimal ?? "0");
      hoursByEmp.set(shift.employeeId, (hoursByEmp.get(shift.employeeId) ?? 0) + h);
      breaksByEmp.set(shift.employeeId, (breaksByEmp.get(shift.employeeId) ?? 0) + b);
    }

    let synced = 0;
    await Promise.all(
      Array.from(hoursByEmp.entries()).map(async ([etEmpId, hours]) => {
        // Never overwrite existing data with zero — if EasyTeam reports 0 hours (e.g. sandbox
        // reset or no submitted shifts), preserve whatever was already stored for this employee.
        if (hours <= 0) return;
        const internalEmpId = store.resolveEasyTeamUuid(etEmpId);
        const rollfiUser = allStaff.find((u) => u.employeeId === internalEmpId);
        const breakH = breaksByEmp.get(etEmpId) ?? 0;
        await upsertTimesheetEntry({
          employeeId: rollfiUser?.employeeId ?? internalEmpId,
          companyId:  rollfiUser?.companyId  ?? companyId ?? "unknown",
          periodKey,
          hoursWorked:   hours,
          breakDeduction: breakH,
          approvedHours:  Math.max(0, hours - breakH),
          source: "easyteam",
          syncedAt: new Date().toISOString(),
        });
        synced++;
      })
    );
    const skippedUnknownMinutes = skippedUnknown.reduce((s, e) => s + e.minutes, 0);
    return { synced, skippedUnknownEmployees: skippedUnknown.length, skippedUnknownMinutes };
  }

  // ── Step 1: In-memory exportLog (populated by previous webhook or trigger) ──
  const actorSync = req.session.userId ? store.getUserById(req.session.userId) : undefined;

  const step1 = await applyExportIfFound();
  // Return as soon as we consumed an export — even if every UUID was unknown (synced=0).
  // Falling through to trigger/REST would re-fetch the same data and lose the skipped counts.
  if (step1.synced > 0 || step1.skippedUnknownEmployees > 0) {
    req.log.info({ periodKey, companyId, synced: step1.synced, skippedUnknownEmployees: step1.skippedUnknownEmployees }, "Sync: used cached export webhook data");
    if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${step1.synced} employee${step1.synced !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
    res.json({ success: true, source: "easyteam", periodKey, synced: step1.synced, skippedUnknownEmployees: step1.skippedUnknownEmployees, skippedUnknownMinutes: step1.skippedUnknownMinutes });
    return;
  }

  // ── Step 2: Trigger EasyTeam export + poll for incoming webhook (up to 4 s) ──
  // Replicates what "Email Report" does inside the iframe — EasyTeam fires our webhook endpoint.
  if (EASYTEAM_API_KEY && companyId) {
    const co = store.getCompany(companyId);
    if (co?.locationId) {
      req.log.info({ locationId: co.locationId }, "Sync: triggering EasyTeam export programmatically");
      const triggered = await triggerEasyTeamExportForLocation(co.locationId, co.id);
      req.log.info({ triggered, locationId: co.locationId }, "Sync: export trigger result");

      if (triggered) {
        for (let i = 0; i < 8; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          const step2 = await applyExportIfFound();
          if (step2.synced > 0 || step2.skippedUnknownEmployees > 0) {
            req.log.info({ periodKey, companyId, synced: step2.synced, skippedUnknownEmployees: step2.skippedUnknownEmployees, pollAttempt: i + 1 }, "Sync: webhook arrived after export trigger");
            if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${step2.synced} employee${step2.synced !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
            res.json({ success: true, source: "easyteam", periodKey, synced: step2.synced, skippedUnknownEmployees: step2.skippedUnknownEmployees, skippedUnknownMinutes: step2.skippedUnknownMinutes });
            return;
          }
        }
        req.log.info({ periodKey, companyId }, "Sync: webhook did not arrive within 4 s after trigger");
      }
    }
  }

  // ── Step 3: EasyTeam REST API direct fetch ──
  const allClientIds = companyId
    ? [companyId]
    : (await db.select({ id: companiesTable.id }).from(companiesTable).catch(() => []))
        .map((c) => c.id)
        .filter((id) => id !== "ORG-BRIGHTBRIDGE");

  // Phase 3: build per-company list of ALL active location IDs (not just one).
  // Each company may have multiple active locations; we collect shifts from all of them.
  type SyncableCompany = { id: string; locationIds: string[] };
  const companiesToSync: SyncableCompany[] = [];
  for (const id of allClientIds) {
    const activeLocRows = await db
      .select({ easyteamLocationId: locationsTable.easyteamLocationId })
      .from(locationsTable)
      .where(and(eq(locationsTable.companyId, id), eq(locationsTable.isActive, true)))
      .catch(() => [] as { easyteamLocationId: string | null }[]);

    let locationIds = activeLocRows
      .map((l) => l.easyteamLocationId)
      .filter((lid): lid is string => !!lid);

    // Fall back to store / resolveCompanyLocationId for companies whose location row predates Phase 1
    if (locationIds.length === 0) {
      const resolved = store.getCompany(id)?.locationId ?? await resolveCompanyLocationId(id);
      if (resolved) locationIds = [resolved];
    }

    if (locationIds.length > 0) {
      companiesToSync.push({ id, locationIds });
    } else {
      req.log.warn({ companyId: id }, "Sync: no active locations found for company — skipping");
    }
  }

  let restSynced = 0;
  let restApiResponded = false;
  let totalSkippedForeign = 0;
  const skippedUnknownUuids: Array<{ etEmpId: string; minutesLost: number }> = [];
  const fromDateStr = fromDate.toISOString().split("T")[0]!;
  const toDateStr   = toDate.toISOString().split("T")[0]!;

  for (const co of companiesToSync) {
    // ── Collect shifts from ALL active locations for this company ──────────────
    // EasyTeam's flat /timesheets endpoint returns ALL org shifts regardless of which
    // location JWT was used, so we deduplicate by shift ID across location fetches.
    const allShiftsMap = new Map<string, EasyTeamShift>(); // keyed by EasyTeam shift ID
    const companyEtLocIds = new Set<string>(); // EasyTeam UUIDs for this company's locations

    for (const locId of co.locationIds) {
      const result = await fetchEasyTeamShiftsForLocation(locId, fromDate, toDate, co.id);
      req.log.info(
        { locationId: locId, companyId: co.id, result: "error" in result ? result.error : `${result.shifts.length} shifts` },
        "Sync: REST API result",
      );

      if ("shifts" in result) {
        restApiResponded = true;
        companyEtLocIds.add(result.easyteamLocationId);

        for (const s of result.shifts) {
          if (!s.utcStartTime) continue;
          // Date filter: compare by local calendar date (utcStartTime + utcOffset) so shifts
          // near midnight are attributed to the correct pay-period day.
          const ld = shiftLocalDate(s.utcStartTime, s.utcOffset ?? 0);
          if (ld < fromDateStr || ld > toDateStr) continue;
          // Deduplicate: first-write-wins (every location fetch returns all org shifts)
          if (!allShiftsMap.has(s.id)) allShiftsMap.set(s.id, s);
        }
      }
    }

    if (companyEtLocIds.size === 0) continue; // no API response from any location — skip

    // Foreign-location guard: keep only shifts whose EasyTeam locationId belongs to THIS company.
    // Prevents cross-company contamination when multiple companies share one EasyTeam org.
    let skippedForeignShifts = 0;
    const inRange: EasyTeamShift[] = [];
    for (const s of allShiftsMap.values()) {
      if (companyEtLocIds.has(s.locationId)) {
        inRange.push(s);
      } else {
        req.log.warn(
          { shiftId: s.id, shiftLocationId: s.locationId, knownEtLocIds: [...companyEtLocIds], companyId: co.id },
          "Sync: skipping shift from foreign location",
        );
        skippedForeignShifts++;
      }
    }
    totalSkippedForeign += skippedForeignShifts;
    req.log.info(
      { companyId: co.id, locationIds: co.locationIds, totalCollected: allShiftsMap.size, inRange: inRange.length, skippedForeignShifts, from: fromDate.toISOString(), to: toDate.toISOString() },
      "Sync: date-filtered shifts for company",
    );

    const minutesByEmp = new Map<string, number>();
    const breaksByEmp2 = new Map<string, number>();
    for (const s of inRange) {
      minutesByEmp.set(s.employeeId, (minutesByEmp.get(s.employeeId) ?? 0) + shiftDurationMinutes(s));
      breaksByEmp2.set(s.employeeId, (breaksByEmp2.get(s.employeeId) ?? 0) + breakDurationMinutes(s));
    }
    // Clear stale entries for this company+period before writing fresh data
    if (minutesByEmp.size > 0) {
      await clearTimesheetEntriesForCompanyPeriod(co.id, periodKey);
    }
    const companyUsers = store.getUsersForCompany(co.id);

    // Persist raw shifts to timesheet_shifts (upsert — last-write-wins so open shifts update on close)
    const syncedAt = new Date().toISOString();
    await Promise.all(inRange.map(async (s) => {
      if (store.isEasyTeamUuidIgnored(s.employeeId, co.id)) return; // blocklisted for this company — skip
      const internalEmpId = store.resolveEasyTeamUuid(s.employeeId);
      const mappedEmpId = internalEmpId !== s.employeeId ? internalEmpId : null;
      if (!mappedEmpId) {
        req.log.warn({ etEmpId: s.employeeId }, "Sync: persisting shift with null employeeId — EasyTeam UUID not in registry");
      }
      await upsertTimesheetShift({
        easyteamShiftId:     s.id,
        employeeId:          mappedEmpId,
        companyId:           co.id,
        easyteamLocationId:  s.locationId,
        roleId:              s.roleId ?? null,
        utcStartTime:        s.utcStartTime ?? s.startTime,
        utcEndTime:          s.utcEndTime ?? s.endTime ?? null,
        utcOffset:           s.utcOffset ?? 0,
        localDate:           shiftLocalDate(s.utcStartTime ?? s.startTime, s.utcOffset ?? 0),
        durationMs:          s.duration ?? 0,
        payableDurationMs:   (s.payableDuration != null && s.payableDuration > 10000) ? s.payableDuration : (s.payableDuration ?? 0) * 60000,
        totalPaidBreakMin:   s.totalPaidBreaks ?? null,
        totalUnpaidBreakMin: s.totalUnpaidBreaks ?? null,
        breaks:              s.breaks ?? null,
        active:              s.active ?? false,
        locked:              s.locked ?? false,
        manualEntry:         s.manualEntry ?? false,
        scheduleShiftId:     s.scheduleShiftId ?? null,
        deletedAt:           s.deletedAt ?? null,
        syncedAt,
      });
    }));

    for (const [etEmpId, totalMinutes] of minutesByEmp) {
      // Resolve EasyTeam UUID → our internal employeeId (populated during boot sync / employee add)
      const internalEmpId = store.resolveEasyTeamUuid(etEmpId);
      if (store.isEasyTeamUuidIgnored(etEmpId, co.id)) {
        req.log.info({ etEmpId, minutesLost: totalMinutes, companyId: co.id }, "Sync: silently skipping blocklisted EasyTeam UUID");
        continue;
      }
      if (internalEmpId === etEmpId) {
        req.log.warn({ etEmpId, minutesLost: totalMinutes }, "Sync: skipping timesheet_entry for unrecognised EasyTeam UUID (not in our employee registry)");
        skippedUnknownUuids.push({ etEmpId, minutesLost: totalMinutes });
        continue;
      }
      const matched = companyUsers.find((u) => u.employeeId === internalEmpId);
      const hoursWorked = Math.round((totalMinutes / 60) * 10000) / 10000;
      const breakHours  = Math.round(((breaksByEmp2.get(etEmpId) ?? 0) / 60) * 10000) / 10000;
      await upsertTimesheetEntry({
        employeeId: internalEmpId,
        companyId:  matched?.companyId ?? co.id,
        periodKey,
        hoursWorked,
        breakDeduction: breakHours,
        approvedHours:  Math.max(0, Math.round((hoursWorked - breakHours) * 10000) / 10000),
        source: "easyteam",
        syncedAt,
      });
      restSynced++;
    }
  }

  if (restApiResponded) {
    const skippedUnknownMinutes = skippedUnknownUuids.reduce((s, e) => s + e.minutesLost, 0);
    req.log.info(
      { periodKey, companyId, restSynced, totalSkippedForeign, skippedUnknownEmployees: skippedUnknownUuids.length, skippedUnknownMinutes },
      "Sync: used EasyTeam REST API data",
    );
    if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${restSynced} employee${restSynced !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
    res.json({
      success: true,
      source: "easyteam",
      periodKey,
      synced: restSynced,
      skippedForeignShifts: totalSkippedForeign,
      skippedUnknownEmployees: skippedUnknownUuids.length,
      skippedUnknownMinutes,
      skippedUnknownEtIds: skippedUnknownUuids.map((e) => e.etEmpId),
    });
    return;
  }

  // ── Step 4: Seed fallback — only if REST API never responded ──
  req.log.info({ periodKey, companyId }, "Sync: EasyTeam REST API unavailable — seeding fallback hours");
  const seeded = store.seedTimesheetHours(periodKey);
  if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours seeded from EasyTeam demo data (${seeded.length} records)`, actorName: actorSync?.name, actorRole: actorSync?.role });
  res.json({ success: true, source: "seeded", periodKey, synced: seeded.length, note: "No EasyTeam data — seeded demo hours" });
});

// ── GET /easyteam/company-members — employee names for timesheet approval panel ──
// Returns { [employeeId]: fullName } from store staff users (covers both seeded and
// wizard-created employees). Used by the timesheets page to show names in the approval table.
router.get("/easyteam/company-members", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  if (!assertCompanyAccess(req, res, companyId)) return;
  const caller = store.getUserById(req.session.userId!);
  // Include managers who also have an employeeId (promoted employees retain their employee identity)
  let staff = store.getAllStaffUsers().filter((u) => u.companyId === companyId && u.employeeId && (u.role === "employee" || u.role === "manager"));
  // Managers see only employees in their assigned location — use DB employees.locationId
  // (store user_accounts.location_id is only reliably set for manager accounts, not regular employees)
  if (caller?.role === "manager" && caller.locationId) {
    const locationEmpRows = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.companyId, companyId), eq(employeesTable.locationId, caller.locationId)))
      .catch(() => [] as { id: string }[]);
    const locationEmpIds = new Set(locationEmpRows.map(r => r.id));
    staff = staff.filter((u) => u.employeeId != null && locationEmpIds.has(u.employeeId));
  }
  const names: Record<string, string> = {};
  for (const u of staff) {
    if (u.employeeId) names[u.employeeId] = u.name;
  }
  res.json({ names });
});

router.get("/easyteam/hours", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const { from, to, companyId: requestedCompanyId } = req.query as { from?: string; to?: string; companyId?: string };
  // Company-scope guard: super_admin may omit companyId to get all; owner/manager are
  // always scoped to their own company regardless of what the query param says.
  const sessionUser = store.getUserById(req.session.userId!);
  const companyId = sessionUser?.role === "super_admin"
    ? requestedCompanyId
    : (sessionUser?.companyId ?? requestedCompanyId);
  if (companyId && !assertCompanyAccess(req, res, companyId)) return;
  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  // ── Primary source: aggregate from timesheet_shifts by local_date ────────────
  // This is always up-to-date — shifts are written/updated on every Pull Hours.
  // Using timesheet_entries alone was unreliable: old period keys were written by
  // earlier syncs and never refreshed unless the user re-synced the exact same range.
  let hoursFromShifts: Map<string, { payableMs: number; unpaidBreakMin: number }> | null = null;
  if (companyId) {
    let shiftFetchError: unknown = null;
    const shiftRows = await getTimesheetShiftsByCompanyAndRange(companyId, fromDate, toDate).catch((e) => { shiftFetchError = e; return null; });
    req.log.info(
      { companyId, periodKey, fromDate: fromDate.toISOString(), toDate: toDate.toISOString(),
        shiftRows: shiftRows?.length ?? null, shiftFetchError: shiftFetchError ? String(shiftFetchError) : null,
        sessionRole: sessionUser?.role ?? "no-session", sessionCompanyId: sessionUser?.companyId ?? null },
      "GET /hours: shift query result",
    );
    if (shiftRows && shiftRows.length > 0) {
      hoursFromShifts = new Map();
      for (const s of shiftRows) {
        if (!s.employeeId) continue; // unknown UUID — skip (mirrors sync behaviour)
        const cur = hoursFromShifts.get(s.employeeId) ?? { payableMs: 0, unpaidBreakMin: 0 };
        cur.payableMs    += s.payableDurationMs;
        cur.unpaidBreakMin += s.totalUnpaidBreakMin ?? 0;
        hoursFromShifts.set(s.employeeId, cur);
      }
    }
  }

  // ── Approval status from timesheet_entries (exact-periodKey match) ───────────
  let storeEntries = store.getTimesheetEntriesForPeriod(periodKey);
  if (companyId) storeEntries = storeEntries.filter((e) => e.companyId === companyId);
  const approvalMap = new Map(storeEntries.map((e) => [e.employeeId, e]));

  req.log.info(
    { periodKey, hoursFromShiftsSize: hoursFromShifts?.size ?? null, storeEntriesCount: storeEntries.length,
      storeEntrySample: storeEntries.slice(0, 3).map(e => ({ id: e.employeeId, h: e.hoursWorked })) },
    "GET /hours: entries source",
  );

  // ── Build final entries ───────────────────────────────────────────────────────
  let entries: typeof storeEntries;
  const now = new Date().toISOString();

  if (hoursFromShifts && hoursFromShifts.size > 0) {
    // Build from live shift data; overlay approvedHours/managerApproved from stored entries.
    entries = Array.from(hoursFromShifts.entries()).map(([empId, agg]) => {
      const hoursWorked    = Math.round((agg.payableMs / 3_600_000) * 10000) / 10000;
      const breakDeduction = Math.round((agg.unpaidBreakMin / 60) * 10000) / 10000;
      const approvedHours  = Math.max(0, Math.round((hoursWorked - breakDeduction) * 10000) / 10000);
      const stored = approvalMap.get(empId);
      return {
        employeeId:      empId,
        companyId:       companyId ?? stored?.companyId ?? "unknown",
        periodKey,
        hoursWorked,
        breakDeduction,
        // If the manager already approved this period, preserve their approved value.
        approvedHours:   stored?.managerApproved ? (stored.approvedHours) : approvedHours,
        source:          "easyteam" as const,
        syncedAt:        stored?.syncedAt ?? now,
        managerApproved: stored?.managerApproved,
        approvedAt:      stored?.approvedAt,
      };
    });
  } else {
    // No shifts in DB for this date range — fall back to pre-aggregated entries (legacy / seeded periods).
    // If the in-memory store is empty (e.g. after a deploy restart that cleared the cache), also
    // query the DB directly so we never return stale 0m rows when the DB has real data.
    if (storeEntries.length === 0 && companyId) {
      const dbEntries = await db
        .select()
        .from(timesheetEntriesTable)
        .where(and(
          eq(timesheetEntriesTable.companyId, companyId),
          eq(timesheetEntriesTable.periodKey, periodKey),
        ))
        .catch(() => [] as typeof storeEntries);
      req.log.info(
        { periodKey, companyId, dbEntriesCount: dbEntries.length },
        "GET /hours: in-memory store empty — fetched timesheet_entries from DB directly",
      );
      entries = dbEntries.length > 0 ? dbEntries : storeEntries;
    } else {
      entries = storeEntries;
    }
  }

  // ── Managers: pad 0m rows for all roster members; never drop entries with real hours ──
  // We deliberately do NOT filter entries down to only location employees: if an employee's
  // location_id in the DB is stale or set to a non-matching format (e.g. an EasyTeam UUID
  // instead of our internal LOC-* key), a hard filter silently drops their hours and shows
  // 0m for the whole table. Instead, we keep every entry that has actual hours and only pad
  // 0m rows for location employees who have no EasyTeam data yet.
  if (sessionUser?.role === "manager" && sessionUser.locationId) {
    const locationEmployees = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(
        eq(employeesTable.companyId, companyId ?? ""),
        eq(employeesTable.locationId, sessionUser.locationId),
      ))
      .catch(() => [] as { id: string }[]);
    // Drop zero-hour entries for employees that are NOT on this location's roster
    // (avoids showing ghost employees from other locations), but keep all entries
    // with actual hours regardless of location assignment.
    const empIdSet = new Set(locationEmployees.map((e) => e.id));
    entries = entries.filter((e) => e.hoursWorked > 0 || empIdSet.has(e.employeeId));
    // Pad: add a 0m placeholder for any roster member not yet in entries
    const coveredIds = new Set(entries.map((e) => e.employeeId));
    for (const { id } of locationEmployees) {
      if (!coveredIds.has(id)) {
        entries.push({
          employeeId: id,
          companyId: companyId ?? "",
          periodKey,
          hoursWorked: 0,
          breakDeduction: 0,
          approvedHours: 0,
          source: "estimated",
          syncedAt: now,
        });
      }
    }
  }

  res.json({ periodKey, entries, synced: entries.length > 0 });
});

const EASYTEAM_REST_API = "https://www.easyteam.io";

interface EasyTeamShift {
  id: string;
  employeeId: string;
  locationId: string;
  roleId?: string | null;
  startTime: string;
  endTime: string | null;
  utcStartTime?: string;
  utcEndTime?: string | null;
  utcOffset?: number;
  duration?: number;           // total duration ms
  payableDuration?: number;    // net payable ms (EasyTeam timesheets endpoint)
  totalPaidBreaks?: number;    // minutes
  totalUnpaidBreaks?: number;  // minutes
  hourlyWage?: number;
  active?: boolean;
  locked?: boolean;
  manualEntry?: boolean;
  scheduleShiftId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  breaks?: Array<{
    startTime: string;
    endTime: string;
    typeId?: string;
    paid?: boolean;
    name?: string;
    mandatory?: boolean;
    durationInSettingsMinutes?: number;
  }>;
}

/** Returns worked minutes for a timesheet entry. Prefers payableDuration (EasyTeam's
 *  net payable time, matching what the iframe displays) over raw clock arithmetic.
 *  payableDuration is in milliseconds when > 10000, otherwise already in minutes. */
function shiftDurationMinutes(s: EasyTeamShift): number {
  if (s.payableDuration != null && s.payableDuration > 0) {
    return s.payableDuration > 10000 ? s.payableDuration / 60000 : s.payableDuration;
  }
  if (s.startTime && s.endTime) {
    const norm = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
    const start = new Date(norm(s.startTime));
    const end   = new Date(norm(s.endTime));
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
      return (end.getTime() - start.getTime()) / 60000;
    }
  }
  return 0;
}

/** Returns total break minutes for a timesheet entry. */
function breakDurationMinutes(s: EasyTeamShift): number {
  if (s.totalUnpaidBreaks != null) return s.totalUnpaidBreaks;
  if (s.breaks && s.breaks.length > 0) {
    const norm = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
    return s.breaks.reduce((sum, b) => {
      const bs = new Date(norm(b.startTime));
      const be = new Date(norm(b.endTime));
      return sum + (isNaN(bs.getTime()) || isNaN(be.getTime()) ? 0 : (be.getTime() - bs.getTime()) / 60000);
    }, 0);
  }
  return 0;
}

const EASYTEAM_EMBED_API = "https://www.easyteam.io/embed/api";

function extractArrayFromResponse(data: unknown): EasyTeamShift[] {
  if (Array.isArray(data)) return data as EasyTeamShift[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const nested = obj.data ?? obj.timesheets ?? obj.shifts ?? obj.items ?? obj.records ?? [];
    if (Array.isArray(nested)) return nested as EasyTeamShift[];
  }
  return [];
}

async function fetchEasyTeamShiftsForLocation(
  locationId: string,
  fromDate: Date,
  toDate: Date,
  companyId?: string,
): Promise<{ shifts: EasyTeamShift[]; source: "api"; locationId: string; easyteamLocationId: string } | { error: string }> {
  if (!EASYTEAM_API_KEY) return { error: "No API key configured" };

  // CRITICAL GUARD: dates are required — the documented flat endpoint returns HTTP 200
  // with 0 shifts when dates are omitted, which would silently import zero hours into payroll.
  if (!fromDate || isNaN(fromDate.getTime()) || !toDate || isNaN(toDate.getTime())) {
    throw new Error(
      "fetchEasyTeamShiftsForLocation: fromDate and toDate are required — " +
      "omitting them returns HTTP 200 with 0 shifts (silent payroll wipe)"
    );
  }
  const startDateStr = fromDate.toISOString().split("T")[0]!;
  const endDateStr   = toDate.toISOString().split("T")[0]!;

  // 1. Try in-memory store — covers Sunshine/Rainbow and any owners/managers loaded at boot
  let managerUser = store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner"));

  // 2. For wizard-created companies (DB-only), look up manager from user_accounts
  if (!managerUser?.employeeId && companyId) {
    try {
      const [dbManager] = await db
        .select()
        .from(userAccountsTable)
        .where(and(eq(userAccountsTable.companyId, companyId), inArray(userAccountsTable.role, ["manager", "owner"])));
      if (dbManager?.employeeId) {
        managerUser = {
          id: dbManager.id,
          name: dbManager.name ?? "Manager",
          email: dbManager.email,
          role: "owner",
          companyId,
          employeeId: dbManager.employeeId,
          locationId,
          position: dbManager.position ?? "Daycare Manager",
        };
      }
    } catch { /* ignore — fall through to super_admin */ }
  }

  // 3. Last resort: super_admin (Joanne) — works only for locations she is registered under
  if (!managerUser?.employeeId) {
    managerUser = store.getAllStaffUsers().find((u) => u.role === "super_admin" && u.employeeId);
  }

  if (!managerUser?.employeeId) return { error: `No user found for locationId=${locationId}` };

  try {
    // Include TIMESHEET_READ + SHIFT_READ to access both timesheets and shifts endpoints
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: resolveEasyTeamOrgId(companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "manager",
          permissions: [
            "LOCATION_ADMIN", "LOCATION_READ",
            "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE",
            "SCHEDULE_READ", "SCHEDULE_WRITE",
            "TIMESHEET_READ", "TIMESHEET_WRITE",
          ],
        },
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 25 },
        wage: 25,
        wageType: "hourly",
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "8h" }
    );

    // Exchange for access token — extract internal EasyTeam UUIDs from the returned JWT
    const exchangeResp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    const accessToken = exchangeResp.data.accessToken;

    // Decode the access token to get EasyTeam's internal UUIDs
    let internalOrgId = "ORG-BRIGHTBRIDGE";
    let internalLocId = locationId;
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof payload.organizationId === "string") internalOrgId = payload.organizationId;
        if (typeof payload.locationId === "string") internalLocId = payload.locationId;
      }
    } catch { /* keep defaults */ }

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Documented flat endpoint — date filters are REQUIRED and work correctly.
    // The old location-nested path (/organizations/{org}/locations/{loc}/timesheets)
    // silently ignored date parameters and always returned all shifts.
    // This endpoint returns { shifts[], lockedDays[], totals{} }; read from .shifts.
    const timesheetsUrl =
      `${EASYTEAM_EMBED_API}/timesheets?startDate=${startDateStr}&endDate=${endDateStr}`;

    const r = await axios.get<{ shifts?: EasyTeamShift[] }>(timesheetsUrl, { headers, timeout: 10000 });
    const shifts = r.data.shifts ?? [];

    if (shifts.length === 0) {
      logger.warn(
        { timesheetsUrl, startDate: startDateStr, endDate: endDateStr },
        "fetchEasyTeamShiftsForLocation: 0 shifts returned — verify date range has EasyTeam data",
      );
    }

    return { shifts, source: "api", locationId, easyteamLocationId: internalLocId };
  } catch (err) {
    const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = axErr.response
      ? `HTTP ${axErr.response.status}: ${JSON.stringify(axErr.response.data)}`
      : (axErr.message ?? "Unknown error");
    return { error: detail };
  }
}

router.post("/easyteam/hours/approve", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const userId = req.session.userId!;

  const body = req.body as {
    from?: string; to?: string; companyId?: string;
    overrides?: { employeeId: string; approvedHours: number; note?: string; managerEditNote?: string }[];
    entries?: { employeeId: string; approvedHours: number; managerEditNote?: string }[];
  };
  const { from, to, companyId } = body;
  // Accept both "overrides" (sent by timesheets page) and legacy "entries"
  const managerEntries = body.overrides ?? body.entries ?? [];
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  if (!assertCompanyAccess(req, res, companyId)) return;
  // Build a quick lookup map for manager-supplied overrides keyed by employeeId
  const managerOverrides = new Map(
    (managerEntries ?? []).map((e) => [e.employeeId, e])
  );

  // ── Location scope: managers may only approve entries for their own location ──
  // Resolves the set of employee IDs that belong to the approving manager's location.
  // null = no restriction (owner / super_admin).
  const approvingUser = store.getUserById(userId);
  let locationEmpIds: Set<string> | null = null;
  if (approvingUser?.role === "manager" && approvingUser.locationId) {
    const locEmpRows = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.companyId, companyId), eq(employeesTable.locationId, approvingUser.locationId)))
      .catch(() => [] as { id: string }[]);
    locationEmpIds = new Set(locEmpRows.map((r) => r.id));
    if (locationEmpIds.size === 0) {
      // No employees found for this locationId — the stored location_id may be in a different
      // format (e.g. EasyTeam UUID vs internal LOC-* key). Fall back to company-wide scope
      // rather than silently blocking the entire approval.
      req.log.warn({ locationId: approvingUser.locationId, companyId }, "Approve: location lookup returned 0 employees — locationId format mismatch? Falling back to company-wide approval");
      locationEmpIds = null;
    } else {
      req.log.info({ locationId: approvingUser.locationId, scopedEmployees: locationEmpIds.size }, "Approve: manager location scope resolved");
    }
  }

  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  // Resolve location: store for seeded demo companies, DB rollfiLocationId for wizard companies.
  // Using the unified resolver ensures DB-only companies still REST-fetch EasyTeam hours on approval.
  const locationId = await resolveCompanyLocationId(companyId);

  let dataSource: "easyteam" | "seeded" = "seeded";

  // ── Step 1: Export webhook data (set when manager clicks "Email Report" in EasyTeam) ──
  const recentExport = exportLog.find(
    (e) => e.status === "ready" && e.shifts && e.shifts.length > 0 &&
      (!e.startDate || new Date(e.startDate) <= toDate) &&
      (!e.endDate   || new Date(e.endDate)   >= fromDate)
  );

  if (recentExport?.shifts && recentExport.shifts.length > 0) {
    // Sum hours from real export data, filtered to this company's employees
    const companyUsers = store.getUsersForCompany(companyId);
    const hoursByEmp = new Map<string, number>();
    const breaksByEmp = new Map<string, number>();

    for (const shift of recentExport.shifts) {
      const matched = companyUsers.find((u) => u.employeeId === shift.employeeId);
      if (!matched) continue;
      const h = parseFloat(shift.total_paid_hours_decimal ?? "0");
      const b = parseFloat(shift.total_unpaid_hours_decimal ?? "0");
      hoursByEmp.set(shift.employeeId, (hoursByEmp.get(shift.employeeId) ?? 0) + h);
      breaksByEmp.set(shift.employeeId, (breaksByEmp.get(shift.employeeId) ?? 0) + b);
    }

    if (hoursByEmp.size > 0) {
      await Promise.all(Array.from(hoursByEmp.entries()).map(async ([empId, hours]) => {
        // Location scope: skip employees outside the manager's location
        if (locationEmpIds && !locationEmpIds.has(empId)) return;
        const breakH = breaksByEmp.get(empId) ?? 0;
        await upsertTimesheetEntry({
          employeeId: empId,
          companyId,
          periodKey,
          hoursWorked: hours,
          breakDeduction: breakH,
          approvedHours: Math.max(0, hours - breakH),
          source: "easyteam",
          syncedAt: new Date().toISOString(),
        });
      }));
      dataSource = "easyteam";
      req.log.info({ periodKey, companyId, employees: hoursByEmp.size }, "Used export webhook data for approval");
    }
  }

  // ── Step 2: REST API attempt (EasyTeam REST timesheets endpoint) ──
  // Note: in sandbox, this returns [] because timesheets only appear after formal submission.
  // This path will succeed in production when timesheets are submitted by employees.
  if (dataSource !== "easyteam" && locationId) {
    const result = await fetchEasyTeamShiftsForLocation(locationId, fromDate, toDate, companyId);
    req.log.info({ locationId, companyId, result: "error" in result ? result.error : `${result.shifts.length} shifts` }, "EasyTeam REST API fetch result");

    if ("shifts" in result && result.shifts.length > 0) {
      const normTs = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
      // Use local date via utcStartTime + utcOffset (same logic as the main sync).
      const fromDateStr2 = fromDate.toISOString().split("T")[0]!;
      const toDateStr2   = toDate.toISOString().split("T")[0]!;
      const inRange = result.shifts.filter((s) => {
        const ts = s.utcStartTime ?? (s.startTime ? normTs(s.startTime) : null);
        if (!ts) return false;
        const ld = shiftLocalDate(ts, s.utcOffset ?? 0);
        return ld >= fromDateStr2 && ld <= toDateStr2;
      });

      if (inRange.length > 0) {
        const minutesByEmployee = new Map<string, number>();
        const breaksByEmployee = new Map<string, number>();
        for (const shift of inRange) {
          // Use shiftDurationMinutes — handles ms vs minutes ambiguity in payableDuration
          minutesByEmployee.set(shift.employeeId, (minutesByEmployee.get(shift.employeeId) ?? 0) + shiftDurationMinutes(shift));
          breaksByEmployee.set(shift.employeeId, (breaksByEmployee.get(shift.employeeId) ?? 0) + breakDurationMinutes(shift));
        }

        const companyUsers = store.getUsersForCompany(companyId);
        for (const [etEmployeeId, totalMinutes] of minutesByEmployee) {
          // Resolve EasyTeam UUID → internal ID; skip if not in our registry
          const internalEmpId = store.resolveEasyTeamUuid(etEmployeeId);
          if (internalEmpId === etEmployeeId) {
            req.log.warn({ etEmployeeId }, "Approve: skipping shift for unrecognised EasyTeam UUID");
            continue;
          }
          // Location scope: skip employees outside the manager's location
          if (locationEmpIds && !locationEmpIds.has(internalEmpId)) continue;
          const matchedUser = companyUsers.find((u) => u.employeeId === internalEmpId);
          const resolvedCompanyId = matchedUser?.companyId ?? companyId;
          const hoursWorked = Math.round((totalMinutes / 60) * 10000) / 10000;
          // Never overwrite existing data with zero — skip employees whose EasyTeam data
          // is empty/reset so we preserve the last known good value.
          if (hoursWorked <= 0) continue;
          const breakHours  = Math.round(((breaksByEmployee.get(etEmployeeId) ?? 0) / 60) * 10000) / 10000;
          await upsertTimesheetEntry({
            employeeId: internalEmpId,
            companyId: resolvedCompanyId,
            periodKey,
            hoursWorked,
            breakDeduction: breakHours,
            approvedHours: Math.max(0, Math.round((hoursWorked - breakHours) * 10000) / 10000),
            source: "easyteam",
            syncedAt: new Date().toISOString(),
          });
        }
        dataSource = "easyteam";
        req.log.info({ periodKey, companyId, locationId, shifts: inRange.length }, "Fetched real EasyTeam REST hours for approval");
      } else {
        req.log.info({ periodKey, locationId }, "EasyTeam REST: no shifts in date range");
      }
    } else {
      const errMsg = "error" in result ? result.error : "Empty timesheets (not yet submitted in EasyTeam)";
      req.log.info({ periodKey, locationId, note: errMsg }, "EasyTeam REST API returned no data — falling back to seed");
    }
  }

  // ── Step 3: Ensure every in-scope employee has an entry for this period ──
  // If any employee has no entry (0 hours from EasyTeam), write an explicit 0-hour record.
  // This prevents the payroll fallback from picking up stale approvals from a prior period.
  // For managers: only ensure coverage for employees in their own location.
  const existing = store.getTimesheetEntriesForPeriod(periodKey).filter((e) => e.companyId === companyId);
  const existingEmpIds = new Set(existing.map((e) => e.employeeId));
  // Include managers with an employeeId — promoted employees retain their timesheet identity
  let companyStaff = store.getAllStaffUsers()
    .filter((u) => u.employeeId && u.companyId === companyId && (u.role === "employee" || u.role === "manager"));
  // Location scope: only ensure coverage for the manager's location employees
  if (locationEmpIds) {
    companyStaff = companyStaff.filter((u) => u.employeeId != null && locationEmpIds!.has(u.employeeId));
  }
  const zeroNow = new Date().toISOString();
  const missingStaff = companyStaff.filter((u) => !existingEmpIds.has(u.employeeId!));
  for (const u of missingStaff) {
    await upsertTimesheetEntry({
      employeeId: u.employeeId!,
      companyId,
      periodKey,
      hoursWorked: 0,
      breakDeduction: 0,
      approvedHours: 0,
      source: "easyteam",
      syncedAt: zeroNow,
    });
  }
  if (missingStaff.length > 0) {
    req.log.info({ count: missingStaff.length, periodKey, missing: missingStaff.map((u) => u.employeeId) }, "Wrote 0-hour entries for employees with no EasyTeam shifts this period");
  }

  // Approve all entries for the period; then narrow to the manager's location scope.
  // store.approveTimesheetEntries marks entries in memory and returns them for processing —
  // we then filter before writing to timesheet_approvals so a LOC-A manager cannot create
  // approval records for employees belonging to LOC-B.
  let approved = store.approveTimesheetEntries(periodKey, companyId, userId);
  if (locationEmpIds) {
    const beforeCount = approved.length;
    approved = approved.filter((e) => locationEmpIds!.has(e.employeeId));
    req.log.info({ before: beforeCount, after: approved.length, periodKey }, "Approve: filtered approved entries to location scope");
  }
  const now = new Date().toISOString();

  // Build final approved entries — apply any manager-supplied hour overrides
  const approvedEntries = await Promise.all(approved.map(async (entry) => {
    const override     = managerOverrides.get(entry.employeeId);
    const finalHours   = override != null ? override.approvedHours : entry.approvedHours;
    const managerEdited = override != null
      ? Math.abs(finalHours - entry.approvedHours) > 0.01
      : false;

    // Look up Rollfi user ID so payroll can reference this record without a separate join
    const rollfiEmp = store.getRollfiEmployee(entry.employeeId);

    // Write to the dedicated timesheet_approvals table — payroll source of truth
    await upsertTimesheetApproval({
      employeeId:          entry.employeeId,
      rollfiUserId:        rollfiEmp?.rollfiUserId ?? null,
      companyId:           entry.companyId,
      periodKey:           entry.periodKey,
      hoursWorked:         entry.hoursWorked,
      breakDeduction:      entry.breakDeduction,
      approvedHours:       finalHours,
      approvedAt:          now,
      approvedByManagerId: userId,
      source:              managerEdited ? "manager_edit" : "easyteam_sync",
      managerEdited,
      managerEditNote:     override?.managerEditNote ?? null,
    });

    // Also keep timesheet_entries in sync for backward compat
    await upsertTimesheetEntry({ ...entry, approvedHours: finalHours });

    return { ...entry, approvedHours: finalHours };
  }));

  req.log.info({ periodKey, companyId, count: approvedEntries.length, userId, dataSource }, "Manager approved timesheet hours");
  res.json({ success: true, periodKey, approved: approvedEntries.length, dataSource, entries: approvedEntries });
});

// Debug-only endpoint — shows raw EasyTeam REST API response for a given location
router.get("/easyteam/debug/shifts", requireRole("super_admin", "owner"), async (req, res) => {
  const locationId = (req.query.locationId as string) || "LOC-RAINBOW";
  if (!EASYTEAM_API_KEY) { res.status(500).json({ error: "No API key" }); return; }

  let exchangeToken: string | null = null;
  let exchangeError: string | null = null;
  let rawResponse: unknown = null;
  let rawError: string | null = null;

  // Step 1: exchange — use the manager for this location (same JWT structure as auth.ts)
  const mgr = store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner"));
  if (!mgr?.employeeId) { res.json({ error: `No manager for ${locationId}` }); return; }

  // Resolve the company that owns this location (for correct per-company org scoping)
  const [debugLocRow] = await db
    .select({ companyId: locationsTable.companyId })
    .from(locationsTable)
    .where(eq(locationsTable.id, locationId))
    .catch(() => [undefined]);
  const debugCompanyId = debugLocRow?.companyId ?? mgr.companyId;

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: mgr.employeeId,
        organizationId: resolveEasyTeamOrgId(debugCompanyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: { name: "manager", permissions: ["LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"] },
        role: { name: mgr.position ?? "Daycare Manager", hourlyWage: 25 },
        wage: 25,
        wageType: "hourly",
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "8h" }
    );
    const ex = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    exchangeToken = ex.data.accessToken ? "ok" : "empty";

    // Step 2: decode the access token to extract EasyTeam's internal org UUID
    const bearerToken = ex.data.accessToken;
    let decodedToken: Record<string, unknown> = {};
    try {
      const parts = bearerToken.split(".");
      if (parts.length === 3) {
        const payload = Buffer.from(parts[1], "base64url").toString("utf8");
        decodedToken = JSON.parse(payload) as Record<string, unknown>;
      }
    } catch { /* ignore decode errors */ }

    // Step 3: try different org ID forms and base paths
    const internalOrgId = (decodedToken.organizationId ?? decodedToken.org_id ?? decodedToken.sub ?? "ORG-BRIGHTBRIDGE") as string;
    const internalLocId = (decodedToken.locationId ?? decodedToken.location_id ?? locationId) as string;

    const base = `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/locations/${internalLocId}`;
    const candidateUrls = [
      `${base}/timesheets`,
      `${base}/shifts`,
      `${base}/clock-ins`,
      `${base}/time-entries`,
    ];

    const trialResults: Record<string, unknown> = { decodedToken, internalOrgId, internalLocId };
    for (const url of candidateUrls) {
      try {
        const r = await axios.get(url, {
          headers: { Authorization: `Bearer ${bearerToken}` },
          params: { limit: 10, page: 1 },
          timeout: 8000,
          validateStatus: () => true,
        });
        trialResults[url] = { status: r.status, data: typeof r.data === "string" ? r.data.slice(0, 200) : r.data };
      } catch (e2) {
        const e = e2 as { message?: string };
        trialResults[url] = { error: e.message };
      }
    }
    rawResponse = trialResults;
  } catch (e) {
    const err = e as { message?: string; response?: { status?: number; data?: unknown } };
    exchangeError = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : (err.message ?? "Unknown");
  }

  res.json({ locationId, exchangeToken, exchangeError, rawResponse, rawError });
});

// ── Unmatched-hours diagnostic ────────────────────────────────────────────────
// Fetches raw EasyTeam shifts for a period, groups by employee UUID, resolves
// known UUIDs to BrightBridge names, and surfaces unrecognised UUIDs with their hours.
router.get("/easyteam/debug/unmatched-shifts", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  // Company-scope guard: owner/manager may only query their own company.
  if (!assertCompanyAccess(req, res, companyId)) return;

  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  const locationId = await resolveCompanyLocationId(companyId);
  if (!locationId) { res.status(400).json({ error: "No location found for this company" }); return; }

  const result = await fetchEasyTeamShiftsForLocation(locationId, fromDate, toDate, companyId);
  if ("error" in result) { res.status(502).json({ error: result.error }); return; }

  const etLocId = result.easyteamLocationId;
  const fromStr = fromDate.toISOString().split("T")[0]!;
  const toStr   = toDate.toISOString().split("T")[0]!;

  // Filter to this location + date range (same logic as sync)
  const inRange = result.shifts.filter((s) => {
    if (!s.utcStartTime || s.locationId !== etLocId) return false;
    const ld = shiftLocalDate(s.utcStartTime, s.utcOffset ?? 0);
    return ld >= fromStr && ld <= toStr;
  });

  // Group minutes + break minutes by EasyTeam employee UUID
  const minutesByUuid  = new Map<string, number>();
  const breakByUuid    = new Map<string, number>();
  for (const s of inRange) {
    minutesByUuid.set(s.employeeId, (minutesByUuid.get(s.employeeId) ?? 0) + shiftDurationMinutes(s));
    breakByUuid.set(s.employeeId,   (breakByUuid.get(s.employeeId)   ?? 0) + breakDurationMinutes(s));
  }

  // Build a reverse map: internal employeeId → name  (all staff users)
  const nameByInternalId = new Map<string, string>(
    store.getAllStaffUsers().map((u) => [u.employeeId ?? "", u.name])
  );

  const matched:   Array<{ etUuid: string; employeeId: string; name: string; hoursWorked: number; breakHours: number }> = [];
  const unmatched: Array<{ etUuid: string; hoursWorked: number; breakHours: number }> = [];

  for (const [etUuid, totalMinutes] of minutesByUuid) {
    const internalId  = store.resolveEasyTeamUuid(etUuid);
    const hoursWorked = Math.round((totalMinutes / 60) * 100) / 100;
    const breakHours  = Math.round(((breakByUuid.get(etUuid) ?? 0) / 60) * 100) / 100;
    if (internalId !== etUuid) {
      matched.push({ etUuid, employeeId: internalId, name: nameByInternalId.get(internalId) ?? internalId, hoursWorked, breakHours });
    } else {
      unmatched.push({ etUuid, hoursWorked, breakHours });
    }
  }

  const totalMatched   = matched.reduce((s, e) => s + e.hoursWorked, 0);
  const totalUnmatched = unmatched.reduce((s, e) => s + e.hoursWorked, 0);

  res.json({
    period: { from: fromStr, to: toStr },
    totalShifts: inRange.length,
    matched,
    unmatched,
    summary: {
      matchedEmployees:   matched.length,
      unmatchedEmployees: unmatched.length,
      totalMatchedHours:   Math.round(totalMatched   * 100) / 100,
      totalUnmatchedHours: Math.round(totalUnmatched * 100) / 100,
    },
  });
});

// ── Remove unmatched EasyTeam UUID (blocklist + best-effort shift deletion) ──
// Adds the UUID to the persistent blocklist so it is skipped on every future sync.
// Also attempts to DELETE each shift from EasyTeam's API (best-effort — some API
// plans don't support shift deletion; the blocklist fires regardless).
router.post("/easyteam/debug/remove-uuid", requireRole("super_admin", "owner", "manager"), async (req, res) => {
  const { etUuid, companyId, from, to } = req.body as { etUuid?: string; companyId?: string; from?: string; to?: string };
  if (!etUuid)     { res.status(400).json({ error: "etUuid required" });     return; }
  if (!companyId)  { res.status(400).json({ error: "companyId required" });  return; }
  // Company-scope guard: owner/manager may only remove UUIDs for their own company.
  if (!assertCompanyAccess(req, res, companyId)) return;

  // 1. Fetch shifts first — validate UUID belongs to this company's location before blocklisting.
  //    This prevents a manager from blocklisting a UUID that doesn't appear in their shifts at all.
  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 60 * 24 * 60 * 60 * 1000); // look back 60 days

  const locationId = await resolveCompanyLocationId(companyId);
  let shiftsDeleted = 0;
  let deleteErrors: string[] = [];
  let belongsToCompany = false;

  if (locationId) {
    const result = await fetchEasyTeamShiftsForLocation(locationId, fromDate, toDate, companyId);
    if (!("error" in result)) {
      const etLocId = result.easyteamLocationId;
      const fromStr = fromDate.toISOString().split("T")[0]!;
      const toStr   = toDate.toISOString().split("T")[0]!;

      const targetShifts = result.shifts.filter((s) => {
        const startTime = s.utcStartTime ?? s.startTime;
        if (!startTime) return false; // skip shifts with no timestamp (can't determine date)
        const ld = shiftLocalDate(startTime, s.utcOffset ?? 0);
        return s.employeeId === etUuid && s.locationId === etLocId && ld >= fromStr && ld <= toStr;
      });

      // Validate ownership fail-closed: only blocklist when at least one matching shift was found.
      // An empty API response (empty period or API outage) is NOT sufficient to authorize blocklisting.
      belongsToCompany = targetShifts.length > 0;
      if (!belongsToCompany) {
        res.status(403).json({ error: "This EasyTeam UUID has no shifts in your company's location. Cannot blocklist." });
        return;
      }

      // Generate a token with SHIFT_DELETE permission for the delete calls
      // Exchange a properly-signed RS256 JWT to get an access token + real internal IDs.
      // Previous code used HS256 (wrong algorithm) and the raw JWT as a Bearer (also wrong);
      // the delete URL also hardcoded the org string instead of the real internal org UUID.
      const deleteAuth = result.shifts[0] ? await (async () => {
        try {
          const managerUser =
            store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner")) ??
            store.getAllStaffUsers().find((u) => u.role === "super_admin" && u.employeeId);
          if (!managerUser?.employeeId) return null;
          const rawJwt = jwt.sign(
            {
              employeeId: managerUser.employeeId,
              organizationId: resolveEasyTeamOrgId(companyId),
              locationId,
              ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
              accessRole: {
                name: "manager",
                permissions: ["LOCATION_ADMIN", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_DELETE", "TIMESHEET_READ", "TIMESHEET_WRITE"],
              },
              role: { name: "Daycare Manager", hourlyWage: 25 },
              wage: 25, wageType: "hourly",
              features: { geolocation: false },
            },
            EASYTEAM_API_KEY!,
            { expiresIn: "1h", algorithm: "RS256" }
          );
          const exResp = await axios.post<{ accessToken: string }>(
            `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
            { token: rawJwt },
            { timeout: 8000 }
          );
          const accessToken = exResp.data.accessToken;
          let internalOrgId = resolveEasyTeamOrgId(companyId);
          let internalLocId = locationId;
          try {
            const parts = accessToken.split(".");
            if (parts.length === 3) {
              const p = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
              if (typeof p.organizationId === "string") internalOrgId = p.organizationId;
              if (typeof p.locationId === "string") internalLocId = p.locationId;
            }
          } catch { /* keep defaults */ }
          return { accessToken, internalOrgId, internalLocId };
        } catch { return null; }
      })() : null;

      if (deleteAuth) {
        for (const s of targetShifts) {
          const deleteUrl = `${EASYTEAM_EMBED_API}/organizations/${deleteAuth.internalOrgId}/locations/${deleteAuth.internalLocId}/shifts/${s.id}`;
          try {
            const dr = await axios.delete(deleteUrl, {
              headers: { Authorization: `Bearer ${deleteAuth.accessToken}` },
              timeout: 8000,
              validateStatus: () => true,
            });
            if (dr.status >= 200 && dr.status < 300) {
              shiftsDeleted++;
            } else {
              deleteErrors.push(`Shift ${s.id}: HTTP ${dr.status}`);
            }
          } catch (e) {
            deleteErrors.push(`Shift ${s.id}: ${(e as { message?: string }).message ?? "error"}`);
          }
        }
      }
    }
  }

  // 2. Persist to DB blocklist (company-scoped composite key) and update in-memory map.
  //    This runs after validation so we only blocklist UUIDs that belong to this company.
  //    Falls through even if no locationId — assertCompanyAccess already verified scope.
  await pool.query(
    `INSERT INTO easyteam_ignored_uuids (et_uuid, company_id, reason)
     VALUES ($1, $2, 'Manually removed via debug panel')
     ON CONFLICT (et_uuid, company_id) DO NOTHING`,
    [etUuid, companyId]
  );
  store.ignoreEasyTeamUuid(etUuid, companyId);

  res.json({
    blocklisted: true,
    etUuid,
    shiftsDeleted,
    deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
    note: shiftsDeleted === 0 && deleteErrors.length === 0
      ? "UUID blocklisted. EasyTeam shift deletion was not attempted (no location token or no shifts found in range). Hours will no longer appear in future syncs."
      : undefined,
  });
});

router.post("/easyteam/webhook", (req, res) => {
  const payload = req.body as {
    event?: string;
    employee_id?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  };

  const entry = {
    id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event: payload.event ?? "unknown",
    employee_id: payload.employee_id ?? "",
    timestamp: payload.timestamp ?? new Date().toISOString(),
    data: payload.data ?? (payload as Record<string, unknown>),
    status: "received",
  };

  webhookLog.unshift(entry);
  if (webhookLog.length > 50) webhookLog.splice(50);

  req.log.info({ event: entry.event, employee_id: entry.employee_id }, "Webhook received");
  res.json({ received: true, id: entry.id });
});

router.get("/easyteam/webhooks", requireRole("super_admin", "owner"), (_req, res) => {
  res.json({ events: webhookLog, total: webhookLog.length });
});

router.post("/easyteam/webhook/export", async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signatureHeader = req.headers["x-convoy-signature"] as string | undefined;
  const isProd = process.env.NODE_ENV === "production";

  // ── HMAC verification (EasyTeam always signs; hard-reject enforced) ────────
  // EasyTeam signs every export webhook via Convoy.  EASYTEAM_WEBHOOK_SECRET
  // (or legacy CONVOY_WEBHOOK_SECRET) must be set.  Missing/invalid → 401 in
  // all environments including production.
  let signatureValid = false;
  if (!CONVOY_WEBHOOK_SECRET) {
    // Secret is missing — this is a misconfiguration regardless of environment.
    req.log.error(
      { path: req.path },
      "EASYTEAM_WEBHOOK_SECRET not set — rejecting unverified EasyTeam export webhook (EasyTeam always signs)",
    );
    res.status(401).json({ error: "Webhook signature verification not configured" });
    return;
  } else {
    // Secret is set — full verification; hard-reject on any failure.
    if (!signatureHeader) {
      req.log.warn({ path: req.path }, "Export webhook rejected: missing x-convoy-signature header");
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }
    signatureValid = verifyConvoySignature(rawBody, signatureHeader, CONVOY_WEBHOOK_SECRET);
    if (signatureValid) {
      req.log.info({ sig: signatureHeader.slice(0, 24) + "…" }, "Export webhook signature verified OK");
    } else {
      req.log.warn({ signatureHeader }, "Export webhook rejected: HMAC signature mismatch");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const payload = req.body as {
    event_type?: string;
    data?: {
      type?: string;
      organizationId?: string;
      requestedBy?: string;
      startDate?: string;
      endDate?: string;
      locations?: string[];
      employees?: string[];
      roles?: string[];
      url?: string;
    };
  };

  const data = payload.data ?? {};
  const entryId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const entry: ExportLogEntry = {
    id: entryId,
    receivedAt: new Date().toISOString(),
    requestedBy: data.requestedBy ?? "unknown",
    organizationId: data.organizationId ?? "unknown",
    startDate: data.startDate,
    endDate: data.endDate,
    employeeCount: data.employees?.length ?? 0,
    shiftCount: 0,
    status: "fetching",
    signatureValid,
  };

  exportLog.unshift(entry);
  if (exportLog.length > 20) exportLog.splice(20);

  req.log.info({ id: entryId, requestedBy: data.requestedBy, url: data.url }, "Export webhook received — fetching data");

  // Acknowledge immediately, then fetch data in background
  res.json({ received: true, id: entryId });

  if (data.url) {
    try {
      const response = await axios.get<ExportShift[]>(data.url, { timeout: 15000 });
      const shifts = Array.isArray(response.data) ? response.data : [];
      entry.shifts = shifts;
      entry.shiftCount = shifts.length;
      entry.status = "ready";
      req.log.info({ id: entryId, shiftCount: shifts.length }, "Export data fetched successfully");
    } catch (err) {
      const error = err as Error;
      entry.status = "error";
      entry.error = error.message;
      req.log.error({ id: entryId, error: error.message }, "Failed to fetch export data");
    }
  } else {
    entry.status = "error";
    entry.error = "No download URL provided in webhook payload";
  }
});

router.get("/easyteam/exports", requireRole("super_admin", "owner"), (_req, res) => {
  res.json({ exports: exportLog, total: exportLog.length });
});

// ── Shift flag thresholds — will become configurable per-company later ───────
const SHIFT_THRESHOLDS = {
  MISSED_PUNCH_HOURS:  16, // active shift older than this (hours) → missedPunch
  EXTENDED_BREAK_MIN:  60, // any single break longer than this (minutes) → extendedBreak
  LONG_SHIFT_HOURS:    10, // payableDurationMs > this * 3_600_000 → longShift
} as const;

// ── GET /api/timesheets/shifts — company-scoped shift store with computed flags ──
router.get("/timesheets/shifts", requireRole("super_admin", "owner", "manager"), async (req, res) => {

  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  if (!from || !to)  { res.status(400).json({ error: "from and to dates are required" }); return; }

  const fromDate = new Date(from);
  const toDate   = new Date(to + "T23:59:59.999Z");
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid date format for from/to" }); return;
  }

  const rows = await getTimesheetShiftsByCompanyAndRange(companyId, fromDate, toDate);
  const now  = Date.now();

  const shifts = rows.map((r) => {
    const startMs   = new Date(r.utcStartTime).getTime();
    const ageHours  = (now - startMs) / 3_600_000;

    const missedPunch = !!r.active && ageHours > SHIFT_THRESHOLDS.MISSED_PUNCH_HOURS;

    const breaksArr = Array.isArray(r.breaks)
      ? (r.breaks as Array<{ startTime: string; endTime: string }>)
      : [];
    const extendedBreak = breaksArr.some((b) => {
      const bs = new Date(b.startTime).getTime();
      const be = new Date(b.endTime).getTime();
      return !isNaN(bs) && !isNaN(be) && (be - bs) / 60_000 > SHIFT_THRESHOLDS.EXTENDED_BREAK_MIN;
    });

    const longShift = r.payableDurationMs > SHIFT_THRESHOLDS.LONG_SHIFT_HOURS * 3_600_000;

    return { ...r, missedPunch, extendedBreak, longShift };
  });

  // ── Wage map: employeeId → dollars (our DB, always current) ─────────────────
  // Priority: employees table (People module writes here) → user_accounts table
  // → in-memory store seed (last resort for employees with no DB record yet).
  // The store seed is intentionally last — it holds the original seed wage and
  // is never updated when the user edits pay rate through the UI.
  const wageMap = new Map<string, number>();
  const allShiftEmpIds = [...new Set(shifts.map(s => s.employeeId).filter((id): id is string => !!id))];

  if (allShiftEmpIds.length > 0) {
    // 1. employees table — authoritative; People module saves wage edits here
    const dbEmps = await db
      .select({ id: employeesTable.id, hourlyWage: employeesTable.hourlyWage })
      .from(employeesTable)
      .where(inArray(employeesTable.id, allShiftEmpIds));
    for (const e of dbEmps) {
      if (e.hourlyWage != null) wageMap.set(e.id, e.hourlyWage / 100);
    }
    // 2. In-memory store — last resort for test-only employees with no DB record
    const needFromStore = allShiftEmpIds.filter(id => !wageMap.has(id));
    for (const u of store.getAllStaffUsers()) {
      if (u.employeeId && needFromStore.includes(u.employeeId) && u.hourlyWage != null) {
        wageMap.set(u.employeeId, u.hourlyWage / 100);
      }
    }
  }

  // Labor cost = payable hours × current wage (not EasyTeam's stale frozen wage)
  const laborCost = Math.round(
    shifts.reduce((sum, s) => {
      const wage = s.employeeId ? (wageMap.get(s.employeeId) ?? 0) : 0;
      return sum + (s.payableDurationMs / 3_600_000) * wage;
    }, 0) * 100
  ) / 100;

  const summary = {
    totalShifts:        shifts.length,
    totalPayableHours:  Math.round(shifts.reduce((s, r) => s + r.payableDurationMs, 0) / 3_600_000 * 100) / 100,
    activeNow:          shifts.filter((r) => r.active && !r.utcEndTime).length,
    missedPunchCount:   shifts.filter((r) => r.missedPunch).length,
    extendedBreakCount: shifts.filter((r) => r.extendedBreak).length,
    laborCost,
  };

  res.json({ companyId, from, to, summary, shifts });
});

// ── GET /api/timesheets/trend — proxy EasyTeam /timesheets/reports for trend chart ──
router.get("/timesheets/trend", requireRole("super_admin", "owner", "manager"), async (req, res) => {

  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  if (!assertCompanyAccess(req, res, companyId)) return;
  if (!from || !to)  { res.status(400).json({ error: "from and to dates are required — omitting them returns 0-day response" }); return; }

  const fromDate = new Date(from);
  const toDate   = new Date(to + "T23:59:59.999Z");
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid date format for from/to" }); return;
  }

  if (!EASYTEAM_API_KEY) { res.status(503).json({ error: "EasyTeam API key not configured" }); return; }

  try {
    // Resolve a manager/owner user for this company to sign the JWT
    let managerUser = store.getAllStaffUsers()
      .find((u) => u.companyId === companyId && (u.role === "manager" || u.role === "owner" || u.role === "super_admin") && u.employeeId);
    if (!managerUser?.employeeId) {
      const [dbManager] = await db.select().from(userAccountsTable)
        .where(and(eq(userAccountsTable.companyId, companyId), inArray(userAccountsTable.role, ["manager", "owner"])));
      if (dbManager?.employeeId) {
        managerUser = { id: dbManager.id, name: dbManager.name ?? "Manager", email: dbManager.email,
          role: "owner", companyId, employeeId: dbManager.employeeId,
          locationId: dbManager.locationId ?? "", position: dbManager.position ?? "Manager" };
      }
    }
    if (!managerUser?.employeeId) { res.status(503).json({ error: "No manager user found for company" }); return; }

    const co = store.getCompany(companyId);
    const locationId = co?.locationId ?? managerUser.locationId ?? "";

    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: resolveEasyTeamOrgId(companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "manager",
          permissions: [
            "LOCATION_ADMIN", "LOCATION_READ",
            "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE",
            "SCHEDULE_READ", "SCHEDULE_WRITE",
            "TIMESHEET_READ", "TIMESHEET_WRITE",
          ],
        },
        role: { name: managerUser.position ?? "Manager", hourlyWage: 25 },
        wage: 25,
        wageType: "hourly",
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "1h" }
    );

    const exchangeResp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    const accessToken = exchangeResp.data.accessToken;

    const startDateStr = fromDate.toISOString().split("T")[0]!;
    const endDateStr   = toDate.toISOString().split("T")[0]!;
    // Same required-dates guard as the sync — missing dates return 0-day response with HTTP 200
    const reportsUrl = `${EASYTEAM_EMBED_API}/timesheets/reports?startDate=${startDateStr}&endDate=${endDateStr}`;

    const r = await axios.get(reportsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });

    const responseData = r.data as { days?: unknown[]; totals?: unknown };
    if (Array.isArray(responseData.days) && responseData.days.length > 0) {
      req.log.info({ sample: responseData.days[0] }, "timesheets/trend: sample days[0] shape");
    }
    res.json(responseData);
  } catch (err) {
    const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = axErr.response
      ? `HTTP ${axErr.response.status}: ${JSON.stringify(axErr.response.data)}`
      : (axErr.message ?? "Unknown error");
    req.log.error({ companyId, error: detail }, "timesheets/trend: EasyTeam reports proxy failed");
    res.status(502).json({ error: "EasyTeam reports request failed", detail });
  }
});

// ── Location timezone management ──────────────────────────────────────────────────────
//
// EasyTeam auto-creates a location record the first time it sees a locationId in a JWT, but
// it uses the *partner account* timezone as the default because no timezone is supplied during
// that implicit creation. The result: all shifts carry the wrong timezone label even though the
// clock-in/clock-out local times are correct.
//
// Fix: call PATCH on the EasyTeam location record to set the correct IANA timezone. This is
// idempotent — calling it multiple times is safe.
//
// Multi-state support: the `timezone` parameter is the IANA name for the company's state
// (e.g. "America/Chicago" for Illinois, "America/Los_Angeles" for California). Currently the
// server hardcodes "America/New_York" for all companies because all demo companies are in NJ.
// When wizard-created companies support a state field, derive the timezone from that field and
// pass it here instead.

// EasyTeam location registration note:
// EasyTeam does NOT accept a `timezone` IANA string on PATCH. Instead it derives the timezone
// from `country` + `state` fields. Setting these is idempotent and safe to repeat on every boot.
//
// Multi-state support: pass the ISO 3166-1 country code ("US") and the state abbreviation
// ("NJ", "CA", "IL", etc.) that matches the company's physical location. EasyTeam maps the
// state to its IANA timezone internally:
//   NJ / NY / MA / CT / PA → America/New_York
//   IL / MO / TN           → America/Chicago
//   CA / WA / OR           → America/Los_Angeles
//   AZ                     → America/Phoenix
// For wizard-created companies, add a `state` field to the company record and pass it here.
// Currently defaults to US/NJ because all demo companies are in New Jersey.

export async function ensureLocationTimezone(
  locationId: string,
  opts: { country?: string; state?: string; companyId?: string } = {}
): Promise<{ ok: boolean; detail?: string }> {
  if (!EASYTEAM_API_KEY) return { ok: false, detail: "No API key" };

  const country = opts.country ?? "US";
  const state   = opts.state   ?? "NJ";

  // Reuse a manager user registered under this location to sign the admin JWT.
  let managerUser = store.getAllStaffUsers().find(
    (u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner")
  );
  if (!managerUser?.employeeId) {
    managerUser = store.getAllStaffUsers().find((u) => u.role === "super_admin" && u.employeeId);
  }
  if (!managerUser?.employeeId) return { ok: false, detail: `No manager found for location ${locationId}` };

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: resolveEasyTeamOrgId(opts.companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "manager",
          permissions: ["LOCATION_ADMIN", "LOCATION_READ", "ORGANIZATION_ADMIN"],
        },
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 25 },
        wage: 25, wageType: "hourly",
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "1h" }
    );

    const exchangeResp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    const accessToken = exchangeResp.data.accessToken;

    // Decode the access token to get EasyTeam's internal UUIDs
    let internalOrgId = "ORG-BRIGHTBRIDGE";
    let internalLocId = locationId;
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof payload.organizationId === "string") internalOrgId = payload.organizationId;
        if (typeof payload.locationId === "string") internalLocId = payload.locationId;
      }
    } catch { /* keep defaults */ }

    const patchUrl = `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/locations/${internalLocId}`;
    // EasyTeam derives timezone from country + state — it does not accept an IANA timezone string.
    await axios.patch(
      patchUrl,
      { country, state },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 }
    );

    logger.info({ locationId, internalLocId, country, state, patchUrl }, "ensureLocationTimezone: country/state patched");
    return { ok: true };
  } catch (err) {
    const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = axErr.response
      ? `HTTP ${axErr.response.status}: ${JSON.stringify(axErr.response.data)}`
      : (axErr.message ?? "Unknown");
    logger.warn({ locationId, country, state, detail }, "ensureLocationTimezone: PATCH failed (non-fatal)");
    return { ok: false, detail };
  }
}

// ── Ensure a time-off policy exists for the organisation ──────────────────────────────────────
// Without at least one policy, EasyTeam's "Time off" panel leaves the policy dropdown empty and
// disables the Save button. This function creates a default policy if none exist yet. Idempotent.
export async function ensureTimeOffPolicy(
  locationId: string,
  opts: { policyName?: string; companyId?: string } = {},
): Promise<{ ok: boolean; detail?: string }> {
  if (!EASYTEAM_API_KEY) return { ok: false, detail: "No API key" };

  const policyName = opts.policyName ?? "Standard Time Off";

  // Reuse a manager/owner under this location to sign the admin JWT.
  let managerUser = store.getAllStaffUsers().find(
    (u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner")
  );
  if (!managerUser?.employeeId) {
    managerUser = store.getAllStaffUsers().find((u) => u.role === "super_admin" && u.employeeId);
  }
  if (!managerUser?.employeeId) return { ok: false, detail: `No manager found for location ${locationId}` };

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: resolveEasyTeamOrgId(opts.companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "manager",
          permissions: ["LOCATION_ADMIN", "LOCATION_READ", "ORGANIZATION_ADMIN", "SHIFT_READ", "SHIFT_WRITE"],
        },
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 25 },
        wage: 25, wageType: "hourly",
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "1h" }
    );

    const exchangeResp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: adminJwt },
      { timeout: 8000 }
    );
    const accessToken = exchangeResp.data.accessToken;

    // Decode the access token to get EasyTeam's internal org UUID.
    let internalOrgId = "ORG-BRIGHTBRIDGE";
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const p = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof p.organizationId === "string") internalOrgId = p.organizationId;
      }
    } catch { /* keep defaults */ }

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Check whether any policies already exist.
    const listUrl = `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/time-off-policies`;
    let existing: unknown[] = [];
    try {
      const listResp = await axios.get<unknown>(listUrl, { headers, timeout: 8000 });
      const data = listResp.data as { data?: unknown[]; policies?: unknown[] } | unknown[];
      if (Array.isArray(data)) existing = data;
      else if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        existing = (Array.isArray(obj.data) ? obj.data : Array.isArray(obj.policies) ? obj.policies : []) as unknown[];
      }
    } catch (e) {
      const axErr = e as { response?: { status?: number } };
      // 404 means the endpoint exists but returned no results — treat as empty, proceed to create.
      if (axErr.response?.status !== 404) throw e;
    }

    if (existing.length > 0) {
      logger.info({ locationId, internalOrgId, count: existing.length }, "ensureTimeOffPolicy: policies already exist, skipping");
      return { ok: true, detail: "already exists" };
    }

    // Create a minimal default policy.
    await axios.post(
      listUrl,
      { name: policyName, isActive: true, type: "custom", accrualType: "unlimited" },
      { headers, timeout: 8000 }
    );

    logger.info({ locationId, internalOrgId, policyName }, "ensureTimeOffPolicy: created default policy");
    return { ok: true };
  } catch (err) {
    const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = axErr.response
      ? `HTTP ${axErr.response.status}: ${JSON.stringify(axErr.response.data)}`
      : (axErr.message ?? "Unknown");
    logger.warn({ locationId, detail }, "ensureTimeOffPolicy: failed (non-fatal)");
    return { ok: false, detail };
  }
}

// At startup, patch country+state for all seeded locations whose EasyTeam record may have no
// location data (causing EasyTeam to default to the partner account's timezone). Idempotent.
// Runs after a short delay so the server is fully up before making outbound calls.
setTimeout(() => {
  if (!EASYTEAM_API_KEY) return;
  const seedLocations: Array<{ locationId: string; country: string; state: string; companyId: string }> = [
    { locationId: "LOC-SUNSHINE", country: "US", state: "NJ", companyId: "ORG-SUNSHINE" },
    { locationId: "LOC-RAINBOW",  country: "US", state: "NJ", companyId: "ORG-RAINBOW"  },
  ];
  for (const { locationId, country, state, companyId } of seedLocations) {
    ensureLocationTimezone(locationId, { country, state, companyId }).catch(() => { /* already logged inside */ });
    // Also ensure at least one time-off policy exists so the Save button is enabled in the SDK.
    ensureTimeOffPolicy(locationId, { companyId }).catch(() => { /* already logged inside */ });
  }
}, 5000);

// Admin endpoint: trigger country/state PATCH for any company on demand.
// POST /api/easyteam/admin/patch-location-timezone
// Body: { companyId: string, country?: string, state?: string }
// EasyTeam derives timezone from country+state — no IANA timezone string is accepted.
router.post("/easyteam/admin/patch-location-timezone", requireRole("super_admin"), async (req, res) => {
  const { companyId, country = "US", state = "NJ" } = req.body as {
    companyId?: string;
    country?: string;
    state?: string;
  };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }

  const locationId = await resolveCompanyLocationId(companyId);
  if (!locationId) { res.status(404).json({ error: "Could not resolve locationId for company" }); return; }

  const result = await ensureLocationTimezone(locationId, { country, state });
  res.json({ companyId, locationId, country, state, ...result });
});

router.post("/easyteam/test-connection", requireRole("super_admin", "owner"), async (req, res) => {
  const apiKeyPresent = !!EASYTEAM_API_KEY;
  const partnerIdPresent = !!EASYTEAM_PARTNER_ID;
  let jwtSigning = false;
  let tokenExchange = false;
  const details: Record<string, unknown> = {};

  if (apiKeyPresent) {
    try {
      jwt.sign({ test: true }, EASYTEAM_API_KEY!, { algorithm: "RS256" });
      jwtSigning = true;
      details.signingMessage = "RS256 JWT signing with private key succeeded";
    } catch (err) {
      const error = err as Error;
      details.signingError = error.message;
    }
  }

  if (jwtSigning) {
    try {
      const testPayload = {
        employeeId: "TEST-EMP",
        locationId: "TEST-LOC",
        organizationId: "TEST-ORG",
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: { name: "manager", permissions: ["SHIFT_READ"] },
      };
      const testJwt = jwt.sign(testPayload, EASYTEAM_API_KEY!, { algorithm: "RS256" });
      const response = await axios.post<{ accessToken: string }>(
        `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
        { token: testJwt },
        { timeout: 8000 }
      );
      tokenExchange = !!response.data.accessToken;
      details.exchangeMessage = "Token exchange with EasyTeam sandbox succeeded";
    } catch (err) {
      const error = err as { message?: string; response?: { status?: number; data?: unknown } };
      details.exchangeError = error.message;
      details.exchangeStatus = error.response?.status;
      details.exchangeHint = partnerIdPresent
        ? "Exchange failed even with PARTNER_ID — check your key registration with EasyTeam"
        : "Set EASYTEAM_PARTNER_ID to enable full token exchange";
    }
  }

  res.json({
    apiConnection: apiKeyPresent,
    authentication: jwtSigning,
    tokenExchange,
    webhook: true,
    partnerIdPresent,
    details,
  });
});

export default router;
