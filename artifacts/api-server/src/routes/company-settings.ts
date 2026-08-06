/**
 * Company Settings routes — owner + super_admin only.
 *
 * GET  /state-registrations          — list registrations scoped to caller's company
 * PUT  /state-registrations/:id      — update via Rollfi updateStateRegistrationInfo
 * GET  /state-registrations/gaps     — employees in unregistered states (warning source)
 *
 * Company scoping is enforced server-side from the session. Owners never see or
 * modify another company's registrations. super_admin may pass ?companyId= to
 * scope to a specific company.
 *
 * Rollfi returns HTTP 200 with errors nested in the body — extractRollfiError is
 * used on every call. No silent failures.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import axios from "axios";
import {
  db,
  stateRegistrations as stateRegistrationsTable,
  employees as employeesTable,
  companies as companiesTable,
  rollfiCompanyRecords,
  companySignedForms,
} from "@workspace/db";
import { buildForm8655Pdf, getForm8655AuthDates } from "../lib/form8655.js";
import { sendFormSigningLinkEmail } from "../lib/email.js";
import { buildDashboardSteps } from "../lib/dashboard-steps.js";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";
import { extractRollfiError } from "../lib/rollfi-employee-sync.js";
import { FORM_8655_STALE_THRESHOLD_MS } from "../lib/form8655-constants.js";

const router: IRouter = Router();

/** Single source of truth for the Form 8655 upload staleness threshold.
 *  Included in the /rollfi/pending-signatures response so the UI never
 *  needs its own copy of this value. */
const STALE_THRESHOLD_MS = FORM_8655_STALE_THRESHOLD_MS;

// States that legitimately need no Rollfi state-level registration.
// Mirrors the constants in rollfi-employee-sync.ts so they stay in sync.
const STATES_USING_FEDERAL_W4 = new Set(["ND", "PA", "UT"]);
const STATES_NO_INCOME_TAX    = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
const NO_REGISTRATION_NEEDED  = new Set([...STATES_USING_FEDERAL_W4, ...STATES_NO_INCOME_TAX]);

// US state code → full name (used when mapping Rollfi StateTaxRegistrations)
const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",
  LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
  WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

function rollfiHeaders() {
  const { clientId, secretKey } = getRollfiConfig();
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}
function getBaseUrl(): string { return getRollfiConfig().baseUrl; }

/** Resolve the companyId the caller is allowed to operate on. */
function resolveCompanyId(req: Request, res: Response): string | null {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return null; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied — owner or super_admin required" }); return null;
  }
  // super_admin may target any company via ?companyId=; owner is always their own
  const companyId = user.role === "super_admin"
    ? ((req.query.companyId as string | undefined) ?? user.companyId)
    : user.companyId;
  if (!companyId) { res.status(400).json({ error: "No company associated with this account" }); return null; }
  return companyId;
}

// ── GET /state-registrations ─────────────────────────────────────────────────
router.get("/state-registrations", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;
  try {
    // 1. Local DB rows (the source of truth for registrations added through BrightBridge)
    const rows = await db.select().from(stateRegistrationsTable)
      .where(eq(stateRegistrationsTable.companyId, companyId));

    // 2. Also pull StateTaxRegistrations from Rollfi (getCompanyInfo) so registrations
    //    added directly in Rollfi's portal are visible here too.
    const localStateCodes = new Set(rows.map(r => r.stateCode));
    const syntheticRows: Array<typeof rows[0] & { source: string }> = [];

    try {
      // Resolve rollfiCompanyId (store → companies table → rollfi_company_records)
      let rollfiCompanyId: string | undefined =
        store.getRollfiCompany(companyId)?.rollfiCompanyId ?? undefined;
      if (!rollfiCompanyId) {
        const [dbCo] = await db
          .select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
          .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
        rollfiCompanyId = dbCo?.rollfiCompanyId ?? undefined;
      }
      if (!rollfiCompanyId) {
        const [rcr] = await db
          .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
          .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).limit(1);
        rollfiCompanyId = rcr?.rollfiCompanyId ?? undefined;
      }

      if (rollfiCompanyId) {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getCompanyInfo`,
          { method: "getCompanyInfo", companyId: rollfiCompanyId },
          { headers: rollfiHeaders(), timeout: 8000 },
        );
        const raw = r.data as Record<string, unknown>;
        const co = (Array.isArray(raw.Company) ? raw.Company[0] : null) as Record<string, unknown> | null ?? {};
        const stateTaxRegs = Array.isArray(co.StateTaxRegistrations)
          ? co.StateTaxRegistrations as Record<string, string>[]
          : [];

        const now = new Date().toISOString();
        for (const entry of stateTaxRegs) {
          const stateCode = entry.State;
          if (!stateCode || localStateCodes.has(stateCode)) continue;
          // Exclude the "State" key; remaining keys are the field values
          const { State: _s, ...fields } = entry;
          syntheticRows.push({
            id:               `rollfi-${stateCode}`,
            companyId,
            rollfiCompanyId,
            stateCode,
            stateName:        STATE_NAMES[stateCode] ?? stateCode,
            stateEmployerId:  null,
            suiAccountNumber: null,
            suiRate:          null,
            fieldValuesJson:  JSON.stringify(fields),
            status:           "active",
            rollfiResponse:   null,
            registeredAt:     now,
            updatedAt:        now,
            source:           "rollfi",
          } as typeof rows[0] & { source: string });
        }
      }
    } catch {
      // Rollfi unavailable — silently fall back to local DB only
    }

    res.json({ registrations: [...rows, ...syntheticRows] });
  } catch (err) {
    req.log.error({ err }, "GET /state-registrations failed");
    res.status(500).json({ error: "Failed to retrieve state registrations" });
  }
});

// ── GET /state-registrations/gaps ────────────────────────────────────────────
// Returns states where active (non-terminated) employees work but for which
// the company has no ACTIVE registration in Rollfi.
// Excludes no-income-tax states and federal-W4 states — those legitimately
// need no registration.
router.get("/state-registrations/gaps", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;
  try {
    const [emps, regs] = await Promise.all([
      db.select({
        id:        employeesTable.id,
        firstName: employeesTable.firstName,
        lastName:  employeesTable.lastName,
        homeState: employeesTable.homeState,
        status:    employeesTable.status,
      })
        .from(employeesTable)
        .where(eq(employeesTable.companyId, companyId)),
      db.select({ stateCode: stateRegistrationsTable.stateCode, status: stateRegistrationsTable.status })
        .from(stateRegistrationsTable)
        .where(eq(stateRegistrationsTable.companyId, companyId)),
    ]);

    const activeStates = new Set(
      regs.filter(r => r.status === "active").map(r => r.stateCode),
    );

    // Map state → existing registration status (for non-active rows)
    const stateStatusMap = new Map<string, string>(
      regs.filter(r => r.status !== "active").map(r => [r.stateCode, r.status]),
    );

    // Group affected employees by their unregistered/non-active homeState.
    // registrationStatus = null  → no row exists at all
    // registrationStatus = 'failed' | 'pending'  → row exists but isn't active
    const stateMap = new Map<string, {
      state: string;
      employees: { id: string; name: string }[];
      registrationStatus: string | null;
    }>();
    for (const emp of emps) {
      if (!emp.homeState || emp.status === "terminated") continue;
      if (NO_REGISTRATION_NEEDED.has(emp.homeState)) continue;
      if (activeStates.has(emp.homeState)) continue;
      if (!stateMap.has(emp.homeState)) {
        stateMap.set(emp.homeState, {
          state: emp.homeState,
          employees: [],
          registrationStatus: stateStatusMap.get(emp.homeState) ?? null,
        });
      }
      stateMap.get(emp.homeState)!.employees.push({
        id:   emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
      });
    }

    res.json({ gaps: Array.from(stateMap.values()) });
  } catch (err) {
    req.log.error({ err }, "GET /state-registrations/gaps failed");
    res.status(500).json({ error: "Failed to compute state registration gaps" });
  }
});

// ── PUT /state-registrations/:id ─────────────────────────────────────────────
// Calls Rollfi's updateStateRegistrationInfo.
// Handles two cases:
//   1. id is a real DB uuid  → look up existing row, update in place.
//   2. id starts with "rollfi-{stateCode}" (synthetic Rollfi-synced row that has
//      no local record yet) → resolve rollfiCompanyId, call Rollfi, then INSERT
//      a new DB row so the entry becomes a first-class BrightBridge record.
router.put("/state-registrations/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const { fieldValues } = req.body as { fieldValues?: Record<string, string> };
  if (!fieldValues || Object.keys(fieldValues).length === 0) {
    res.status(400).json({ error: "fieldValues is required" }); return;
  }

  const id = req.params.id as string;
  const isSynthetic = id.startsWith("rollfi-");

  // ── Synthetic row: "rollfi-{stateCode}" — no local DB record yet ──────────
  if (isSynthetic) {
    const stateCode = id.replace(/^rollfi-/, "");
    const companyId = user.role === "super_admin"
      ? ((req.query.companyId as string | undefined) ?? user.companyId)
      : user.companyId;
    if (!companyId) { res.status(400).json({ error: "No company associated" }); return; }

    // Resolve rollfiCompanyId (store → companies → rollfi_company_records)
    let rollfiCompanyId: string | undefined =
      store.getRollfiCompany(companyId)?.rollfiCompanyId ?? undefined;
    if (!rollfiCompanyId) {
      const [dbCo] = await db.select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
        .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      rollfiCompanyId = dbCo?.rollfiCompanyId ?? undefined;
    }
    if (!rollfiCompanyId) {
      const [rcr] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).limit(1);
      rollfiCompanyId = rcr?.rollfiCompanyId ?? undefined;
    }
    if (!rollfiCompanyId) {
      res.status(400).json({ error: "Company not registered with payroll provider" }); return;
    }

    const nowISO = new Date().toISOString();
    const newId = `SR-${stateCode}-${Date.now()}`;
    const fieldValuesJson = JSON.stringify(fieldValues);
    const stateName = STATE_NAMES[stateCode] ?? stateCode;

    try {
      const response = await axios.post(
        `${getBaseUrl()}/adminPortal/updateStateRegistrationInfo`,
        { method: "updateStateRegistrationInfo", companyId: rollfiCompanyId,
          code: stateCode, companyStateRegistration: fieldValues },
        { headers: rollfiHeaders() },
      );
      const rollfiErr = extractRollfiError(response.data);
      if (rollfiErr) {
        req.log.error({ rollfiResponse: response.data, stateCode }, "updateStateRegistrationInfo (synthetic) body error");
        res.status(400).json({ error: rollfiErr, rollfiResponse: response.data }); return;
      }

      // Insert as a first-class local record (removes the synthetic entry on next fetch)
      const [inserted] = await db.insert(stateRegistrationsTable).values({
        id: newId, companyId, rollfiCompanyId, stateCode, stateName,
        stateEmployerId: null, suiAccountNumber: null, suiRate: null,
        fieldValuesJson, status: "active",
        rollfiResponse: JSON.stringify(response.data),
        registeredAt: nowISO, updatedAt: nowISO,
      }).returning();

      store.logActivity({ companyId, type: "company.updated", description: `State tax registration saved (${stateCode})`, actorName: user.name, actorRole: user.role });
      res.json({ success: true, registration: inserted });
    } catch (err: unknown) {
      const e = err as { response?: { data: unknown } };
      req.log.error({ err, stateCode }, "updateStateRegistrationInfo (synthetic) failed");
      res.status(500).json({ error: "Failed to update state registration", details: e.response?.data ?? String(err) });
    }
    return;
  }

  // ── Existing local DB row ──────────────────────────────────────────────────
  const [reg] = await db.select().from(stateRegistrationsTable)
    .where(eq(stateRegistrationsTable.id, id)).catch(() => [undefined]);
  if (!reg) { res.status(404).json({ error: "State registration not found" }); return; }

  if (user.role !== "super_admin" && reg.companyId !== user.companyId) {
    res.status(403).json({ error: "Access denied: company mismatch" }); return;
  }
  if (!reg.rollfiCompanyId) {
    res.status(400).json({ error: "Company not registered with payroll provider" }); return;
  }

  const nowISO = new Date().toISOString();
  const fieldValuesJson = JSON.stringify(fieldValues);

  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/updateStateRegistrationInfo`,
      { method: "updateStateRegistrationInfo", companyId: reg.rollfiCompanyId,
        code: reg.stateCode, companyStateRegistration: fieldValues },
      { headers: rollfiHeaders() },
    );

    const rollfiErr = extractRollfiError(response.data);
    if (rollfiErr) {
      req.log.error({ rollfiResponse: response.data, id, stateCode: reg.stateCode },
        "updateStateRegistrationInfo body error");
      await db.update(stateRegistrationsTable)
        .set({ status: "failed", rollfiResponse: JSON.stringify(response.data), updatedAt: nowISO })
        .where(eq(stateRegistrationsTable.id, id)).catch(() => {});
      res.status(400).json({ error: rollfiErr, rollfiResponse: response.data }); return;
    }

    const [updated] = await db.update(stateRegistrationsTable)
      .set({ fieldValuesJson, status: "active",
             rollfiResponse: JSON.stringify(response.data), updatedAt: nowISO })
      .where(eq(stateRegistrationsTable.id, id)).returning();

    store.logActivity({ companyId: reg.companyId, type: "company.updated", description: `State tax registration saved (${reg.stateCode})`, actorName: user.name, actorRole: user.role });
    res.json({ success: true, registration: updated });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, id, stateCode: reg.stateCode }, "updateStateRegistrationInfo failed");
    await db.update(stateRegistrationsTable)
      .set({ status: "failed",
             rollfiResponse: JSON.stringify(e.response?.data ?? String(err)),
             updatedAt: nowISO })
      .where(eq(stateRegistrationsTable.id, id)).catch(() => {});
    res.status(500).json({ error: "Failed to update state registration", details: e.response?.data ?? String(err) });
  }
});

