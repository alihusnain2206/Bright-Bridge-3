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
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";
import { extractRollfiError } from "../lib/rollfi-employee-sync.js";

const router: IRouter = Router();

// States that legitimately need no Rollfi state-level registration.
// Mirrors the constants in rollfi-employee-sync.ts so they stay in sync.
const STATES_USING_FEDERAL_W4 = new Set(["ND", "PA", "UT"]);
const STATES_NO_INCOME_TAX    = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
const NO_REGISTRATION_NEEDED  = new Set([...STATES_USING_FEDERAL_W4, ...STATES_NO_INCOME_TAX]);

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
    const rows = await db.select().from(stateRegistrationsTable)
      .where(eq(stateRegistrationsTable.companyId, companyId));
    res.json({ registrations: rows });
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
// Calls Rollfi's updateStateRegistrationInfo (previously never called anywhere).
router.put("/state-registrations/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied" }); return;
  }

  // Express params values are always strings at runtime; cast to satisfy strict TS
  const id = req.params.id as string;
  const [reg] = await db.select().from(stateRegistrationsTable)
    .where(eq(stateRegistrationsTable.id, id)).catch(() => [undefined]);
  if (!reg) { res.status(404).json({ error: "State registration not found" }); return; }

  // Company scoping — owners may only update their own company's records
  if (user.role !== "super_admin" && reg.companyId !== user.companyId) {
    res.status(403).json({ error: "Access denied: company mismatch" }); return;
  }

  const { fieldValues } = req.body as { fieldValues?: Record<string, string> };
  if (!fieldValues || Object.keys(fieldValues).length === 0) {
    res.status(400).json({ error: "fieldValues is required" }); return;
  }

  if (!reg.rollfiCompanyId) {
    res.status(400).json({ error: "Company not registered with Rollfi" }); return;
  }

  const nowISO     = new Date().toISOString();
  const fieldValuesJson = JSON.stringify(fieldValues);

  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/updateStateRegistrationInfo`,
      {
        method:                    "updateStateRegistrationInfo",
        companyId:                 reg.rollfiCompanyId,
        code:                      reg.stateCode,
        companyStateRegistration:  fieldValues,
      },
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

    res.json({ success: true, registration: updated });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, id, stateCode: reg.stateCode }, "updateStateRegistrationInfo failed");
    await db.update(stateRegistrationsTable)
      .set({ status: "failed",
             rollfiResponse: JSON.stringify(e.response?.data ?? String(err)),
             updatedAt: nowISO })
      .where(eq(stateRegistrationsTable.id, id)).catch(() => {});
    res.status(500).json({
      error:   "Failed to update state registration",
      details: e.response?.data ?? String(err),
    });
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

    // Provider call — companyLocationId from DB rollfiLocationId
    const locationPayload: Record<string, string> = {
      companyId: rollfiCompanyId,
    };
    if (rollfiLocationId) locationPayload.companyLocationId = rollfiLocationId;
    if (address1 !== undefined) { locationPayload.address1 = address1.slice(0, 40); }
    if (address2 !== undefined) { locationPayload.address2 = address2.slice(0, 40); }
    if (city     !== undefined) { locationPayload.city     = city.slice(0, 40); }
    if (state    !== undefined) { locationPayload.state    = state; }
    if (zipcode  !== undefined) { locationPayload.zipcode  = zipcode; }
    if (phone    !== undefined) { locationPayload.phoneNumber = phone; }
    locationPayload.country = "US";

    const r = await axios.post(
      `${getBaseUrl()}/companyOnboarding#updateCompanyLocation`,
      { method: "updateCompanyLocation", companyLocation: locationPayload },
      { headers: rollfiHeaders() },
    );

    // Provider returns empty body with 400 when request format is invalid
    if (!r.data || (typeof r.data === "object" && Object.keys(r.data).length === 0)) {
      res.status(400).json({
        error: "Address update was rejected by the payroll provider. Please check the values and try again.",
      });
      return;
    }

    const rollfiErr = extractRollfiError(r.data);
    if (rollfiErr) {
      res.status(400).json({ error: rollfiErr, rollfiResponse: r.data }); return;
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
    const e = err as { response?: { data: unknown; status?: number } };
    // Surface the empty-body 400 specifically
    if (e.response?.status === 400) {
      res.status(400).json({
        error: "Address update was rejected by the payroll provider. Please check the values and try again.",
      });
      return;
    }
    req.log.error({ err }, "PUT /company-info/location failed");
    res.status(500).json({ error: "Save failed", details: e.response?.data ?? String(err) });
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
        formType:   companySignedForms.formType,
        signerName: companySignedForms.signerName,
        signerTitle: companySignedForms.signerTitle,
        signedAt:   companySignedForms.signedAt,
      }).from(companySignedForms).where(eq(companySignedForms.companyId, companyId)),
    ]);

    // Build a quick lookup: formType → signed record
    const signedFormsMap = Object.fromEntries(
      signedFormRows.map(r => [r.formType, r])
    );
    const form8655Signed = !!signedFormsMap["8655"];

    // ── 3. Rollfi getCompanyTask (authoritative for KYB + bank) ───────────────
    let rollfiTasks: Array<{ task: string; description: string }> = [];
    let kybStatusFromProvider: string | null = null;
    let bankLinked: boolean = co.bankAccountAdded ?? false;

    if (resolvedRollfiCompanyId) {
      try {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getCompanyTask`,
          { method: "getCompanyTask", companyId: resolvedRollfiCompanyId },
          { headers: rollfiHeaders() },
        );
        const raw = r.data as Record<string, unknown>;
        rollfiTasks = (raw.tasks ?? []) as Array<{ task: string; description: string }>;
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
    const stepsAllDone   = !!resolvedRollfiCompanyId && kybApproved && bankLinked &&
      payScheduleSet && gaps.length === 0 && employeeCount > 0 && notReadyEmps.length === 0 &&
      form8655Signed;

    const steps = [
      {
        id: "company_registered", number: 1, label: "Company registered",
        done: !!resolvedRollfiCompanyId,
        missingText: "Enroll your company in the payroll service",
        linkTo: "/settings?tab=company-info",
      },
      {
        id: "business_verified", number: 2, label: "Business verified",
        done: kybApproved,
        missingText: kybStatus === "pending" ? "Business verification is pending review"
          : kybStatus === "failed" ? "Business verification failed — contact support"
          : "Submit your business verification documents",
        linkTo: "/settings?tab=company-info",
      },
      {
        id: "funding_account", number: 3, label: "Funding account",
        done: bankLinked,
        missingText: "Connect a bank account for payroll funding",
        linkTo: null,
      },
      {
        id: "pay_schedule", number: 4, label: "Pay schedule",
        done: payScheduleSet,
        missingText: co.payScheduleAdded && !co.payFrequency
          ? "Select a pay frequency to finalize your pay schedule"
          : "Set up a pay schedule for your employees",
        linkTo: "/payroll",
      },
      {
        id: "state_tax", number: 5, label: "State tax registered",
        done: gaps.length === 0,
        missingText: gaps.length === 1
          ? `${gaps[0].state} state tax registration is missing`
          : `${gaps.length} states need tax registration`,
        linkTo: "/settings?tab=state-tax",
      },
      {
        id: "employees_added", number: 6, label: "Employees added",
        done: employeeCount > 0,
        missingText: "Add at least one employee before running payroll",
        linkTo: "/people/new",
      },
      {
        id: "employees_ready", number: 7, label: "Employees payroll-ready",
        done: employeeCount > 0 && notReadyEmps.length === 0,
        missingText: notReadyEmps.length > 0
          ? `${notReadyEmps.length} employee${notReadyEmps.length > 1 ? "s are" : " is"} not yet activated for payroll`
          : "Add employees first",
        linkTo: "/people",
      },
      {
        id: "form_8655_signed", number: 8, label: "IRS Form 8655 signed",
        done: form8655Signed,
        missingText: "Sign Form 8655 to authorize federal tax filing",
        linkTo: "/settings?tab=signatures",
      },
      {
        id: "ready_to_run", number: 9, label: "Ready to run payroll",
        done: stepsAllDone,
        missingText: "Complete all steps above to unlock payroll",
        linkTo: null,
      },
    ];

    const completedCount = steps.filter(s => s.done).length;

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

    // d. IRS Form 8655 not yet signed
    if (!form8655Signed) {
      attention.push({
        id: "form_8655_unsigned",
        severity: "high",
        message: "IRS Form 8655 has not been signed — required before federal tax filings can be made",
        linkTo: "/settings?tab=signatures",
        actionLabel: "Sign form",
        category: "signature",
      });
    }

    res.json({
      company: { id: co.id, name: co.name },
      progress: { completedCount, totalCount: 9, steps },
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
  const signedRows = await db
    .select({ formType: companySignedForms.formType, signerName: companySignedForms.signerName, signerTitle: companySignedForms.signerTitle, signedAt: companySignedForms.signedAt })
    .from(companySignedForms)
    .where(eq(companySignedForms.companyId, companyId))
    .catch(() => [] as typeof signedRows);
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

  if (!rollfiCompanyId || !getRollfiConfig().credentialsPresent) {
    res.json({ signatures: [], signedForms }); return;
  }

  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanyTask`,
      { method: "getCompanyTask", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() },
    );
    const tasks = ((r.data as Record<string, unknown>).tasks ?? []) as Array<{ task: string; description: string }>;
    res.json({ signatures: tasks.filter(t => /signature request/i.test(t.task)), signedForms });
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
  const { formTask } = req.body as { formTask?: string };

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

  // No live URL — surface a friendly fallback
  res.json({
    url: null,
    message: `We've requested the signing link for ${formType}. Please check your registered email address — you should receive the link within a few minutes.`,
    emailSent: true,
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

  const { signerName, signerTitle } = req.body as { signerName?: string; signerTitle?: string };
  if (!signerName?.trim() || !signerTitle?.trim()) {
    res.status(400).json({ error: "signerName and signerTitle are required" }); return;
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
  const { annualYear, quarterlyBeginMonth } = getForm8655AuthDates(signedAt);

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
      annualYear,
      quarterlyBeginMonth,
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

  try {
    await db
      .insert(companySignedForms)
      .values({
        id,
        companyId,
        formType:     "8655",
        signerName:   signerName.trim(),
        signerTitle:  signerTitle.trim(),
        signedAt:     signedAtIso,
        uploadStatus: "pending",
        createdAt,
      })
      .onConflictDoUpdate({
        target: [companySignedForms.companyId, companySignedForms.formType],
        set: {
          signerName:   signerName.trim(),
          signerTitle:  signerTitle.trim(),
          signedAt:     signedAtIso,
          uploadStatus: "pending",
          uploadError:  null,
          rollfiDocumentId: null,
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
      `${getBaseUrl()}/reports#uploadDocument`,
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

    // Rollfi returns { success, documentId } or { error }
    const upData = uploadResp.data as Record<string, unknown>;
    if (upData?.documentId) {
      rollfiDocumentId = upData.documentId as string;
      uploadStatus = "uploaded";
    } else if (upData?.error || upData?.success === false) {
      throw new Error(String(upData?.error ?? "uploadDocument returned success=false"));
    } else {
      // Treat any 2xx with no explicit error as uploaded
      uploadStatus = "uploaded";
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

export default router;
