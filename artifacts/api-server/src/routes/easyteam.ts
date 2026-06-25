import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import axios from "axios";
import { store } from "../store";
import { upsertTimesheetEntry, clearTimesheetEntriesForCompanyPeriod } from "../lib/easyteam-persist.js";
import { db, companies as companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

const CONVOY_WEBHOOK_SECRET = process.env.CONVOY_WEBHOOK_SECRET;

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

router.get("/easyteam/employees", (req, res) => {
  const companyId = req.query.companyId as string | undefined;
  const users = companyId
    ? store.getUsersForCompany(companyId)
    : store.getAllStaffUsers();
  const employees = users
    .filter((u) => u.employeeId && u.role !== "super_admin" && u.role !== "parent")
    .map((u) => ({
      id: u.employeeId as string,
      name: u.name,
      role: u.role,
      companyId: u.companyId,
      timeTrackingEnabled: true,
      wage: u.hourlyWage ?? 1500,
      wageType: "hourly" as const,
    }));
  res.json({ employees });
});

router.get("/easyteam/status", (_req, res) => {
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

router.post("/easyteam/token", async (req, res) => {
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

  // Resolve client and employee from store when client_id is provided
  let resolvedLocationId = location_id || company_id || "SANDBOX-LOC-001";
  let resolvedOrgId = organization_id || company_id || "SANDBOX-ORG-001";
  let resolvedRoleName = role_name || "Manager";
  let resolvedAccessRole = access_role || "manager";
  let resolvedWage = 1500;

  if (client_id) {
    const client = store.getClient(client_id);
    if (client) {
      // Resolve the real EasyTeam location via client → linkedCompany → locationId
      const linkedCompany = client.linkedCompanyId ? store.getCompany(client.linkedCompanyId) : undefined;
      resolvedLocationId = linkedCompany?.locationId ?? client.linkedCompanyId ?? client.id;
      resolvedOrgId = "ORG-BRIGHTBRIDGE";
    }
  }

  let resolvedEtEmployeeId = employee_id;
  if (employee_id) {
    const emp = store.getEmployee(employee_id);
    if (emp) {
      if (emp.status !== "active") {
        res.status(403).json({
          success: false,
          error: `Employee is not yet active (status: ${emp.status}). Activate them first before launching the time clock.`,
        });
        return;
      }
      resolvedRoleName = emp.roleName;
      resolvedAccessRole = emp.role;
      resolvedWage = emp.wage;

      // Resolve to the staffUser's canonical employeeId so every JWT path (Super Admin
      // timesheets, Manager dashboard, Employee login, boot sync) maps to the same
      // single EasyTeam record — preventing duplicate entries per person.
      const staffUser = emp.email
        ? store.getAllStaffUsers().find((u) => u.email === emp.email)
        : undefined;
      if (staffUser?.employeeId) resolvedEtEmployeeId = staffUser.employeeId;
    }
  }

  const payload = {
    employeeId: resolvedEtEmployeeId,
    locationId: resolvedLocationId,
    organizationId: resolvedOrgId,
    ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
    accessRole: {
      name: resolvedAccessRole,
      permissions: [
        "LOCATION_READ",
        "LOCATION_ADMIN",
        "SHIFT_READ",
        "SHIFT_WRITE",
        "SHIFT_ADD",
        "SHIFT_UPDATE",
        "SCHEDULE_READ",
        "SCHEDULE_WRITE",
        "ORGANIZATION_ADMIN",
      ],
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

router.get("/easyteam/employees", (_req, res) => {
  const employees = [
    {
      id: "EMP-TEST-001",
      name: "John Smith",
      role: "manager",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1500,
      wageType: "hourly",
    },
    {
      id: "EMP-TEST-002",
      name: "Mary Johnson",
      role: "assistant",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1200,
      wageType: "hourly",
    },
    {
      id: "EMP-TEST-003",
      name: "Carlos Rivera",
      role: "cashier",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1000,
      wageType: "hourly",
    },
  ];
  res.json({ success: true, employees });
});

router.get("/easyteam/timesheets", (_req, res) => {
  res.json({
    success: true,
    timesheets: [],
    note: "Timesheet data is loaded inside the EasyTeam iframe via the SDK.",
  });
});

// ── Trigger EasyTeam export programmatically (replicates "Email Report" button) ──────
async function triggerEasyTeamExportForLocation(locationId: string): Promise<boolean> {
  if (!EASYTEAM_API_KEY) return false;
  const managerUser = store.getAllStaffUsers().find((u) => u.locationId === locationId && u.role === "manager");
  if (!managerUser?.employeeId) return false;

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: "ORG-BRIGHTBRIDGE",
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
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 2500 },
        wage: 2500, wageType: "hourly",
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

    // Try export endpoint patterns — EasyTeam fires our registered webhook when an export is triggered
    const exportEndpoints = [
      `${orgLocBase}/timesheets/export`,
      `${orgLocBase}/timesheets/email`,
      `${orgLocBase}/export`,
      `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/timesheets/export`,
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

router.post("/easyteam/hours/sync", async (req, res) => {
  const { from, to, companyId } = req.body as { from?: string; to?: string; companyId?: string };
  const toDate   = to   ? new Date(to + "T23:59:59.999Z") : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  const allStaff = store.getAllStaffUsers().filter((u) => u.employeeId && u.role !== "super_admin" && u.role !== "parent");
  const etEmps   = store.listClients().flatMap((c) => store.listEmployees(c.id));

  // Helper: scan exportLog for a matching entry, write to store + persist to DB.
  // Returns the number of entries persisted, or 0 if no usable export data was found.
  async function applyExportIfFound(): Promise<number> {
    const found = exportLog.find(
      (e) => e.status === "ready" && e.shifts && e.shifts.length > 0 &&
        (!e.startDate || new Date(e.startDate) <= toDate) &&
        (!e.endDate   || new Date(e.endDate)   >= fromDate)
    );
    if (!found?.shifts || found.shifts.length === 0) return 0;

    const hoursByEmp  = new Map<string, number>();
    const breaksByEmp = new Map<string, number>();
    for (const shift of found.shifts) {
      if (companyId) {
        const etEmp = etEmps.find((e) => e.id === shift.employeeId);
        const ru = etEmp
          ? allStaff.find((u) => u.name.toLowerCase() === etEmp.name.toLowerCase())
          : allStaff.find((u) => u.employeeId === shift.employeeId);
        if (!ru || ru.companyId !== companyId) continue;
      }
      const h = parseFloat(shift.total_paid_hours_decimal ?? "0");
      const b = parseFloat(shift.total_unpaid_hours_decimal ?? "0");
      hoursByEmp.set(shift.employeeId, (hoursByEmp.get(shift.employeeId) ?? 0) + h);
      breaksByEmp.set(shift.employeeId, (breaksByEmp.get(shift.employeeId) ?? 0) + b);
    }

    let synced = 0;
    await Promise.all(
      Array.from(hoursByEmp.entries()).map(async ([etEmpId, hours]) => {
        const etEmp = etEmps.find((e) => e.id === etEmpId);
        const rollfiUser = allStaff.find((u) =>
          u.employeeId === etEmpId || (etEmp && u.name.toLowerCase() === etEmp.name.toLowerCase())
        );
        const breakH = breaksByEmp.get(etEmpId) ?? 0;
        await upsertTimesheetEntry({
          employeeId: rollfiUser?.employeeId ?? etEmpId,
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
    return synced;
  }

  // ── Step 1: In-memory exportLog (populated by previous webhook or trigger) ──
  const step1 = await applyExportIfFound();
  if (step1 > 0) {
    req.log.info({ periodKey, companyId, synced: step1 }, "Sync: used cached export webhook data");
    res.json({ success: true, source: "easyteam", periodKey, synced: step1 });
    return;
  }

  // ── Step 2: Trigger EasyTeam export + poll for incoming webhook (up to 4 s) ──
  // Replicates what "Email Report" does inside the iframe — EasyTeam fires our webhook endpoint.
  if (EASYTEAM_API_KEY && companyId) {
    const co = store.getCompany(companyId);
    if (co?.locationId) {
      req.log.info({ locationId: co.locationId }, "Sync: triggering EasyTeam export programmatically");
      const triggered = await triggerEasyTeamExportForLocation(co.locationId);
      req.log.info({ triggered, locationId: co.locationId }, "Sync: export trigger result");

      if (triggered) {
        for (let i = 0; i < 8; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          const synced = await applyExportIfFound();
          if (synced > 0) {
            req.log.info({ periodKey, companyId, synced, pollAttempt: i + 1 }, "Sync: webhook arrived after export trigger");
            res.json({ success: true, source: "easyteam", periodKey, synced });
            return;
          }
        }
        req.log.info({ periodKey, companyId }, "Sync: webhook did not arrive within 4 s after trigger");
      }
    }
  }

  // ── Step 3: EasyTeam REST API direct fetch ──
  const allClientIds = companyId ? [companyId] : store.listClients().map((c) => c.id);
  const storeCompaniesToSync = allClientIds
    .map((id) => store.getCompany(id))
    .filter((c): c is NonNullable<typeof c> => c != null && !!c.locationId);

  // Fall back to DB for companies not in the in-memory store (wizard-created companies)
  const storeIds = new Set(storeCompaniesToSync.map((c) => c.id));
  const missingIds = allClientIds.filter((id) => !storeIds.has(id));
  type SyncableCompany = { id: string; locationId: string };
  const dbFallback: SyncableCompany[] = [];
  for (const id of missingIds) {
    const [dbCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, id)).catch(() => [undefined]);
    if (dbCo) {
      // Use rollfiLocationId if set, otherwise derive a stable EasyTeam locationId from company ID
      const locationId = dbCo.rollfiLocationId || `LOC-${id}`;
      dbFallback.push({ id, locationId });
    }
  }

  const companiesToSync: SyncableCompany[] = [
    ...storeCompaniesToSync.map((c) => ({ id: c.id, locationId: c.locationId! })),
    ...dbFallback,
  ];

  let restSynced = 0;
  let restApiResponded = false;
  for (const co of companiesToSync) {
    const locId = co.locationId;
    const result = await fetchEasyTeamShiftsForLocation(locId, fromDate, toDate);
    req.log.info({ locationId: locId, result: "error" in result ? result.error : `${result.shifts.length} shifts` }, "Sync: REST API result");

    if ("shifts" in result) {
      restApiResponded = true; // API responded — don't fall through to seed even if 0 in range
      // Only count shifts that fall within the requested date range
      const norm = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
      const inRange = result.shifts.filter((s) => {
        if (!s.startTime) return false;
        const start = new Date(norm(s.startTime));
        return start >= fromDate && start <= toDate;
      });
      req.log.info({ locationId: locId, total: result.shifts.length, inRange: inRange.length, from: fromDate.toISOString(), to: toDate.toISOString() }, "Sync: date-filtered shifts");
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
      for (const [etEmpId, totalMinutes] of minutesByEmp) {
        // Resolve EasyTeam UUID → our internal employeeId (populated during boot sync / employee add)
        const internalEmpId = store.resolveEasyTeamUuid(etEmpId);
        // Skip entries whose UUID we can't map — they belong to employees outside our system
        if (internalEmpId === etEmpId) {
          req.log.warn({ etEmpId }, "Sync: skipping shift for unrecognised EasyTeam UUID (not in our employee registry)");
          continue;
        }
        const matched = companyUsers.find((u) => u.employeeId === internalEmpId);
        const hoursWorked = Math.round((totalMinutes / 60) * 100) / 100;
        const breakHours  = Math.round(((breaksByEmp2.get(etEmpId) ?? 0) / 60) * 100) / 100;
        await upsertTimesheetEntry({
          employeeId: internalEmpId,
          companyId:  matched?.companyId ?? co.id,
          periodKey,
          hoursWorked,
          breakDeduction: breakHours,
          approvedHours:  Math.max(0, Math.round((hoursWorked - breakHours) * 100) / 100),
          source: "easyteam",
          syncedAt: new Date().toISOString(),
        });
        restSynced++;
      }
    }
  }

  if (restApiResponded) {
    req.log.info({ periodKey, companyId, restSynced }, "Sync: used EasyTeam REST API data");
    res.json({ success: true, source: "easyteam", periodKey, synced: restSynced });
    return;
  }

  // ── Step 4: Seed fallback — only if REST API never responded ──
  req.log.info({ periodKey, companyId }, "Sync: EasyTeam REST API unavailable — seeding fallback hours");
  const seeded = store.seedTimesheetHours(periodKey);
  res.json({ success: true, source: "seeded", periodKey, synced: seeded.length, note: "No EasyTeam data — seeded demo hours" });
});

router.get("/easyteam/hours", (req, res) => {
  const { from, to, companyId } = req.query as { from?: string; to?: string; companyId?: string };
  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  let entries = store.getTimesheetEntriesForPeriod(periodKey);
  if (companyId) entries = entries.filter((e) => e.companyId === companyId);

  res.json({ periodKey, entries, synced: entries.length > 0 });
});

const EASYTEAM_REST_API = "https://www.easyteam.io";

interface EasyTeamShift {
  id: string;
  employeeId: string;
  locationId: string;
  startTime: string;
  endTime: string | null;
  payableDuration?: number; // milliseconds in EasyTeam timesheets endpoint; may be absent
  totalUnpaidBreaks?: number; // minutes; may be absent in timesheets response
  breaks?: Array<{ startTime: string; endTime: string }>;
  active?: boolean;
}

/** Returns worked minutes for a timesheet entry. Prefers startTime/endTime arithmetic
 *  because EasyTeam's `payableDuration` field is in milliseconds (not minutes). */
function shiftDurationMinutes(s: EasyTeamShift): number {
  if (s.startTime && s.endTime) {
    const norm = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
    const start = new Date(norm(s.startTime));
    const end   = new Date(norm(s.endTime));
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
      return (end.getTime() - start.getTime()) / 60000;
    }
  }
  if (s.payableDuration != null && s.payableDuration > 0) {
    return s.payableDuration > 10000 ? s.payableDuration / 60000 : s.payableDuration;
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
  _fromDate?: Date,
  _toDate?: Date,
): Promise<{ shifts: EasyTeamShift[]; source: "api"; locationId: string } | { error: string }> {
  if (!EASYTEAM_API_KEY) return { error: "No API key configured" };

  // Find the manager for this location — fall back to super_admin if none registered for this location yet
  const managerUser =
    store.getAllStaffUsers().find((u) => u.locationId === locationId && u.role === "manager") ??
    store.getAllStaffUsers().find((u) => u.role === "super_admin" && u.employeeId);
  if (!managerUser?.employeeId) return { error: `No user found for locationId=${locationId}` };

  try {
    // Include TIMESHEET_READ + SHIFT_READ to access both timesheets and shifts endpoints
    const adminJwt = jwt.sign(
      {
        employeeId: managerUser.employeeId,
        organizationId: "ORG-BRIGHTBRIDGE",
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
        role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 2500 },
        wage: 2500,
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
    const timesheetsUrl = `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/locations/${internalLocId}/timesheets`;

    // Call /timesheets with NO extra params — additional params (limit, page, date filters) cause EasyTeam to return []
    const r = await axios.get(timesheetsUrl, { headers, timeout: 10000 });
    const shifts = extractArrayFromResponse(r.data);

    return { shifts, source: "api", locationId };
  } catch (err) {
    const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = axErr.response
      ? `HTTP ${axErr.response.status}: ${JSON.stringify(axErr.response.data)}`
      : (axErr.message ?? "Unknown error");
    return { error: detail };
  }
}

router.post("/easyteam/hours/approve", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { from, to, companyId } = req.body as { from?: string; to?: string; companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }

  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  // Look up location for this company
  const company = store.getCompany(companyId);
  const locationId = company?.locationId;

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
    const result = await fetchEasyTeamShiftsForLocation(locationId);
    req.log.info({ locationId, result: "error" in result ? result.error : `${result.shifts.length} shifts` }, "EasyTeam REST API fetch result");

    if ("shifts" in result && result.shifts.length > 0) {
      const normTs = (t: string) => t.includes("T") ? t : t.replace(" ", "T") + "Z";
      const inRange = result.shifts.filter((s) => {
        if (!s.startTime) return false;
        const start = new Date(normTs(s.startTime));
        return start >= fromDate && start <= toDate;
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
          const matchedUser = companyUsers.find((u) => u.employeeId === internalEmpId);
          const resolvedCompanyId = matchedUser?.companyId ?? companyId;
          const hoursWorked = Math.round((totalMinutes / 60) * 100) / 100;
          const breakHours  = Math.round(((breaksByEmployee.get(etEmployeeId) ?? 0) / 60) * 100) / 100;
          await upsertTimesheetEntry({
            employeeId: internalEmpId,
            companyId: resolvedCompanyId,
            periodKey,
            hoursWorked,
            breakDeduction: breakHours,
            approvedHours: Math.max(0, Math.round((hoursWorked - breakHours) * 100) / 100),
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

  // ── Step 3: Seed fallback ──
  const existing = store.getTimesheetEntriesForPeriod(periodKey).filter((e) => e.companyId === companyId);
  if (existing.length === 0) {
    const all = store.seedTimesheetHours(periodKey);
    req.log.info({ count: all.length }, "Seeded fallback hours for approval");
  }

  const approved = store.approveTimesheetEntries(periodKey, companyId, userId);

  // Persist approval state to DB so it survives server restarts
  await Promise.all(approved.map((entry) => upsertTimesheetEntry(entry)));

  req.log.info({ periodKey, companyId, count: approved.length, userId, dataSource }, "Manager approved timesheet hours");
  res.json({ success: true, periodKey, approved: approved.length, dataSource, entries: approved });
});

// Debug-only endpoint — shows raw EasyTeam REST API response for a given location
router.get("/easyteam/debug/shifts", async (req, res) => {
  const locationId = (req.query.locationId as string) || "LOC-RAINBOW";
  if (!EASYTEAM_API_KEY) { res.status(500).json({ error: "No API key" }); return; }

  let exchangeToken: string | null = null;
  let exchangeError: string | null = null;
  let rawResponse: unknown = null;
  let rawError: string | null = null;

  // Step 1: exchange — use the manager for this location (same JWT structure as auth.ts)
  const mgr = store.getAllStaffUsers().find((u) => u.locationId === locationId && u.role === "manager");
  if (!mgr?.employeeId) { res.json({ error: `No manager for ${locationId}` }); return; }

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: mgr.employeeId,
        organizationId: "ORG-BRIGHTBRIDGE",
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: { name: "manager", permissions: ["LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"] },
        role: { name: mgr.position ?? "Daycare Manager", hourlyWage: 2500 },
        wage: 2500,
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

router.get("/easyteam/webhooks", (_req, res) => {
  res.json({ events: webhookLog, total: webhookLog.length });
});

router.post("/easyteam/webhook/export", async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signatureHeader = req.headers["x-convoy-signature"] as string | undefined;

  // Verify signature — warn on failure but still process (sandbox: signing secret may differ from CONVOY_WEBHOOK_SECRET)
  let signatureValid = false;
  if (CONVOY_WEBHOOK_SECRET && signatureHeader) {
    signatureValid = verifyConvoySignature(rawBody, signatureHeader, CONVOY_WEBHOOK_SECRET);
    if (!signatureValid) {
      req.log.warn({ signatureHeader }, "Export webhook signature mismatch — processing anyway (sandbox mode)");
    }
  } else if (!signatureHeader) {
    req.log.warn("Export webhook received with no signature header");
  } else {
    req.log.warn("CONVOY_WEBHOOK_SECRET not set — skipping signature verification");
  }

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

router.get("/easyteam/exports", (_req, res) => {
  res.json({ exports: exportLog, total: exportLog.length });
});

router.post("/easyteam/test-connection", async (req, res) => {
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