// ════════════════════════════════════════════════════════════════
// COMPANY INFORMATION ROUTES
// ════════════════════════════════════════════════════════════════
// All routes are owner + super_admin only (same resolveCompanyId guard).
// Every save must succeed at the provider level — DB is only updated
// after a confirmed provider success.  Provider name never exposed to owners.

// ── GET /api/company-info ─────────────────────────────────────
router.get("/company-info", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  try {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    // Resolve rollfi IDs — companies table is authoritative, but legacy/demo companies
    // may only have their Rollfi IDs in rollfi_company_records (not yet back-filled to companies).
    let resolvedRollfiCompanyId: string | null = co.rollfiCompanyId ?? null;
    let resolvedRollfiLocationId: string | null = co.rollfiLocationId ?? null;

    if (!resolvedRollfiCompanyId) {
      const [legacy] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId, rollfiLocationId: rollfiCompanyRecords.rollfiLocationId })
        .from(rollfiCompanyRecords)
        .where(eq(rollfiCompanyRecords.companyId, companyId))
        .catch(() => [undefined]);
      if (legacy) {
        resolvedRollfiCompanyId = legacy.rollfiCompanyId ?? null;
        resolvedRollfiLocationId = legacy.rollfiLocationId ?? resolvedRollfiLocationId;
      }
    }

    // Fetch live KYB data from provider to get kybInformationId + entity fields
    let rollfiKybInformationId: string | null = null;
    let rollfiEntityType: string | null = null;
    let rollfiDateOfIncorporation: string | null = null;
    let rollfiEin: string | null = null;

    if (resolvedRollfiCompanyId) {
      try {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getCompanyInfo`,
          { method: "getCompanyInfo", companyId: resolvedRollfiCompanyId },
          { headers: rollfiHeaders() },
        );
        const rollfiCo = r.data?.Company?.[0];
        if (rollfiCo) {
          const kyb = rollfiCo.KYBInformations?.[0];
          if (kyb) {
            rollfiKybInformationId   = kyb.KybInformationId ?? null;
            rollfiEntityType          = kyb.EntityType?.entityType ?? null;
            rollfiDateOfIncorporation = kyb.dateOfIncorporation ?? null;
            rollfiEin                 = kyb.ein ?? null;
          }
          // Provider location ID overrides our stored value
          const providerLocId = rollfiCo.CompanyLocations?.[0]?.companyLocationID ?? null;
          if (providerLocId) resolvedRollfiLocationId = providerLocId;
        }
      } catch (_e) {
        // Non-fatal — provider data is supplementary
      }
    }

    res.json({
      company: {
        id:                      co.id,
        name:                    co.name,
        doingBusinessAs:         co.doingBusinessAs ?? null,
        businessWebsite:         co.businessWebsite ?? null,
        phone:                   co.phone ?? "",
        address1:                co.address1 ?? "",
        address2:                co.address2 ?? null,
        city:                    co.city ?? "",
        state:                   co.state ?? "",
        zipcode:                 co.zipcode ?? "",
        ein:                     co.ein ?? null,
        kybStatus:               co.kybStatus,
        rollfiCompanyId:         resolvedRollfiCompanyId,
        rollfiLocationId:        resolvedRollfiLocationId,
        rollfiKybInformationId,
        rollfiEntityType,
        rollfiDateOfIncorporation,
        rollfiEin,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /company-info failed");
    res.status(500).json({ error: "Failed to load company information" });
  }
});

// ── PUT /api/company-info/basic ───────────────────────────────
// Updates doingBusinessAs and/or businessWebsite via updateCompany.
// Provider call is required — DB only written on success.
router.put("/company-info/basic", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  const { doingBusinessAs, businessWebsite } = req.body as {
    doingBusinessAs?: string;
    businessWebsite?: string;
  };

  try {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    let rollfiCompanyId: string | null = co.rollfiCompanyId ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
    if (!rollfiCompanyId) { res.status(400).json({ error: "Company not yet enrolled in payroll" }); return; }

    // Strip https:// / http:// prefix — provider expects www.domain.com format
    const websiteToSend = businessWebsite
      ? businessWebsite.replace(/^https?:\/\//i, "").trim()
      : undefined;

    const companyPayload: Record<string, string> = {
      companyId: rollfiCompanyId,
    };
    if (doingBusinessAs !== undefined) companyPayload.doingBusinessAs = doingBusinessAs;
    if (websiteToSend   !== undefined) companyPayload.businessWebsite = websiteToSend;

    const r = await axios.post(
      `${getBaseUrl()}/companyOnboarding#updateCompany`,
      { method: "updateCompany", company: companyPayload },
      { headers: rollfiHeaders() },
    );

    const rollfiErr = extractRollfiError(r.data);
    if (rollfiErr) {
      res.status(400).json({ error: rollfiErr, rollfiResponse: r.data }); return;
    }

    // Write to DB only after confirmed provider success
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbSet: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (doingBusinessAs !== undefined) dbSet.doingBusinessAs = doingBusinessAs || null;
    if (websiteToSend   !== undefined) dbSet.businessWebsite = websiteToSend  || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(companiesTable).set(dbSet as any).where(eq(companiesTable.id, companyId));

    res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "PUT /company-info/basic failed");
    res.status(500).json({ error: "Save failed", details: e.response?.data ?? String(err) });
  }
});

