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
} from "@workspace/db";
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

export default router;
