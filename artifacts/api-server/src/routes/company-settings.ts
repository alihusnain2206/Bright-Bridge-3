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

    // Group affected employees by their unregistered homeState
    const stateMap = new Map<string, { state: string; employees: { id: string; name: string }[] }>();
    for (const emp of emps) {
      if (!emp.homeState || emp.status === "terminated") continue;
      if (NO_REGISTRATION_NEEDED.has(emp.homeState)) continue;
      if (activeStates.has(emp.homeState)) continue;
      if (!stateMap.has(emp.homeState)) {
        stateMap.set(emp.homeState, { state: emp.homeState, employees: [] });
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

export default router;