// ── PUT /api/company-info/location ────────────────────────────
// Updates address + phone via updateCompanyLocation.
router.put("/company-info/location", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  const { address1, address2, city, state, zipcode, phone } = req.body as {
    address1?: string; address2?: string; city?: string;
    state?: string; zipcode?: string; phone?: string;
  };

  // Validate
  if (phone && !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Phone must be exactly 10 digits" }); return;
  }
  if (zipcode && !/^\d{5}(\d{4})?$/.test(zipcode)) {
    res.status(400).json({ error: "ZIP code must be 5 or 9 digits" }); return;
  }

  // Hoisted so it's accessible in both the try and catch blocks
  let locationPayload: Record<string, string | boolean> = {};

  try {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    let rollfiCompanyId: string | null = co.rollfiCompanyId ?? null;
    let rollfiLocationId: string | null = co.rollfiLocationId ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId, rollfiLocationId: rollfiCompanyRecords.rollfiLocationId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId  = leg?.rollfiCompanyId  ?? null;
      rollfiLocationId = leg?.rollfiLocationId ?? rollfiLocationId;
    }
    if (!rollfiCompanyId) { res.status(400).json({ error: "Company not yet enrolled in payroll" }); return; }

    // Fetch the real companyLocationID live from Rollfi — the value stored in
    // companies.rollfiLocationId can be stale or an EasyTeam UUID rather than a
    // Rollfi location UUID, which causes a silent HTTP 400 with empty body.
    try {
      const locRes = await axios.post(
        `${getBaseUrl()}/reports#getCompanyLocationInfo`,
        { method: "getCompanyLocationInfo", companyId: rollfiCompanyId },
        { headers: rollfiHeaders(), timeout: 8000 },
      );
      const locs = (locRes.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
      const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
      if (work?.companyLocationID) {
        if (work.companyLocationID !== rollfiLocationId) {
          req.log.info({ fresh: work.companyLocationID, stored: rollfiLocationId }, "PUT /company-info/location: refreshed companyLocationID from Rollfi (stored value was stale/wrong)");
        }
        rollfiLocationId = work.companyLocationID;
      }
    } catch (locErr) {
      req.log.warn({ locErr }, "PUT /company-info/location: could not refresh companyLocationID from Rollfi — falling back to stored value");
    }

    // Provider call — companyLocationId resolved above (live from Rollfi, or stored fallback)
    // NOTE: do NOT include `country` — it is not a field Rollfi accepts on updateCompanyLocation
    // (not present in createBusiness either). Sending it causes a silent HTTP 400 empty-body rejection.
    // Omit address2 entirely when empty — Rollfi rejects empty-string optional fields.
    locationPayload = {
      companyId: rollfiCompanyId,
    };
    if (rollfiLocationId) locationPayload.companyLocationId = rollfiLocationId;
    if (address1 !== undefined)               { locationPayload.address1 = address1.slice(0, 40); }
    if (address2 !== undefined && address2.trim()) { locationPayload.address2 = address2.slice(0, 40); }
    if (city     !== undefined)               { locationPayload.city     = city.slice(0, 40); }
    if (state    !== undefined)               { locationPayload.state    = state; }
    if (zipcode  !== undefined)               { locationPayload.zipcode  = zipcode; }
    if (phone    !== undefined)               { locationPayload.phoneNumber = phone; }
    // NOTE: isWorkLocation / isMailingAddress / isFilingAddress are create-time-only flags;
    // including them on updateCompanyLocation causes Rollfi to throw HTTP 500.

    // updateCompanyLocation uses adminPortal path-style routing (like updateStateRegistrationInfo),
    // NOT the companyOnboarding body-dispatch pattern — Rollfi's gateway rejects unknown methods
    // on /companyOnboarding with HTTP 400 + empty body before the request reaches their application.
    const rollfiUrl = `${getBaseUrl()}/adminPortal/updateCompanyLocation`;
    const rollfiBody = { method: "updateCompanyLocation", ...locationPayload };
    req.log.info({ rollfiUrl, rollfiBaseUrl: getBaseUrl(), rollfiBody }, "PUT /company-info/location: sending to Rollfi");

    const r = await axios.post(
      rollfiUrl,
      rollfiBody,
      { headers: rollfiHeaders() },
    );

    // Provider returns empty body with 400 when request format is invalid
    if (!r.data || (typeof r.data === "object" && Object.keys(r.data).length === 0)) {
      req.log.warn({ locationPayload }, "PUT /company-info/location: Rollfi returned empty body — possible field format issue");
      res.status(400).json({
        error: "Address update was rejected by the payroll provider. Please verify the address is a valid US address and all fields are filled in correctly.",
      });
      return;
    }

    const rollfiErr = extractRollfiError(r.data);
    if (rollfiErr) {
      req.log.warn({ rollfiErr, rollfiData: r.data }, "PUT /company-info/location: Rollfi returned error body");
      res.status(400).json({ error: `Payroll provider rejected the address: ${rollfiErr}` }); return;
    }

    // Write to DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbSet: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (address1 !== undefined) dbSet.address1 = address1;
    if (address2 !== undefined) dbSet.address2 = address2 || null;
    if (city     !== undefined) dbSet.city     = city;
    if (state    !== undefined) dbSet.state    = state;
    if (zipcode  !== undefined) dbSet.zipcode  = zipcode;
    if (phone    !== undefined) dbSet.phone    = phone;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(companiesTable).set(dbSet as any).where(eq(companiesTable.id, companyId));

    res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status?: number; headers?: unknown } };
    const rollfiStatus = e.response?.status;
    const rollfiData = e.response?.data;

    // Log the FULL Rollfi response at every non-2xx status so we can diagnose
    req.log.warn(
      { rollfiStatus, rollfiData, rollfiHeaders: e.response?.headers, locationPayload },
      `PUT /company-info/location: Rollfi returned HTTP ${rollfiStatus ?? "unknown"}`,
    );

    if (rollfiStatus === 400 || rollfiStatus === 500 || rollfiStatus !== undefined) {
      // Extract any error detail Rollfi included in the body
      let detail: string | null = null;
      if (rollfiData && typeof rollfiData === "object") {
        const d = rollfiData as Record<string, unknown>;
        const errObj = d.error;
        if (typeof errObj === "string" && errObj.trim()) detail = errObj.trim();
        else if (errObj && typeof errObj === "object") detail = (errObj as { message?: string }).message?.trim() ?? null;
        else if (typeof d.message === "string" && (d.message as string).trim()) detail = (d.message as string).trim();
      } else if (typeof rollfiData === "string" && (rollfiData as string).trim()) {
        detail = (rollfiData as string).trim();
      }
      res.status(400).json({
        error: detail
          ? `Payroll provider rejected the address: ${detail}`
          : "Address update was rejected by the payroll provider. Please verify the address is a valid US address and all fields are filled in correctly.",
      });
      return;
    }

    req.log.error({ err }, "PUT /company-info/location failed (non-HTTP error)");
    res.status(500).json({ error: "Save failed" });
  }
});

// ── PUT /api/company-info/kyb ─────────────────────────────────
// Updates EIN / entity type / date of incorporation via updateKybInformation.
// Locked when kybStatus is not "not_started" (matches provider's own restriction).
router.put("/company-info/kyb", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  const { ein, entityType, dateOfIncorporation } = req.body as {
    ein?: string; entityType?: string; dateOfIncorporation?: string;
  };

  try {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    let rollfiCompanyId: string | null = co.rollfiCompanyId ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
    if (!rollfiCompanyId) { res.status(400).json({ error: "Company not yet enrolled in payroll" }); return; }

    if (co.kybStatus !== "not_started") {
      res.status(400).json({
        error: "Tax and legal details are locked once business verification has been submitted. Contact support if a correction is needed.",
      });
      return;
    }

    // Get kybInformationId from provider
    let kybInformationId: string | null = null;
    try {
      const infoR = await axios.post(
        `${getBaseUrl()}/reports#getCompanyInfo`,
        { method: "getCompanyInfo", companyId: rollfiCompanyId },
        { headers: rollfiHeaders() },
      );
      kybInformationId = infoR.data?.Company?.[0]?.KYBInformations?.[0]?.KybInformationId ?? null;
    } catch (_e) { /* proceed without */ }

    const kybPayload: Record<string, string> = {
      companyId: rollfiCompanyId,
    };
    if (kybInformationId)      kybPayload.kybInformationId   = kybInformationId;
    if (ein)                   kybPayload.ein                = ein;
    if (entityType)            kybPayload.entityType         = entityType;
    if (dateOfIncorporation)   kybPayload.dateOfIncorporation = dateOfIncorporation;

    const r = await axios.post(
      `${getBaseUrl()}/companyOnboarding#updateKybInformation`,
      { method: "updateKybInformation", kybInformation: kybPayload },
      { headers: rollfiHeaders() },
    );

    const rollfiErr = extractRollfiError(r.data);
    if (rollfiErr) {
      res.status(400).json({ error: rollfiErr, rollfiResponse: r.data }); return;
    }

    // Write to DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbSet: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (ein)   dbSet.ein = ein;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(companiesTable).set(dbSet as any).where(eq(companiesTable.id, companyId));

    res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "PUT /company-info/kyb failed");
    res.status(500).json({ error: "Save failed", details: e.response?.data ?? String(err) });
  }
});

