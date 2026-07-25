import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import axios from "axios";
import { store } from "../store";
import { upsertTimesheetEntry, clearTimesheetEntriesForCompanyPeriod } from "../lib/easyteam-persist.js";
import { upsertTimesheetApproval } from "../lib/timesheet-approvals-persist.js";
import { db, companies as companiesTable, employees as employeesTable, userAccounts as userAccountsTable, timesheetShifts as timesheetShiftsTable } from "@workspace/db";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { upsertTimesheetShift, getTimesheetShiftsByCompanyAndRange, shiftLocalDate } from "../lib/timesheet-shifts-persist.js";
import { resolveCompanyLocationId } from "../lib/location.js";

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
    .filter((u) => u.employeeId && u.role === "employee" && (!u.status || u.status === "active" || u.status === "onboarding"))
    .map((u) => ({
      id: u.employeeId as string,
      name: u.name,
      role: u.role,
      companyId: u.companyId,
      timeTrackingEnabled: true,
      wage: u.hourlyWage ?? 1500,
      wageType: "hourly" as const,
      status: u.status ?? "active",
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
  // Wage is expressed in DOLLARS in the launch JWT — consistent with /auth/token-by-role and
  // the EasyTeam employee registration path (both divide stored cents by 100).
  let resolvedWage = 15;

  // client_id is a companyId in the unified model — resolve its EasyTeam location id.
  if (client_id) {
    resolvedLocationId = await resolveCompanyLocationId(client_id);
    resolvedOrgId = "ORG-BRIGHTBRIDGE";
  }

  let resolvedEtEmployeeId = employee_id;
  if (employee_id) {
    // Prefer a matching staff user (seeded + dynamic logins carry role/position/wage and the
    // canonical employeeId, so every JWT path maps to the same single EasyTeam record).
    const staffUser = store.getAllStaffUsers().find((u) => u.employeeId === employee_id);
    if (staffUser) {
      resolvedRoleName = staffUser.position ?? resolvedRoleName;
      resolvedAccessRole = (staffUser.role === "manager" || staffUser.role === "owner") ? "manager" : "employee";
      resolvedWage = (staffUser.hourlyWage ?? 1500) / 100;
      resolvedEtEmployeeId = staffUser.employeeId ?? employee_id;
    } else {
      // Fall back to the unified DB employees table for staff without a login account.
      const [dbEmp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employee_id)).catch(() => [undefined]);
      if (dbEmp) {
        resolvedRoleName = dbEmp.position;
        resolvedAccessRole = "employee";
        resolvedWage = (dbEmp.hourlyWage ?? 1500) / 100;
      }
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
  const managerUser = store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner"));
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

router.post("/easyteam/hours/sync", async (req, res) => {
  const { from, to, companyId } = req.body as { from?: string; to?: string; companyId?: string };
  const toDate   = to   ? new Date(to + "T23:59:59.999Z") : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  const allStaff = store.getAllStaffUsers().filter((u) => u.employeeId && u.role === "employee");

  // Helper: scan exportLog for a matching entry, write to store + persist to DB.
  // Removes the consumed entry from exportLog so stale webhook payloads cannot be
  // replayed on subsequent Pull Hours calls (each webhook payload is used at most once).
  // Returns the number of entries persisted, or 0 if no usable export data was found.
  async function applyExportIfFound(): Promise<number> {
    const foundIdx = exportLog.findIndex(
      (e) => e.status === "ready" && e.shifts && e.shifts.length > 0 &&
        (!e.startDate || new Date(e.startDate) <= toDate) &&
        (!e.endDate   || new Date(e.endDate)   >= fromDate)
    );
    if (foundIdx === -1) return 0;
    const found = exportLog[foundIdx];
    if (!found?.shifts || found.shifts.length === 0) return 0;
    // Consume the entry — remove it so future Pull Hours calls go to the REST API for fresh data.
    exportLog.splice(foundIdx, 1);

    const hoursByEmp  = new Map<string, number>();
    const breaksByEmp = new Map<string, number>();
    for (const shift of found.shifts) {
      if (companyId) {
        const internalEmpId = store.resolveEasyTeamUuid(shift.employeeId);
        const ru = allStaff.find((u) => u.employeeId === internalEmpId);
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
    return synced;
  }

  // ── Step 1: In-memory exportLog (populated by previous webhook or trigger) ──
  const actorSync = req.session.userId ? store.getUserById(req.session.userId) : undefined;

  const step1 = await applyExportIfFound();
  if (step1 > 0) {
    req.log.info({ periodKey, companyId, synced: step1 }, "Sync: used cached export webhook data");
    if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${step1} employee${step1 !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
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
            if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${synced} employee${synced !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
            res.json({ success: true, source: "easyteam", periodKey, synced });
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
  let totalSkippedForeign = 0;
  for (const co of companiesToSync) {
    const locId = co.locationId;
    const result = await fetchEasyTeamShiftsForLocation(locId, fromDate, toDate, co.id);
    req.log.info({ locationId: locId, companyId: co.id, result: "error" in result ? result.error : `${result.shifts.length} shifts` }, "Sync: REST API result");

    if ("shifts" in result) {
      restApiResponded = true; // API responded — don't fall through to seed even if 0 in range
      const etLocId = result.easyteamLocationId;
      let skippedForeignShifts = 0;
      // FIX 1: use utcStartTime (genuine UTC) — the old norm(startTime) appended Z to a local
      //   timestamp, misclassifying shifts near pay-period boundaries.
      // FIX 2: location guard — flat /timesheets returns all org shifts regardless of which
      //   location's JWT was used; only persist shifts whose locationId matches this company's
      //   EasyTeam location UUID to prevent cross-company contamination.
      // Compare by local calendar date (utcStartTime + utcOffset) so shifts that
      // start near midnight are attributed to the correct pay-period day.
      const fromDateStr = fromDate.toISOString().split("T")[0]!;
      const toDateStr   = toDate.toISOString().split("T")[0]!;
      const inRange = result.shifts.filter((s) => {
        if (!s.utcStartTime) return false;
        if (s.locationId !== etLocId) {
          req.log.warn(
            { shiftId: s.id, shiftLocationId: s.locationId, expectedLocationId: etLocId, companyId: co.id },
            "Sync: skipping shift from foreign location",
          );
          skippedForeignShifts++;
          return false;
        }
        const ld = shiftLocalDate(s.utcStartTime, s.utcOffset ?? 0);
        return ld >= fromDateStr && ld <= toDateStr;
      });
      totalSkippedForeign += skippedForeignShifts;
      req.log.info({ locationId: locId, etLocId, total: result.shifts.length, inRange: inRange.length, skippedForeignShifts, from: fromDate.toISOString(), to: toDate.toISOString() }, "Sync: date-filtered shifts");
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
        // Skip entries whose UUID we can't map — they belong to employees outside our system
        if (internalEmpId === etEmpId) {
          req.log.warn({ etEmpId }, "Sync: skipping timesheet_entry for unrecognised EasyTeam UUID (not in our employee registry)");
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
  }

  if (restApiResponded) {
    req.log.info({ periodKey, companyId, restSynced, totalSkippedForeign }, "Sync: used EasyTeam REST API data");
    if (companyId) store.logActivity({ companyId, type: "hours.synced", description: `Hours synced from EasyTeam (${restSynced} employee${restSynced !== 1 ? "s" : ""})`, actorName: actorSync?.name, actorRole: actorSync?.role });
    res.json({ success: true, source: "easyteam", periodKey, synced: restSynced, skippedForeignShifts: totalSkippedForeign });
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
router.get("/easyteam/company-members", (req, res) => {
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  const staff = store.getAllStaffUsers().filter((u) => u.companyId === companyId && u.role === "employee");
  const names: Record<string, string> = {};
  for (const u of staff) {
    if (u.employeeId) names[u.employeeId] = u.name;
  }
  res.json({ names });
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

router.post("/easyteam/hours/approve", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const body = req.body as {
    from?: string; to?: string; companyId?: string;
    overrides?: { employeeId: string; approvedHours: number; note?: string; managerEditNote?: string }[];
    entries?: { employeeId: string; approvedHours: number; managerEditNote?: string }[];
  };
  const { from, to, companyId } = body;
  // Accept both "overrides" (sent by timesheets page) and legacy "entries"
  const managerEntries = body.overrides ?? body.entries ?? [];
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  // Build a quick lookup map for manager-supplied overrides keyed by employeeId
  const managerOverrides = new Map(
    (managerEntries ?? []).map((e) => [e.employeeId, e])
  );

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

  // ── Step 3: Ensure every company employee has an entry for this period ──
  // If any employee has no entry (0 hours from EasyTeam), write an explicit 0-hour record.
  // This prevents the payroll fallback from picking up stale approvals from a prior period.
  const existing = store.getTimesheetEntriesForPeriod(periodKey).filter((e) => e.companyId === companyId);
  const existingEmpIds = new Set(existing.map((e) => e.employeeId));
  const companyStaff = store.getAllStaffUsers()
    .filter((u) => u.employeeId && u.companyId === companyId && u.role === "employee");
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

  const approved = store.approveTimesheetEntries(periodKey, companyId, userId);
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
router.get("/easyteam/debug/shifts", async (req, res) => {
  const locationId = (req.query.locationId as string) || "LOC-RAINBOW";
  if (!EASYTEAM_API_KEY) { res.status(500).json({ error: "No API key" }); return; }

  let exchangeToken: string | null = null;
  let exchangeError: string | null = null;
  let rawResponse: unknown = null;
  let rawError: string | null = null;

  // Step 1: exchange — use the manager for this location (same JWT structure as auth.ts)
  const mgr = store.getAllStaffUsers().find((u) => u.locationId === locationId && (u.role === "manager" || u.role === "owner"));
  if (!mgr?.employeeId) { res.json({ error: `No manager for ${locationId}` }); return; }

  try {
    const adminJwt = jwt.sign(
      {
        employeeId: mgr.employeeId,
        organizationId: "ORG-BRIGHTBRIDGE",
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

// ── Shift flag thresholds — will become configurable per-company later ───────
const SHIFT_THRESHOLDS = {
  MISSED_PUNCH_HOURS:  16, // active shift older than this (hours) → missedPunch
  EXTENDED_BREAK_MIN:  60, // any single break longer than this (minutes) → extendedBreak
  LONG_SHIFT_HOURS:    10, // payableDurationMs > this * 3_600_000 → longShift
} as const;

// ── GET /api/timesheets/shifts — company-scoped shift store with computed flags ──
router.get("/timesheets/shifts", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user = store.getUserById(req.session.userId);
  if (!user || (user.role !== "super_admin" && user.role !== "owner" && user.role !== "manager")) {
    res.status(403).json({ error: "Insufficient role" }); return;
  }

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
    // 2. user_accounts table — fills any gaps not covered by employees table
    const needFromAccts = allShiftEmpIds.filter(id => !wageMap.has(id));
    if (needFromAccts.length > 0) {
      const dbAccts = await db
        .select({ employeeId: userAccountsTable.employeeId, hourlyWage: userAccountsTable.hourlyWage })
        .from(userAccountsTable)
        .where(inArray(userAccountsTable.employeeId, needFromAccts));
      for (const a of dbAccts) {
        if (a.employeeId && a.hourlyWage != null) wageMap.set(a.employeeId, a.hourlyWage / 100);
      }
    }
    // 3. In-memory store — last resort for users not yet persisted to DB
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
router.get("/timesheets/trend", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
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