// ── reconcile8655UploadInline ─────────────────────────────────────────────────
// Internal helper called by GET /dashboard and GET /rollfi/pending-signatures.
// Checks whether a stored "uploaded" Form 8655 is still present in Rollfi.
// Returns:
//   "uploaded"    — document confirmed present, no DB change
//   "failed"      — document confirmed missing, DB flipped to "failed"
//   "unavailable" — couldn't determine (network error / unexpected shape), no change
//
// Callers must only invoke this when uploadStatus === "uploaded" and a
// rollfiCompanyId is available.  The function never throws.
//
// Both Rollfi endpoints are queried in parallel (Promise.any) with a 5-second
// timeout each, so a slow/down Rollfi adds at most ~5 s to the response — not
// the previous worst-case of 20 s (2 sequential × 10 s).
async function reconcile8655UploadInline(
  companyId: string,
  rollfiCompanyId: string,
  rollfiDocumentId: string | null,
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<"uploaded" | "failed" | "unavailable"> {
  if (!getRollfiConfig().credentialsPresent) return "unavailable";

  /** Parse a Rollfi getCompanyDocuments response into a doc list, or null if unusable. */
  function parseDocList(data: unknown): unknown[] | null {
    const docs = data as Record<string, unknown>;
    const list: unknown[] =
      Array.isArray(docs.documents) ? docs.documents :
      Array.isArray(docs.Documents) ? docs.Documents :
      Array.isArray(docs.data)      ? docs.data       : [];
    if (list.length > 0 || !extractRollfiError(data)) return list;
    return null;
  }

  /** Return true/false based on doc list + our document ID / type filter. */
  function checkList(list: unknown[]): boolean {
    if (rollfiDocumentId) {
      return list.some(
        d => (d as Record<string, unknown>).documentId === rollfiDocumentId ||
             (d as Record<string, unknown>).DocumentId === rollfiDocumentId,
      );
    }
    return list.some(d => {
      const dt = ((d as Record<string, unknown>).documentType ??
                  (d as Record<string, unknown>).DocumentType ?? "") as string;
      return /8655/i.test(dt);
    });
  }

  /** Fetch one endpoint and resolve to boolean (present/absent) or null (unusable). */
  async function fetchEndpoint(url: string): Promise<boolean | null> {
    try {
      const r = await axios.post(
        url,
        { method: "getCompanyDocuments", companyId: rollfiCompanyId },
        { headers: rollfiHeaders(), timeout: 5_000 },
      );
      const list = parseDocList(r.data);
      if (list === null) return null;
      return checkList(list);
    } catch {
      return null;
    }
  }

  // Fire both endpoints in parallel, then reconcile:
  // - adminPortal is the preferred/authoritative source (original precedence)
  // - If either usable result says "present", the document exists — never flip to failed
  // - Only flip to "failed" when every usable endpoint reports the document absent
  const [adminResult, reportsResult] = await Promise.all([
    fetchEndpoint(`${getBaseUrl()}/adminPortal/getCompanyDocuments`),
    fetchEndpoint(`${getBaseUrl()}/reports#getCompanyDocuments`),
  ]);

  // Determine presence: "present" from any source wins (conservative); absence requires
  // all usable sources to agree so we never falsely invalidate a document.
  let documentPresent: boolean | null;
  if (adminResult === null && reportsResult === null) {
    documentPresent = null; // both unusable
  } else if (adminResult === true || reportsResult === true) {
    documentPresent = true; // at least one source confirms presence
  } else {
    // At least one usable result and none returned true — document is absent.
    // Prefer the adminPortal determination when available; fall back to reports.
    documentPresent = adminResult !== null ? adminResult : reportsResult;
  }

  if (documentPresent === null) {
    logger.warn({ companyId, rollfiDocumentId }, "reconcile8655UploadInline: could not determine document status from Rollfi");
    return "unavailable";
  }

  if (documentPresent) return "uploaded";

  // Document confirmed missing — flip to failed
  const errorMsg = "Form 8655 document was no longer found in the filing service. Please retry the upload.";
  await db.update(companySignedForms)
    .set({ uploadStatus: "failed", uploadError: errorMsg, rollfiDocumentId: null })
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch((dbErr: unknown) => logger.warn({ dbErr } as Record<string, unknown>, "reconcile8655UploadInline: failed to persist status update"));

  logger.warn({ companyId, rollfiDocumentId }, "reconcile8655UploadInline: document missing from Rollfi — flipped to failed");
  return "failed";
}

// ── GET /dashboard ───────────────────────────────────────────────────────────
// Single-fetch endpoint for the Company Settings landing page.
// Returns: configuration progress (8 steps), attention items, and registration count.
// Owner + super_admin only; company-scoped via resolveCompanyId.
router.get("/dashboard", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  try {
    // ── 1. Company record ──────────────────────────────────────────────────────
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    // Resolve rollfi IDs — legacy companies may only have them in rollfi_company_records
    let resolvedRollfiCompanyId: string | null = co.rollfiCompanyId ?? null;
    if (!resolvedRollfiCompanyId) {
      const [leg] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords)
        .where(eq(rollfiCompanyRecords.companyId, companyId))
        .catch(() => [undefined]);
      resolvedRollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }

    // ── 2. Parallel data fetches ───────────────────────────────────────────────
    const [allEmps, regs, signedFormRows] = await Promise.all([
      db.select({
        id:                  employeesTable.id,
        firstName:           employeesTable.firstName,
        lastName:            employeesTable.lastName,
        homeState:           employeesTable.homeState,
        status:              employeesTable.status,
        rollfiAccountStatus: employeesTable.rollfiAccountStatus,
      }).from(employeesTable).where(eq(employeesTable.companyId, companyId)),
      db.select({ stateCode: stateRegistrationsTable.stateCode, status: stateRegistrationsTable.status })
        .from(stateRegistrationsTable).where(eq(stateRegistrationsTable.companyId, companyId)),
      db.select({
        formType:          companySignedForms.formType,
        signerName:        companySignedForms.signerName,
        signerTitle:       companySignedForms.signerTitle,
        signedAt:          companySignedForms.signedAt,
        uploadStatus:      companySignedForms.uploadStatus,
        uploadError:       companySignedForms.uploadError,
        rollfiDocumentId:  companySignedForms.rollfiDocumentId,
        uploadAttemptedAt: companySignedForms.uploadAttemptedAt,
      }).from(companySignedForms).where(eq(companySignedForms.companyId, companyId)),
    ]);

    // Build a quick lookup: formType → signed record
    const signedFormsMap = Object.fromEntries(
      signedFormRows.map(r => [r.formType, r])
    );
    const form8655Signed = !!signedFormsMap["8655"];
    // "pending" | "uploaded" | "failed" | null
    let form8655UploadStatus: string | null = signedFormsMap["8655"]?.uploadStatus ?? null;

    // ── 2b. Reconcile "uploaded" status before using it ───────────────────
    // If the stored status is "uploaded", confirm Rollfi still has the document.
    // If it's gone, flip the local record to "failed" and update our variable so
    // the same response carries the corrected status — no extra round-trip needed.
    if (form8655UploadStatus === "uploaded" && resolvedRollfiCompanyId) {
      const reconcileResult = await reconcile8655UploadInline(
        companyId,
        resolvedRollfiCompanyId,
        signedFormsMap["8655"]?.rollfiDocumentId ?? null,
        req.log,
      ).catch(() => "unavailable" as const);
      if (reconcileResult === "failed") {
        form8655UploadStatus = "failed";
      }
    }

    // ── 3. Rollfi getCompanyTask (authoritative for KYB + bank) ───────────────
    let rollfiTasks: Array<{ task: string; description: string }> = [];
    let kybStatusFromProvider: string | null = null;
    let bankLinked: boolean = co.bankAccountAdded ?? false;

    let rollfiTasksFetched = false;
    if (resolvedRollfiCompanyId) {
      try {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getCompanyTask`,
          { method: "getCompanyTask", companyId: resolvedRollfiCompanyId },
          { headers: rollfiHeaders() },
        );
        const raw = r.data as Record<string, unknown>;
        rollfiTasks = (raw.tasks ?? []) as Array<{ task: string; description: string }>;
        rollfiTasksFetched = true;
        const kybTask  = rollfiTasks.find(t => t.task === "KYB verification");
        const bankTask = rollfiTasks.find(t => t.task === "Connect bank account");
        if (!kybTask) {
          kybStatusFromProvider = "approved";
        } else {
          const desc = kybTask.description.toLowerCase();
          if (desc.includes("failed")) kybStatusFromProvider = "failed";
          else if (desc.includes("pending") || desc.includes("review")) kybStatusFromProvider = "pending";
          else if (desc.includes("approved") || desc.includes("verified") || desc.includes("success")) kybStatusFromProvider = "approved";
          else kybStatusFromProvider = "issue";
        }
        bankLinked = !bankTask;
      } catch {
        // Non-fatal — fall back to DB values
      }
    }

    const kybStatus   = kybStatusFromProvider ?? co.kybStatus;
    const kybApproved = kybStatus === "approved";

    // ── 4. Derive state registration gaps ─────────────────────────────────────
    const activeRegStates = new Set(regs.filter(r => r.status === "active").map(r => r.stateCode));

    const gapMap = new Map<string, { state: string; employees: { id: string; name: string }[] }>();
    for (const emp of allEmps) {
      if (!emp.homeState || emp.status === "terminated") continue;
      const st = emp.homeState.trim().toUpperCase();
      if (NO_REGISTRATION_NEEDED.has(st) || activeRegStates.has(st)) continue;
      if (!gapMap.has(st)) gapMap.set(st, { state: st, employees: [] });
      gapMap.get(st)!.employees.push({ id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim() });
    }
    const gaps = Array.from(gapMap.values());

    // ── 5. Employee counts ─────────────────────────────────────────────────────
    const activeEmps       = allEmps.filter(e => e.status !== "terminated" && e.status !== "inactive");
    const employeeCount    = activeEmps.length;
    const notReadyEmps     = activeEmps.filter(e => e.rollfiAccountStatus !== "Active");
    const payrollReadyCount = activeEmps.length - notReadyEmps.length;

    // ── 6. Build configuration progress steps ─────────────────────────────────
    const payScheduleSet = (co.payScheduleAdded === true) && !!(co.payFrequency);

    const { steps, stepsAllDone, completedCount, totalCount } = buildDashboardSteps({
      resolvedRollfiCompanyId,
      kybApproved,
      kybStatus,
      bankLinked,
      payScheduleSet,
      payScheduleAdded: co.payScheduleAdded ?? null,
      payFrequency: co.payFrequency,
      gaps,
      employeeCount,
      notReadyEmpsCount: notReadyEmps.length,
      form8655Signed,
      form8655UploadStatus,
    });

    // ── 7. Attention Required items ────────────────────────────────────────────
    const PROVIDER_RE = /\brollfi\b/gi;
    const sanitize = (t: string) => t.replace(PROVIDER_RE, "payroll service");

    const attention: Array<{
      id: string; severity: "high" | "medium" | "low";
      message: string; linkTo: string | null; actionLabel?: string | null; category: string;
    }> = [];

    // a. Provider task list (exclude the bank-account task — it's in the progress steps)
    for (const t of rollfiTasks) {
      if (t.task === "Connect bank account") continue;
      const raw = `${t.task}${t.description ? ": " + t.description : ""}`;
      const isSignature = /signature request/i.test(t.task);
      attention.push({
        id: `task_${t.task.replace(/\W+/g, "_").toLowerCase()}`,
        severity: "high",
        message: sanitize(raw),
        linkTo: isSignature
          ? "/settings?tab=signatures"
          : /state.*(tax|reg)/i.test(raw) ? "/settings?tab=state-tax" : null,
        actionLabel: isSignature ? "Sign form" : null,
        category: isSignature ? "signature" : "task",
      });
    }

    // b. State registration gaps
    for (const gap of gaps) {
      const empNames = gap.employees.slice(0, 2).map(e => e.name).join(", ");
      const more = gap.employees.length > 2 ? ` +${gap.employees.length - 2} more` : "";
      attention.push({
        id: `gap_${gap.state}`,
        severity: "high",
        message: `${gap.state} state tax registration is missing (${empNames}${more})`,
        linkTo: "/settings?tab=state-tax",
        category: "registration",
      });
    }

    // c. Employees not yet payroll-ready
    const MAX_EMP_ITEMS = 3;
    for (const emp of notReadyEmps.slice(0, MAX_EMP_ITEMS)) {
      attention.push({
        id: `emp_${emp.id}`,
        severity: "medium",
        message: `${emp.firstName} ${emp.lastName} is not yet activated for payroll`,
        linkTo: `/people/${emp.id}`,
        category: "employee",
      });
    }
    if (notReadyEmps.length > MAX_EMP_ITEMS) {
      attention.push({
        id: "emp_overflow",
        severity: "medium",
        message: `${notReadyEmps.length - MAX_EMP_ITEMS} more employee${notReadyEmps.length - MAX_EMP_ITEMS > 1 ? "s are" : " is"} not yet activated for payroll`,
        linkTo: "/people",
        category: "employee",
      });
    }

    // d. IRS Form 8655 — only warn if Rollfi itself lists it as an outstanding task
    //    (or if we couldn't reach Rollfi at all, to stay conservative).
    //    Suppresses the notification when Rollfi considers 8655 already done.
    const rollfi8655Task = rollfiTasks.some(t =>
      /8655/i.test(t.task) || /8655/i.test(t.description ?? "")
    );
    const show8655Warning = !form8655Signed && (!rollfiTasksFetched || rollfi8655Task);
    if (show8655Warning) {
      attention.push({
        id: "form_8655_unsigned",
        severity: "high",
        message: "IRS Form 8655 has not been signed — required before federal tax filings can be made",
        linkTo: "/settings?tab=signatures",
        actionLabel: "Sign form",
        category: "signature",
      });
    } else if (form8655UploadStatus === "failed") {
      attention.push({
        id: "form_8655_upload_failed",
        severity: "high",
        message: "Form 8655 is signed but could not be submitted to the IRS filing service — retry the upload",
        linkTo: "/settings?tab=signatures",
        actionLabel: "Retry upload",
        category: "signature",
      });
    } else if (form8655UploadStatus === "pending") {
      // Escalate to "high" once the upload attempt is older than the staleness threshold.
      const attemptedAt = signedFormsMap["8655"]?.uploadAttemptedAt ?? null;
      const isStale = attemptedAt
        ? (Date.now() - new Date(attemptedAt).getTime()) > STALE_THRESHOLD_MS
        : false;
      attention.push({
        id: "form_8655_upload_pending",
        severity: isStale ? "high" : "medium",
        message: isStale
          ? "Form 8655 upload appears stuck — it has been pending for more than 15 minutes. Please retry the upload."
          : "Form 8655 is signed but has not yet been submitted to the IRS filing service — if it has been pending for more than a few minutes, retry the upload",
        linkTo: "/settings?tab=signatures",
        actionLabel: "Retry upload",
        category: "signature",
      });
    }

    res.json({
      company: { id: co.id, name: co.name },
      progress: { completedCount, totalCount, steps },
      attention,
      registrationCount: activeRegStates.size,
      // Debug summary (stripped in prod UI)
      _debug: { kybStatus, bankLinked, payScheduleSet, employeeCount, payrollReadyCount, gapCount: gaps.length, form8655Signed },
    });
  } catch (err) {
    req.log.error({ err }, "GET /company-settings/dashboard failed");
    res.status(500).json({ error: "Failed to load company settings dashboard" });
  }
});

// ── GET /rollfi/pending-signatures ────────────────────────────────────────────
// Returns "Signature request" tasks from Rollfi + locally-signed form records.

router.get("/rollfi/pending-signatures", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  // Always fetch local signed-form records (fast DB query)
  type SignedRow = { formType: string; signerName: string; signerTitle: string; signedAt: string; uploadStatus: string; uploadError: string | null; rollfiDocumentId: string | null; uploadAttemptedAt: string | null };
  const signedRows: SignedRow[] = await db
    .select({
      formType:          companySignedForms.formType,
      signerName:        companySignedForms.signerName,
      signerTitle:       companySignedForms.signerTitle,
      signedAt:          companySignedForms.signedAt,
      uploadStatus:      companySignedForms.uploadStatus,
      uploadError:       companySignedForms.uploadError,
      rollfiDocumentId:  companySignedForms.rollfiDocumentId,
      uploadAttemptedAt: companySignedForms.uploadAttemptedAt,
    })
    .from(companySignedForms)
    .where(eq(companySignedForms.companyId, companyId))
    .catch(() => [] as SignedRow[]);
  const signedForms = Object.fromEntries(signedRows.map(r => [r.formType, r]));

  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  // Reconcile "uploaded" Form 8655 before building the response — if Rollfi no
  // longer has the document, flip the status so the retry prompt appears on this
  // same page load without an extra round-trip.
  if (rollfiCompanyId && signedForms["8655"]?.uploadStatus === "uploaded") {
    const reconcileResult = await reconcile8655UploadInline(
      companyId,
      rollfiCompanyId,
      signedForms["8655"].rollfiDocumentId,
      req.log,
    ).catch(() => "unavailable" as const);
    if (reconcileResult === "failed") {
      signedForms["8655"] = { ...signedForms["8655"], uploadStatus: "failed", uploadError: "Form 8655 document was no longer found in the filing service. Please retry the upload." };
    }
  }

  if (!rollfiCompanyId || !getRollfiConfig().credentialsPresent) {
    res.json({ signatures: [], signedForms, uploadStaleThresholdMs: STALE_THRESHOLD_MS }); return;
  }

  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanyTask`,
      { method: "getCompanyTask", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() },
    );
    const tasks = ((r.data as Record<string, unknown>).tasks ?? []) as Array<{ task: string; description: string }>;
    res.json({ signatures: tasks.filter(t => /signature request/i.test(t.task)), signedForms, uploadStaleThresholdMs: STALE_THRESHOLD_MS });
  } catch (err) {
    req.log.error({ err }, "GET /rollfi/pending-signatures failed");
    res.status(500).json({ error: "Failed to fetch pending signatures" });
  }
});

// ── POST /rollfi/request-signing-link ────────────────────────────────────────
// Probes Rollfi for a live signing URL; returns { url, message, emailSent }.
// On sandbox / unavailable → graceful email-fallback message.

router.post("/rollfi/request-signing-link", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;
  const { formTask, email } = req.body as { formTask?: string; email?: string };

  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db.select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  if (!rollfiCompanyId) {
    res.json({ url: null, message: "Company is not yet enrolled in the payroll service.", emailSent: false });
    return;
  }

  // Extract form identifier (e.g. "Form TR-2000 Signature request" → "TR-2000")
  const formMatch = (formTask ?? "").match(/Form\s+([\w-]+)\s+Signature/i);
  const formType = formMatch?.[1] ?? "Unknown";

  // Probe Rollfi — try several signing-URL method/path combos
  const attempts: Array<[string, Record<string, string>]> = [
    ["/reports#getCompanySigningUrl",            { method: "getCompanySigningUrl",       companyId: rollfiCompanyId, documentType: formType }],
    ["/reports#getSigningUrl",                   { method: "getSigningUrl",              companyId: rollfiCompanyId, formType }],
    ["/companyOnboarding#getSigningUrl",         { method: "getSigningUrl",              companyId: rollfiCompanyId, formType }],
    ["/companyOnboarding#getDocumentSigningUrl", { method: "getDocumentSigningUrl",      companyId: rollfiCompanyId, documentType: formType }],
  ];

  for (const [path, body] of attempts) {
    try {
      const r = await axios.post(`${getBaseUrl()}${path}`, body, { headers: rollfiHeaders() });
      const d = r.data as Record<string, unknown>;
      const url = (d.url ?? d.signingUrl ?? d.signUrl ?? d.link ?? null) as string | null;
      if (url && typeof url === "string" && url.startsWith("http")) {
        res.json({ url, message: "Signing page opened.", emailSent: false });
        return;
      }
    } catch { /* try next */ }
  }

  // No live URL — if caller supplied an email address, send a notification email
  if (email && typeof email === "string" && email.includes("@")) {
    try {
      await sendFormSigningLinkEmail({ to: email, formType });
      res.json({
        url: null,
        message: `The signing link request for Form ${formType} has been sent to ${email}. You should receive it within a few minutes.`,
        emailSent: true,
        sentTo: email,
      });
    } catch (err) {
      req.log.warn({ err }, "request-signing-link: failed to send email");
      res.json({
        url: null,
        message: `Form ${formType} signing link requested. Check your email — you should receive the link shortly.`,
        emailSent: false,
      });
    }
    return;
  }

  // No email supplied — return the prompt-for-email signal
  res.json({
    url: null,
    message: `Which email should we send the signing link for Form ${formType} to?`,
    emailSent: false,
    promptEmail: true,
  });
});

// ── POST /rollfi/companies/:companyId/sign-8655 ───────────────────────────────
// In-app e-sign for IRS Form 8655.
//
// 1. Validates caller (owner / super_admin via resolveCompanyId).
// 2. Fetches live company + beneficial-owner data from Rollfi (read-only).
// 3. Generates the Form 8655 PDF using pdf-lib.
// 4. Persists the signed record to company_signed_forms (UPSERT).
// 5. Uploads the PDF to Rollfi via uploadDocument.
// 6. Updates upload_status → "uploaded" (or "failed" on error).
//    Signing always succeeds regardless of upload outcome.

router.post("/rollfi/companies/:companyId/sign-8655", requireAuth, async (req: Request, res: Response) => {
  // resolveCompanyId enforces owner/super_admin + scopes to caller's company.
  // For this route, also honour the URL param when the session company matches.
  const sessionCompanyId = resolveCompanyId(req, res);
  if (!sessionCompanyId) return;

  const urlCompanyId = req.params.companyId as string;
  // super_admin may sign for any company; owner must match their own
  const caller = store.getUserById(req.session.userId!);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (caller.role !== "super_admin" && urlCompanyId !== sessionCompanyId) {
    res.status(403).json({ error: "Access denied" }); return;
  }
  const companyId = caller.role === "super_admin" ? urlCompanyId : sessionCompanyId;

  const { signerName, signerTitle, signatureImageBase64 } = req.body as { signerName?: string; signerTitle?: string; signatureImageBase64?: string };
  if (!signerName?.trim() || !signerTitle?.trim()) {
    res.status(400).json({ error: "signerName and signerTitle are required" }); return;
  }

  // Validate drawn signature image if provided (must be a valid base64 PNG).
  const cleanedSigImage: string | undefined = signatureImageBase64
    ? signatureImageBase64.replace(/^data:image\/png;base64,/, "").trim() || undefined
    : undefined;

  // ── Resolve Rollfi company ID ─────────────────────────────────────────────
  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company is not yet enrolled in the payroll service" }); return;
  }

  if (!getRollfiConfig().credentialsPresent) {
    res.status(503).json({ error: "Payroll service credentials not configured" }); return;
  }

  // ── Fetch company info + business users from Rollfi (read-only) ───────────
  let taxpayerName    = "";
  let taxpayerEin     = "";
  let address         = "";
  let cityStateZip    = "";
  let phone           = "";

  try {
    const infoResp = await axios.post(
      `${getBaseUrl()}/reports#getCompanyInfo`,
      { method: "getCompanyInfo", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() },
    );
    req.log.info({ rollfiResponse: infoResp.data }, "sign-8655: getCompanyInfo response");
    const raw       = infoResp.data as Record<string, unknown>;
    const companies = Array.isArray(raw.Company) ? raw.Company as Record<string, unknown>[] : [];
    const co        = companies[0] ?? {};

    taxpayerName = (co.company as string | undefined) ?? "";

    const kybInfos = Array.isArray(co.KYBInformations) ? co.KYBInformations as Record<string, unknown>[] : [];
    taxpayerEin    = (kybInfos[0]?.ein as string | undefined) ?? "";
    phone          = (kybInfos[0]?.phoneNumber as string | undefined) ?? "";

    const locs     = Array.isArray(co.CompanyLocations) ? co.CompanyLocations as Record<string, unknown>[] : [];
    const loc      = locs[0] ?? {};
    address        = (loc.address1 as string | undefined) ?? "";
    const city     = (loc.city     as string | undefined) ?? "";
    const state    = (loc.state    as string | undefined) ?? "";
    const zip      = (loc.zipcode  as string | undefined) ?? "";
    cityStateZip   = [city, state, zip].filter(Boolean).join(", ");
  } catch (err) {
    req.log.warn({ err }, "sign-8655: getCompanyInfo failed — using DB fallback");
    // Fall back to DB company record
    const [dbCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
    if (dbCo) {
      taxpayerName = dbCo.name ?? "";
      taxpayerEin  = dbCo.ein  ?? "";
      address      = [dbCo.address1, dbCo.address2].filter(Boolean).join(" ");
      cityStateZip = [dbCo.city, dbCo.state, dbCo.zipcode].filter(Boolean).join(", ");
      phone        = dbCo.phone ?? "";
    }
  }

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const signedAt = new Date();
  const { annual940, quarterly941 } = getForm8655AuthDates(signedAt);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildForm8655Pdf({
      taxpayerName:        taxpayerName.trim()  || "Company",
      taxpayerEin:         taxpayerEin.trim(),
      address:             address.trim(),
      cityStateZip:        cityStateZip.trim(),
      phone:               phone.trim(),
      signerName:          signerName.trim(),
      signerTitle:         signerTitle.trim(),
      signedAt,
      annual940,
      quarterly941,
      signatureImageBase64: cleanedSigImage,
    });
  } catch (err) {
    req.log.error({ err }, "sign-8655: PDF generation failed");
    res.status(500).json({ error: "Failed to generate Form 8655 PDF" }); return;
  }

  req.log.info({ companyId, pdfBytes: pdfBytes.length }, "sign-8655: PDF generated");

  // ── Persist to DB (UPSERT — re-signing overwrites) ────────────────────────
  const id        = randomUUID();
  const createdAt = signedAt.toISOString();
  const signedAtIso = signedAt.toISOString();

  const uploadAttemptedAt = signedAt.toISOString();

  try {
    await db
      .insert(companySignedForms)
      .values({
        id,
        companyId,
        formType:          "8655",
        signerName:        signerName.trim(),
        signerTitle:       signerTitle.trim(),
        signedAt:          signedAtIso,
        uploadStatus:      "pending",
        uploadAttemptedAt,
        signatureImage:    cleanedSigImage ?? null,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [companySignedForms.companyId, companySignedForms.formType],
        set: {
          signerName:        signerName.trim(),
          signerTitle:       signerTitle.trim(),
          signedAt:          signedAtIso,
          uploadStatus:      "pending",
          uploadAttemptedAt,
          uploadError:       null,
          rollfiDocumentId:  null,
          signatureImage:    cleanedSigImage ?? null,
        },
      });
  } catch (err) {
    req.log.error({ err }, "sign-8655: DB upsert failed");
    res.status(500).json({ error: "Failed to save signature record" }); return;
  }

  req.log.info({ companyId, signerName, signerTitle }, "sign-8655: form signed and persisted");

  // ── Upload PDF to Rollfi ───────────────────────────────────────────────────
  let uploadStatus: string  = "pending";
  let uploadError:  string | null = null;
  let rollfiDocumentId: string | null = null;

  try {
    const dateStr  = signedAt.toISOString().slice(0, 10).replace(/-/g, "");
    const safeName = signerName.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
    const fileName = `Form8655_${safeName}_${dateStr}.pdf`;
    const fileBase64 = Buffer.from(pdfBytes).toString("base64");

    const uploadResp = await axios.post(
      `${getBaseUrl()}/adminPortal/uploadDocument`,
      {
        method:       "uploadDocument",
        companyId:    rollfiCompanyId,
        fileName,
        documentType: "8655Form",
        fileBase64,
      },
      { headers: rollfiHeaders() },
    );

    req.log.info({ uploadResp: uploadResp.data }, "sign-8655: uploadDocument response");

    // Expected Rollfi response shape: { documentId: string } on success,
    // or { error: string | { code, message } } / { success: false } on failure.
    // We require an explicit documentId or success:true — a 2xx with neither
    // is treated as a failure so we never silently swallow unexpected shapes.
    const upData = uploadResp.data as Record<string, unknown>;
    if (upData?.documentId) {
      rollfiDocumentId = upData.documentId as string;
      uploadStatus = "uploaded";
    } else if (upData?.success === true) {
      // Provider confirmed success without a documentId
      uploadStatus = "uploaded";
    } else if (upData?.error || upData?.success === false) {
      const errVal = upData?.error;
      const errMsg = typeof errVal === "string" ? errVal
        : typeof (errVal as Record<string, unknown>)?.message === "string"
          ? String((errVal as Record<string, unknown>).message)
          : JSON.stringify(errVal ?? "uploadDocument returned success=false");
      throw new Error(errMsg);
    } else {
      // Neither documentId nor success:true — treat as failure and log raw body
      req.log.error({ rawUploadResponse: uploadResp.data }, "sign-8655: uploadDocument returned unexpected shape (no documentId, no success:true)");
      throw new Error(`uploadDocument returned an unrecognised response shape: ${JSON.stringify(uploadResp.data)}`);
    }

    // Persist the upload outcome
    await db.update(companySignedForms)
      .set({ uploadStatus, rollfiDocumentId, uploadError: null })
      .where(
        and(
          eq(companySignedForms.companyId, companyId),
          eq(companySignedForms.formType, "8655"),
        ),
      );

    req.log.info({ companyId, rollfiDocumentId }, "sign-8655: upload succeeded");
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    uploadError  = msg;
    uploadStatus = "failed";
    req.log.warn({ err: uploadErr }, "sign-8655: uploadDocument failed — signing still complete");

    // Record the failure so the UI can surface a retry prompt
    await db.update(companySignedForms)
      .set({ uploadStatus: "failed", uploadError: msg })
      .where(
        and(
          eq(companySignedForms.companyId, companyId),
          eq(companySignedForms.formType, "8655"),
        ),
      )
      .catch((dbErr) => req.log.warn({ dbErr }, "sign-8655: failed to persist upload error"));
  }

  store.logActivity({ companyId, type: "document.signed", description: `Form 8655 signed by ${signerName.trim()}`, actorName: caller?.name ?? signerName.trim(), actorRole: caller?.role ?? signerTitle.trim() });

  res.json({
    id,
    signerName:       signerName.trim(),
    signerTitle:      signerTitle.trim(),
    signedAt:         signedAtIso,
    uploadStatus,
    uploadError,
    rollfiDocumentId,
  });
});

// ── POST /rollfi/companies/:companyId/retry-8655-upload ───────────────────────
// Retries uploading an already-signed Form 8655 PDF to the filing service.
// Regenerates the PDF from stored signer data + live Rollfi company info, then
// calls uploadDocument.  Returns 200 on success, 202 when upload is attempted
// (status reflects outcome), 404 when no signed form exists, and 409 when the
// form is already uploaded successfully.
router.post("/rollfi/companies/:companyId/retry-8655-upload", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const companyId = req.params.companyId as string;
  if (user.role !== "super_admin" && user.companyId !== companyId) {
    res.status(403).json({ error: "Access denied: company mismatch" }); return;
  }

  // ── 1. Look up the existing signed-form record ────────────────────────────
  const [row] = await db
    .select({
      id:             companySignedForms.id,
      uploadStatus:   companySignedForms.uploadStatus,
      signerName:     companySignedForms.signerName,
      signerTitle:    companySignedForms.signerTitle,
      signedAt:       companySignedForms.signedAt,
      signatureImage: companySignedForms.signatureImage,
    })
    .from(companySignedForms)
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch(() => [] as { id: string; uploadStatus: string; signerName: string; signerTitle: string; signedAt: string; signatureImage: string | null }[]);

  if (!row) {
    res.status(404).json({ error: "No signed Form 8655 found for this company" }); return;
  }
  if (row.uploadStatus === "uploaded") {
    res.status(409).json({ error: "Form 8655 has already been uploaded successfully" }); return;
  }

  // ── 2. Resolve Rollfi company ID ──────────────────────────────────────────
  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company is not enrolled in the payroll service" }); return;
  }

  if (!getRollfiConfig().credentialsPresent) {
    res.status(503).json({ error: "Payroll service credentials not configured" }); return;
  }

  // ── 3. Mark as pending while the retry is in flight ───────────────────────
  const retryAttemptedAt = new Date().toISOString();
  await db
    .update(companySignedForms)
    .set({ uploadStatus: "pending", uploadError: null, uploadAttemptedAt: retryAttemptedAt })
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch(() => {});

  // ── 4. Fetch company info from Rollfi to rebuild PDF ─────────────────────
  let taxpayerName = "";
  let taxpayerEin  = "";
  let address      = "";
  let cityStateZip = "";
  let phone        = "";

  try {
    const infoResp = await axios.post(
      `${getBaseUrl()}/reports#getCompanyInfo`,
      { method: "getCompanyInfo", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() },
    );
    const raw       = infoResp.data as Record<string, unknown>;
    const companies = Array.isArray(raw.Company) ? raw.Company as Record<string, unknown>[] : [];
    const co        = companies[0] ?? {};
    taxpayerName    = (co.company as string | undefined) ?? "";
    const kybInfos  = Array.isArray(co.KYBInformations) ? co.KYBInformations as Record<string, unknown>[] : [];
    taxpayerEin     = (kybInfos[0]?.ein as string | undefined) ?? "";
    phone           = (kybInfos[0]?.phoneNumber as string | undefined) ?? "";
    const locs      = Array.isArray(co.CompanyLocations) ? co.CompanyLocations as Record<string, unknown>[] : [];
    const loc       = locs[0] ?? {};
    address         = (loc.address1 as string | undefined) ?? "";
    const city      = (loc.city     as string | undefined) ?? "";
    const state     = (loc.state    as string | undefined) ?? "";
    const zip       = (loc.zipcode  as string | undefined) ?? "";
    cityStateZip    = [city, state, zip].filter(Boolean).join(", ");
  } catch (err) {
    req.log.warn({ err }, "retry-8655-upload: getCompanyInfo failed — using DB fallback");
    const [dbCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
    if (dbCo) {
      taxpayerName = dbCo.name ?? "";
      taxpayerEin  = dbCo.ein  ?? "";
      address      = [dbCo.address1, dbCo.address2].filter(Boolean).join(" ");
      cityStateZip = [dbCo.city, dbCo.state, dbCo.zipcode].filter(Boolean).join(", ");
      phone        = dbCo.phone ?? "";
    }
  }

  // ── 5. Rebuild PDF ────────────────────────────────────────────────────────
  const signedAt = new Date(row.signedAt);
  const { annual940, quarterly941 } = getForm8655AuthDates(signedAt);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildForm8655Pdf({
      taxpayerName:        taxpayerName.trim()  || "Company",
      taxpayerEin:         taxpayerEin.trim(),
      address:             address.trim(),
      cityStateZip:        cityStateZip.trim(),
      phone:               phone.trim(),
      signerName:          row.signerName.trim(),
      signerTitle:         row.signerTitle.trim(),
      signedAt,
      annual940,
      quarterly941,
      // Re-use the stored drawn signature image so the retry PDF matches the original
      signatureImageBase64: row.signatureImage ?? undefined,
    });
  } catch (err) {
    req.log.error({ err }, "retry-8655-upload: PDF regeneration failed");
    await db.update(companySignedForms)
      .set({ uploadStatus: "failed", uploadError: "PDF regeneration failed" })
      .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
      .catch(() => {});
    res.status(500).json({ error: "Failed to regenerate Form 8655 PDF" }); return;
  }

  // ── 6. Upload to Rollfi ───────────────────────────────────────────────────
  let uploadStatus: string = "pending";
  let uploadError:  string | null = null;
  let rollfiDocumentId: string | null = null;

  try {
    const dateStr    = signedAt.toISOString().slice(0, 10).replace(/-/g, "");
    const safeName   = row.signerName.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
    const fileName   = `Form8655_${safeName}_${dateStr}.pdf`;
    const fileBase64 = Buffer.from(pdfBytes).toString("base64");

    const uploadResp = await axios.post(
      `${getBaseUrl()}/adminPortal/uploadDocument`,
      {
        method:       "uploadDocument",
        companyId:    rollfiCompanyId,
        fileName,
        documentType: "8655Form",
        fileBase64,
      },
      { headers: rollfiHeaders() },
    );

    req.log.info({ uploadResp: uploadResp.data }, "retry-8655-upload: uploadDocument response");

    // Expected Rollfi response shape: { documentId: string } on success,
    // or { error: string | { code, message } } / { success: false } on failure.
    // We require an explicit documentId or success:true — a 2xx with neither
    // is treated as a failure so we never silently swallow unexpected shapes.
    const upData = uploadResp.data as Record<string, unknown>;
    if (upData?.documentId) {
      rollfiDocumentId = upData.documentId as string;
      uploadStatus = "uploaded";
    } else if (upData?.success === true) {
      // Provider confirmed success without a documentId
      uploadStatus = "uploaded";
    } else if (upData?.error || upData?.success === false) {
      const errVal = upData?.error;
      const errMsg = typeof errVal === "string" ? errVal
        : typeof (errVal as Record<string, unknown>)?.message === "string"
          ? String((errVal as Record<string, unknown>).message)
          : JSON.stringify(errVal ?? "uploadDocument returned success=false");
      throw new Error(errMsg);
    } else {
      // Neither documentId nor success:true — treat as failure and log raw body
      req.log.error({ rawUploadResponse: uploadResp.data }, "retry-8655-upload: uploadDocument returned unexpected shape (no documentId, no success:true)");
      throw new Error(`uploadDocument returned an unrecognised response shape: ${JSON.stringify(uploadResp.data)}`);
    }

    await db.update(companySignedForms)
      .set({ uploadStatus, rollfiDocumentId, uploadError: null })
      .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")));

    req.log.info({ companyId, rollfiDocumentId }, "retry-8655-upload: upload succeeded");
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    uploadError  = msg;
    uploadStatus = "failed";
    req.log.warn({ err: uploadErr }, "retry-8655-upload: uploadDocument failed");

    await db.update(companySignedForms)
      .set({ uploadStatus: "failed", uploadError: msg })
      .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
      .catch((dbErr) => req.log.warn({ dbErr }, "retry-8655-upload: failed to persist upload error"));
  }

  res.json({ uploadStatus, uploadError, rollfiDocumentId });
});

// ── POST /rollfi/companies/:companyId/reconcile-8655-upload ──────────────────
// Verifies that a stored "uploaded" Form 8655 document still exists in the
// filing service.  If Rollfi can no longer locate the document, the local
// uploadStatus is flipped to "failed" so the retry prompt re-surfaces.
//
// Safe to call at any time:
//   • uploadStatus !== "uploaded"  → 200 { reconciled: false, reason: "not_uploaded" }
//   • No rollfiCompanyId           → 200 { reconciled: false, reason: "no_rollfi_id" }
//   • Rollfi unreachable           → 200 { reconciled: false, reason: "rollfi_unavailable" }
//     (we never flip to "failed" based on a network error alone)
//   • Document confirmed present   → 200 { reconciled: false, reason: "document_present" }
//   • Document missing             → 200 { reconciled: true,  uploadStatus: "failed" }

router.post("/rollfi/companies/:companyId/reconcile-8655-upload", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const companyId = req.params.companyId as string;
  if (user.role !== "super_admin" && user.companyId !== companyId) {
    res.status(403).json({ error: "Access denied: company mismatch" }); return;
  }

  // ── 1. Load signed-form record ────────────────────────────────────────────
  const [row] = await db
    .select({
      uploadStatus:     companySignedForms.uploadStatus,
      rollfiDocumentId: companySignedForms.rollfiDocumentId,
    })
    .from(companySignedForms)
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch(() => [] as { uploadStatus: string; rollfiDocumentId: string | null }[]);

  if (!row || row.uploadStatus !== "uploaded") {
    res.json({ reconciled: false, reason: "not_uploaded" }); return;
  }

  // ── 2. Resolve Rollfi company ID ──────────────────────────────────────────
  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  if (!rollfiCompanyId) {
    res.json({ reconciled: false, reason: "no_rollfi_id" }); return;
  }

  if (!getRollfiConfig().credentialsPresent) {
    res.json({ reconciled: false, reason: "rollfi_unavailable" }); return;
  }

  // ── 3. Ask Rollfi whether the document still exists ───────────────────────
  // Strategy: try document-listing endpoints; if a list comes back and our
  // documentId is absent, the document has been dropped.  If the call itself
  // fails (network / 5xx / unexpected shape), treat as "unavailable" and
  // never flip to failed — we only flip on a *confirmed* absence.
  const storedDocId = row.rollfiDocumentId;

  let documentPresent: boolean | null = null; // null = can't determine

  // Attempt 1 — getCompanyDocuments (adminPortal)
  try {
    const r = await axios.post(
      `${getBaseUrl()}/adminPortal/getCompanyDocuments`,
      { method: "getCompanyDocuments", companyId: rollfiCompanyId },
      { headers: rollfiHeaders(), timeout: 10_000 },
    );
    const docs = (r.data as Record<string, unknown>);
    const list: unknown[] =
      Array.isArray(docs.documents)  ? docs.documents  :
      Array.isArray(docs.Documents)  ? docs.Documents  :
      Array.isArray(docs.data)       ? docs.data        : [];

    if (list.length > 0 || !extractRollfiError(r.data)) {
      // We got a meaningful response — check whether our doc is in it.
      if (storedDocId) {
        documentPresent = list.some(
          d => (d as Record<string, unknown>).documentId === storedDocId ||
               (d as Record<string, unknown>).DocumentId === storedDocId,
        );
      } else {
        // No documentId was stored (success=true path) — treat any non-empty
        // list of "8655Form" docs as present; empty list → missing.
        documentPresent = list.some(d => {
          const dt = ((d as Record<string, unknown>).documentType ??
                      (d as Record<string, unknown>).DocumentType ?? "") as string;
          return /8655/i.test(dt);
        });
      }
    }
  } catch { /* try next */ }

  // Attempt 2 — getCompanyDocuments (reports endpoint)
  if (documentPresent === null) {
    try {
      const r = await axios.post(
        `${getBaseUrl()}/reports#getCompanyDocuments`,
        { method: "getCompanyDocuments", companyId: rollfiCompanyId },
        { headers: rollfiHeaders(), timeout: 10_000 },
      );
      const docs = (r.data as Record<string, unknown>);
      const list: unknown[] =
        Array.isArray(docs.documents) ? docs.documents :
        Array.isArray(docs.Documents) ? docs.Documents :
        Array.isArray(docs.data)      ? docs.data       : [];

      if (list.length > 0 || !extractRollfiError(r.data)) {
        if (storedDocId) {
          documentPresent = list.some(
            d => (d as Record<string, unknown>).documentId === storedDocId ||
                 (d as Record<string, unknown>).DocumentId === storedDocId,
          );
        } else {
          documentPresent = list.some(d => {
            const dt = ((d as Record<string, unknown>).documentType ??
                        (d as Record<string, unknown>).DocumentType ?? "") as string;
            return /8655/i.test(dt);
          });
        }
      }
    } catch { /* unavailable */ }
  }

  // ── 4. Act on result ──────────────────────────────────────────────────────
  if (documentPresent === null) {
    // Couldn't reach Rollfi or couldn't parse response — do nothing
    req.log.warn({ companyId, storedDocId }, "reconcile-8655-upload: could not determine document status from Rollfi");
    res.json({ reconciled: false, reason: "rollfi_unavailable" }); return;
  }

  if (documentPresent) {
    res.json({ reconciled: false, reason: "document_present" }); return;
  }

  // Document is confirmed missing — flip to failed
  const errorMsg = "Form 8655 document was no longer found in the filing service. Please retry the upload.";
  await db.update(companySignedForms)
    .set({ uploadStatus: "failed", uploadError: errorMsg, rollfiDocumentId: null })
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch((dbErr) => req.log.warn({ dbErr }, "reconcile-8655-upload: failed to persist status update"));

  req.log.warn({ companyId, storedDocId }, "reconcile-8655-upload: document missing from Rollfi — flipped to failed");
  res.json({ reconciled: true, uploadStatus: "failed", uploadError: errorMsg });
});

// ── GET /rollfi/companies/:companyId/form-8655.pdf ────────────────────────────
// Regenerates and returns the signed Form 8655 as a PDF file download.
// Requires an existing signed record in company_signed_forms (form must have been
// signed at least once). Works regardless of upload_status.

router.get("/rollfi/companies/:companyId/form-8655.pdf", requireAuth, async (req: Request, res: Response) => {
  const sessionCompanyId = resolveCompanyId(req, res);
  if (!sessionCompanyId) return;

  const urlCompanyId = req.params.companyId as string;
  const caller = store.getUserById(req.session.userId!);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (caller.role !== "super_admin" && urlCompanyId !== sessionCompanyId) {
    res.status(403).json({ error: "Access denied" }); return;
  }
  const companyId = caller.role === "super_admin" ? urlCompanyId : sessionCompanyId;

  // ── Load signed form record ───────────────────────────────────────────────
  const [signedRecord] = await db
    .select({
      signerName:     companySignedForms.signerName,
      signerTitle:    companySignedForms.signerTitle,
      signedAt:       companySignedForms.signedAt,
      signatureImage: companySignedForms.signatureImage,
    })
    .from(companySignedForms)
    .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
    .catch(() => [undefined]);

  if (!signedRecord) {
    res.status(404).json({ error: "No signed Form 8655 found for this company" }); return;
  }

  // ── Resolve Rollfi company ID ─────────────────────────────────────────────
  let rollfiCompanyId: string | null = null;
  try {
    const [co] = await db.select({ rid: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    rollfiCompanyId = co?.rid ?? null;
    if (!rollfiCompanyId) {
      const [leg] = await db
        .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
        .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).catch(() => [undefined]);
      rollfiCompanyId = leg?.rollfiCompanyId ?? null;
    }
  } catch { /* fall through */ }

  // ── Fetch company info (Rollfi → DB fallback) ─────────────────────────────
  let taxpayerName  = "";
  let taxpayerEin   = "";
  let address       = "";
  let cityStateZip  = "";
  let phone         = "";

  if (rollfiCompanyId && getRollfiConfig().credentialsPresent) {
    try {
      const infoResp = await axios.post(
        `${getBaseUrl()}/reports#getCompanyInfo`,
        { method: "getCompanyInfo", companyId: rollfiCompanyId },
        { headers: rollfiHeaders() },
      );
      const raw      = infoResp.data as Record<string, unknown>;
      const companies = Array.isArray(raw.Company) ? raw.Company as Record<string, unknown>[] : [];
      const co       = companies[0] ?? {};
      taxpayerName   = (co.company as string | undefined) ?? "";
      const kybInfos = Array.isArray(co.KYBInformations) ? co.KYBInformations as Record<string, unknown>[] : [];
      taxpayerEin    = (kybInfos[0]?.ein as string | undefined) ?? "";
      phone          = (kybInfos[0]?.phoneNumber as string | undefined) ?? "";
      const locs     = Array.isArray(co.CompanyLocations) ? co.CompanyLocations as Record<string, unknown>[] : [];
      const loc      = locs[0] ?? {};
      address        = (loc.address1 as string | undefined) ?? "";
      const city     = (loc.city    as string | undefined) ?? "";
      const state    = (loc.state   as string | undefined) ?? "";
      const zip      = (loc.zipcode as string | undefined) ?? "";
      cityStateZip   = [city, state, zip].filter(Boolean).join(", ");
    } catch { /* fall through to DB */ }
  }

  // DB fallback when Rollfi data is unavailable
  if (!taxpayerName) {
    const [dbCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
    if (dbCo) {
      taxpayerName = dbCo.name ?? "";
      taxpayerEin  = dbCo.ein  ?? "";
      address      = [dbCo.address1, dbCo.address2].filter(Boolean).join(" ");
      cityStateZip = [dbCo.city, dbCo.state, dbCo.zipcode].filter(Boolean).join(", ");
      phone        = dbCo.phone ?? "";
    }
  }

  // ── Regenerate PDF ────────────────────────────────────────────────────────
  const signedAt = new Date(signedRecord.signedAt);
  const { annual940, quarterly941 } = getForm8655AuthDates(signedAt);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildForm8655Pdf({
      taxpayerName:        taxpayerName.trim()  || "Company",
      taxpayerEin:         taxpayerEin.trim(),
      address:             address.trim(),
      cityStateZip:        cityStateZip.trim(),
      phone:               phone.trim(),
      signerName:          signedRecord.signerName,
      signerTitle:         signedRecord.signerTitle,
      signedAt,
      annual940,
      quarterly941,
      // Re-use the stored drawn signature so the downloaded PDF matches what was signed.
      // Use || (falsy-coalescing) not ?? (nullish-coalescing) so that an empty string
      // stored by a client bug is also normalised to undefined — pdf-lib would throw
      // if it received "" as an image argument.
      signatureImageBase64: signedRecord.signatureImage || undefined,
    });
  } catch (err) {
    req.log.error({ err }, "form-8655.pdf: PDF generation failed");
    res.status(500).json({ error: "Failed to generate Form 8655 PDF" }); return;
  }

  const dateStr  = signedAt.toISOString().slice(0, 10);
  const safeName = signedRecord.signerName.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  const fileName = `Form8655_${safeName}_${dateStr}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", pdfBytes.length);
  res.end(Buffer.from(pdfBytes));
});

export default router;
